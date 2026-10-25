import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAi } from './ai.js';
import { createApp } from './app.js';
import { openDatabase } from './db.js';
import { createEnricher } from './enrich.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const imagesDir = path.join(dataDir, 'images');
const password = process.env.APP_PASSWORD || '';
const fetchOptions = { allowPrivate: process.env.ALLOW_PRIVATE_URLS === 'true' };

if (!password && process.env.NODE_ENV === 'production') {
  console.error('APP_PASSWORD ist nicht gesetzt. Ohne Passwort wäre die Rezeptbox für jeden offen – Start abgebrochen.');
  process.exit(1);
}

mkdirSync(imagesDir, { recursive: true });

// Random per-installation key for signing logins, created on first start.
const secretFile = path.join(dataDir, 'secret.key');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = readFileSync(secretFile, 'utf8').trim();

const db = openDatabase(path.join(dataDir, 'rezeptbox.db'));
const ai = createAi();
const enricher = createEnricher({ db, imagesDir, ai, fetchOptions });
const server = createServer(createApp({ db, enricher, imagesDir, password, secret, ai, fetchOptions }));

server.listen(port, host, () => {
  console.log(`Rezeptbox läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(ai ? `KI-Analyse aktiv (${ai.model})` : 'KI-Analyse aus (ANTHROPIC_API_KEY nicht gesetzt) – Kategorien per Stichwort');
  if (!password) console.warn('Achtung: APP_PASSWORD ist nicht gesetzt, die App ist ohne Anmeldung erreichbar.');
});

// Links that were still being analysed when the server stopped.
for (const id of db.pendingIds()) enricher.enqueue(id);

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
