import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createApp, SECURITY_HEADERS } from './app.js';
import { createAnalyzer, createQueue } from './enrich.js';
import { sqliteDriver } from './sqlite.js';
import { createStore } from './store.js';

// Runs the app as a plain Node HTTP server (local use, Docker).

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(res, file) {
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
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}

// Files from public/, and the single-page app for every other path. Files
// starting with "_" are Cloudflare config (e.g. _headers), not content.
async function serveStatic(req, res, pathname) {
  const file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (file.startsWith(PUBLIC_DIR + path.sep) && path.extname(file)) {
    if (!path.basename(file).startsWith('_') && (await serveFile(res, file))) return;
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
    return;
  }
  await serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
}

function toRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    for (const v of [value].flat()) headers.append(key, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  if (!response.body) return res.end();
  res.end(Buffer.from(await response.arrayBuffer()));
}

export async function createNodeServer({ dbFile, password, ai = null, fetchOptions = {}, log = console }) {
  const sql = sqliteDriver(dbFile);
  const store = await createStore(sql);
  const resolveHost = async (host) => (await lookup(host, { all: true })).map((a) => a.address);
  const options = { resolveHost, ...fetchOptions };
  const queue = createQueue(createAnalyzer({ store, ai, fetchOptions: options, log }));
  const handle = createApp({
    store,
    password,
    secret: await store.secret(),
    ai,
    fetchOptions: options,
    log,
    enqueue: (id, opts) => queue.enqueue(id, opts),
  });

  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/healthz' || pathname.startsWith('/api/') || pathname.startsWith('/images/')) {
        await sendResponse(res, await handle(toRequest(req), { clientIp: req.socket.remoteAddress }));
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, decodeURIComponent(pathname));
      } else {
        res.writeHead(405).end();
      }
    } catch (error) {
      log.error?.(error);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });

  // Links that were still being analysed when the server stopped.
  for (const id of await store.pendingIds()) queue.enqueue(id);

  return {
    server,
    queue,
    async close() {
      await queue.idle();
      await new Promise((resolve) => server.close(resolve));
      sql.close();
    },
  };
}
