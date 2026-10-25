import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { CATEGORIES } from './categories.js';
import { placeholderTitle } from './enrich.js';
import { resolveShortLink } from './fetcher.js';
import { detectPlatform, findUrl, normalizeUrl } from './parse.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
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

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    throw new HttpError(415, 'Erwarte JSON (Content-Type: application/json)');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Anfrage ist zu groß');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
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

function requestIsHttps(req) {
  return Boolean(req.socket.encrypted) || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${requestIsHttps(req) ? 'https' : 'http'}://${host}`;
}

async function serveFile(res, file, cacheControl) {
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': cacheControl,
  });
  createReadStream(file).pipe(res);
  return true;
}

export function createApp({ db, enricher, imagesDir, password, secret, ai = null, fetchOptions = {}, log = console }) {
  const auth = createAuth(password, secret);

  async function addRecipe(body) {
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

    const existing = db.findByUrl(url);
    if (existing) return { recipe: existing, duplicate: true };

    const platform = detectPlatform(url);
    const recipe = db.insert({
      url,
      platform,
      title: placeholderTitle(platform),
      notes: cleanString(body.notes, 20000) ?? '',
      status: 'pending',
    });
    enricher.enqueue(recipe.id);
    return { recipe, duplicate: false };
  }

  function recipeOr404(idParam) {
    const recipe = db.get(Number(idParam));
    if (!recipe) throw new HttpError(404, 'Rezept nicht gefunden');
    return recipe;
  }

  async function handleApi(req, res, pathname) {
    const method = req.method;

    if (pathname === '/api/session' && method === 'GET') {
      return send(res, 200, { authRequired: auth.enabled, authenticated: auth.isAuthorized(req), ai: Boolean(ai) });
    }
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJson(req);
      const result = auth.checkPassword(String(body.password ?? ''), req.socket.remoteAddress);
      if (result.locked) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.');
      if (!result.ok) throw new HttpError(401, 'Falsches Passwort');
      return send(res, 200, { ok: true }, { 'set-cookie': auth.sessionCookie(requestIsHttps(req)) });
    }
    if (pathname === '/api/logout' && method === 'POST') {
      return send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() });
    }

    if (!auth.isAuthorized(req)) throw new HttpError(401, 'Bitte anmelden');

    if (pathname === '/api/recipes' && method === 'GET') {
      return send(res, 200, { recipes: db.list(), categories: CATEGORIES.map(({ id, label, emoji }) => ({ id, label, emoji })) });
    }
    if (pathname === '/api/recipes' && method === 'POST') {
      const result = await addRecipe(await readJson(req));
      return send(res, result.duplicate ? 200 : 201, result);
    }
    if (pathname === '/api/setup' && method === 'GET') {
      return send(res, 200, { apiToken: auth.enabled ? auth.apiToken : null, endpoint: `${origin(req)}/api/recipes` });
    }
    if (pathname === '/api/export' && method === 'GET') {
      const date = new Date().toISOString().slice(0, 10);
      return send(res, 200, { exportedAt: new Date().toISOString(), recipes: db.list() }, {
        'content-disposition': `attachment; filename="rezeptbox-${date}.json"`,
      });
    }

    const match = pathname.match(/^\/api\/recipes\/(\d+)(\/refresh)?$/);
    if (match) {
      const recipe = recipeOr404(match[1]);
      if (match[2] && method === 'POST') {
        await readJson(req);
        db.update(recipe.id, { status: 'pending', statusDetail: null });
        enricher.enqueue(recipe.id, { force: true });
        return send(res, 202, { recipe: db.get(recipe.id) });
      }
      if (match[2]) throw new HttpError(405, 'Methode nicht erlaubt');
      if (method === 'GET') return send(res, 200, { recipe });
      if (method === 'PATCH') {
        const changes = validatePatch(await readJson(req));
        return send(res, 200, { recipe: db.update(recipe.id, changes) });
      }
      if (method === 'DELETE') {
        const file = db.thumbnailFile(recipe.id);
        db.remove(recipe.id);
        if (file) await unlink(path.join(imagesDir, file)).catch(() => {});
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Methode nicht erlaubt');
    }

    throw new HttpError(404, 'Unbekannte Adresse');
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt');

    if (pathname.startsWith('/images/')) {
      if (!auth.isAuthorized(req)) throw new HttpError(401, 'Bitte anmelden');
      const name = path.basename(pathname);
      if (!/^[\w.-]+$/.test(name) || !(await serveFile(res, path.join(imagesDir, name), 'private, max-age=31536000, immutable'))) {
        throw new HttpError(404, 'Bild nicht gefunden');
      }
      return;
    }

    const file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (file.startsWith(PUBLIC_DIR + path.sep) && path.extname(file)) {
      if (await serveFile(res, file, 'no-cache')) return;
      throw new HttpError(404, 'Datei nicht gefunden');
    }
    // App routes (/, /share, …) all load the single-page app.
    await serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
  }

  return async function handler(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, { error: 'Ungültige Adresse' });
    }
    try {
      if (pathname === '/healthz') return send(res, 200, 'ok');
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      return await handleStatic(req, res, pathname);
    } catch (error) {
      if (!(error instanceof HttpError)) log.error?.(error);
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) send(res, status, { error: error instanceof HttpError ? error.message : 'Interner Fehler' });
      else res.destroy();
    }
  };
}
