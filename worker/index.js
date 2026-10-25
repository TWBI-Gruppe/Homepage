import { createAi } from '../server/ai.js';
import { createApp } from '../server/app.js';
import { createAnalyzer } from '../server/enrich.js';
import { createStore, d1Driver } from '../server/store.js';

// Cloudflare Workers entry point. Static files (public/) are served by
// Cloudflare directly (see "assets" in wrangler.jsonc); only /api/*, /images/*
// and /healthz reach this code. Data lives in the D1 database bound as DB.

// Background work after a response may run for about 30 seconds on
// Cloudflare; leave headroom for saving the result.
const ANALYSIS_TIME_LIMIT_MS = 25_000;

let appPromise = null;

function getApp(env) {
  appPromise ??= (async () => {
    const store = await createStore(d1Driver(env.DB));
    const ai = createAi({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
    const fetchOptions = { allowPrivate: env.ALLOW_PRIVATE_URLS === 'true' };
    const analyzer = createAnalyzer({ store, ai, fetchOptions, timeLimitMs: ANALYSIS_TIME_LIMIT_MS });
    return createApp({
      store,
      password: env.APP_PASSWORD,
      secret: await store.secret(),
      ai,
      fetchOptions,
      enqueue: (id, opts, ctx) => ctx.waitUntil(analyzer.analyze(id, opts)),
    });
  })();
  // Don't cache a failed start (e.g. database not reachable yet).
  appPromise.catch(() => {
    appPromise = null;
  });
  return appPromise;
}

export default {
  async fetch(request, env, ctx) {
    if (!env.APP_PASSWORD) {
      return new Response(
        'APP_PASSWORD fehlt. Bitte in Cloudflare unter Worker → Settings → Variables and Secrets als Secret anlegen.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }
    const handle = await getApp(env);
    return handle(request, {
      clientIp: request.headers.get('cf-connecting-ip'),
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
};
