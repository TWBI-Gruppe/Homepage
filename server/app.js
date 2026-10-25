import { createAuth } from './auth.js';
import { CATEGORIES } from './categories.js';
import { placeholderTitle } from './enrich.js';
import { resolveShortLink } from './fetcher.js';
import { detectPlatform, findUrl, normalizeUrl } from './parse.js';

// The API as a Fetch-style handler (Request in, Response out), so the same
// code runs on Node and on Cloudflare Workers. Static files are served by the
// platform: server/node.js on Node, the assets setting in wrangler.jsonc on
// Cloudflare.

const MAX_BODY = 1024 * 1024;
// A run that has not reported back for this long was cut off (e.g. by the
// Cloudflare time limit) and gets restarted, at most MAX_ATTEMPTS times.
const STALE_AFTER_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  return new Response(isJson ? JSON.stringify(body) : body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw new HttpError(415, 'Erwarte JSON (Content-Type: application/json)');
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new HttpError(413, 'Anfrage ist zu groß');
  const text = (await request.text()).trim();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Anfrage ist zu groß');
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    // iOS Kurzbefehle may send the shared link as a bare JSON string.
    return typeof data === 'string' ? { url: data } : data ?? {};
  } catch {
    throw new HttpError(400, 'Ungültiges JSON');
  }
}

function cleanString(value, max) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Ungültiger Wert');
  return value.trim().slice(0, max);
}

function cleanList(value, maxItems, maxLength, { dedupe = false } = {}) {
  if (!Array.isArray(value)) throw new HttpError(400, 'Liste erwartet');
  const items = value.filter((v) => typeof v === 'string').map((v) => v.trim().slice(0, maxLength)).filter(Boolean);
  return (dedupe ? [...new Set(items)] : items).slice(0, maxItems);
}

// Only the fields a user may change by hand.
function validatePatch(body) {
  const out = {};
  if ('title' in body) out.title = cleanString(body.title, 200) || null;
  if ('caption' in body) out.caption = cleanString(body.caption, 20000) ?? '';
  if ('notes' in body) out.notes = cleanString(body.notes, 20000) ?? '';
  if ('servings' in body) out.servings = cleanString(body.servings, 60) || null;
  if ('categories' in body) out.categories = cleanList(body.categories, 30, 40, { dedupe: true });
  if ('ingredients' in body) out.ingredients = cleanList(body.ingredients, 150, 500);
  if ('steps' in body) out.steps = cleanList(body.steps, 100, 2000);
  for (const flag of ['favorite', 'cooked']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') throw new HttpError(400, `${flag} muss true/false sein`);
      out[flag] = body[flag];
    }
  }
  if ('prepMinutes' in body) {
    const n = body.prepMinutes;
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 10000)) throw new HttpError(400, 'Ungültige Zubereitungszeit');
    out.prepMinutes = n || null;
  }
  return out;
}

function requestIsHttps(request) {
  const forwarded = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  return forwarded ? forwarded === 'https' : new URL(request.url).protocol === 'https:';
}

function origin(request) {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || url.host;
  return `${requestIsHttps(request) ? 'https' : 'http'}://${host}`;
}

/**
 * @param {object} options
 * @param {object} options.store     see store.js
 * @param {(id: number, opts: {force?: boolean}, ctx: object) => void} options.enqueue
 *        starts the background analysis of a recipe
 */
export function createApp({ store, enqueue, password, secret, ai = null, fetchOptions = {}, log = console }) {
  const auth = createAuth(password, secret);

  async function addRecipe(body, ctx) {
    const found = findUrl(body.url, body.text, body.title);
    if (!found) throw new HttpError(400, 'Kein Link gefunden. Bitte einen Link von Instagram, TikTok o. Ä. teilen.');
    let url;
    try {
      url = normalizeUrl(found);
    } catch {
      throw new HttpError(400, 'Ungültiger Link');
    }
    try {
      url = normalizeUrl(await resolveShortLink(url, fetchOptions));
    } catch (error) {
      log.warn?.(`Kurzlink ${url} nicht aufgelöst: ${error.message}`);
    }

    const existing = await store.findByUrl(url);
    if (existing) return { recipe: existing, duplicate: true };

    const platform = detectPlatform(url);
    const recipe = await store.insert({
      url,
      platform,
      title: placeholderTitle(platform),
      notes: cleanString(body.notes, 20000) ?? '',
      status: 'pending',
    });
    enqueue(recipe.id, {}, ctx);
    return { recipe, duplicate: false };
  }

  // Restarts analyses that were cut off, or gives up on them.
  async function recoverStuck(recipes, ctx) {
    const now = Date.now();
    for (const recipe of recipes) {
      if (recipe.status !== 'pending' || now - Date.parse(recipe.updatedAt) < STALE_AFTER_MS) continue;
      if (recipe.attempts >= MAX_ATTEMPTS) {
        Object.assign(recipe, await store.update(recipe.id, {
          status: 'failed',
          statusDetail: 'Die Analyse hat zu lange gedauert – „Neu analysieren“ versuchen',
        }));
      } else {
        Object.assign(recipe, await store.update(recipe.id, { status: 'pending' }));
        enqueue(recipe.id, {}, ctx);
      }
    }
  }

  async function recipeOr404(idParam) {
    const recipe = await store.get(Number(idParam));
    if (!recipe) throw new HttpError(404, 'Rezept nicht gefunden');
    return recipe;
  }

  async function handleApi(request, pathname, ctx) {
    const method = request.method;

    if (pathname === '/api/session' && method === 'GET') {
      return send(200, { authRequired: auth.enabled, authenticated: auth.isAuthorized(request.headers), ai: Boolean(ai) });
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJson(request);
      const result = auth.checkPassword(String(body.password ?? ''), ctx.clientIp || 'unknown');
      if (result.locked) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.');
      if (!result.ok) throw new HttpError(401, 'Falsches Passwort');
      return send(200, { ok: true }, { 'set-cookie': auth.sessionCookie(requestIsHttps(request)) });
    }
    if (pathname === '/api/logout' && method === 'POST') {
      return send(200, { ok: true }, { 'set-cookie': auth.clearCookie() });
    }

    if (!auth.isAuthorized(request.headers)) throw new HttpError(401, 'Bitte anmelden');

    if (pathname === '/api/recipes' && method === 'GET') {
      const recipes = await store.list();
      await recoverStuck(recipes, ctx);
      return send(200, { recipes, categories: CATEGORIES.map(({ id, label, emoji }) => ({ id, label, emoji })) });
    }
    if (pathname === '/api/recipes' && method === 'POST') {
      const result = await addRecipe(await readJson(request), ctx);
      return send(result.duplicate ? 200 : 201, result);
    }
    if (pathname === '/api/setup' && method === 'GET') {
      return send(200, { apiToken: auth.enabled ? auth.apiToken : null, endpoint: `${origin(request)}/api/recipes` });
    }
    if (pathname === '/api/export' && method === 'GET') {
      const date = new Date().toISOString().slice(0, 10);
      return send(200, { exportedAt: new Date().toISOString(), recipes: await store.list() }, {
        'content-disposition': `attachment; filename="rezeptbox-${date}.json"`,
      });
    }

    const match = pathname.match(/^\/api\/recipes\/(\d+)(\/refresh)?$/);
    if (match) {
      const recipe = await recipeOr404(match[1]);
      if (match[2] && method === 'POST') {
        await readJson(request);
        const pending = await store.update(recipe.id, { status: 'pending', statusDetail: null, attempts: 0 });
        enqueue(recipe.id, { force: true }, ctx);
        return send(202, { recipe: pending });
      }
      if (match[2]) throw new HttpError(405, 'Methode nicht erlaubt');
      if (method === 'GET') return send(200, { recipe });
      if (method === 'PATCH') {
        const changes = validatePatch(await readJson(request));
        return send(200, { recipe: await store.update(recipe.id, changes) });
      }
      if (method === 'DELETE') {
        await store.remove(recipe.id);
        return send(200, { ok: true });
      }
      throw new HttpError(405, 'Methode nicht erlaubt');
    }

    throw new HttpError(404, 'Unbekannte Adresse');
  }

  async function handleImage(request, pathname) {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt');
    if (!auth.isAuthorized(request.headers)) throw new HttpError(401, 'Bitte anmelden');
    const name = pathname.slice('/images/'.length);
    const image = /^[\w.-]+$/.test(name) ? await store.getImage(name) : null;
    if (!image) throw new HttpError(404, 'Bild nicht gefunden');
    return new Response(request.method === 'HEAD' ? null : image.data, {
      headers: {
        ...SECURITY_HEADERS,
        'content-type': image.mediaType,
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  }

  /**
   * @param {Request} request
   * @param {{ clientIp?: string, waitUntil?: Function }} ctx platform context
   * @returns {Promise<Response>}
   */
  return async function handle(request, ctx = {}) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return send(400, { error: 'Ungültige Adresse' });
    }
    try {
      if (pathname === '/healthz') return send(200, 'ok');
      if (pathname.startsWith('/api/')) return await handleApi(request, pathname, ctx);
      if (pathname.startsWith('/images/')) return await handleImage(request, pathname);
      throw new HttpError(404, 'Unbekannte Adresse');
    } catch (error) {
      if (!(error instanceof HttpError)) log.error?.(error);
      const status = error instanceof HttpError ? error.status : 500;
      return send(status, { error: error instanceof HttpError ? error.message : 'Interner Fehler' });
    }
  };
}
