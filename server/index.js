import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createAi } from './ai.js';
import { createNodeServer } from './node.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const password = process.env.APP_PASSWORD || '';

if (!password && process.env.NODE_ENV === 'production') {
  console.error('APP_PASSWORD ist nicht gesetzt. Ohne Passwort wäre die Rezeptbox für jeden offen – Start abgebrochen.');
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
const ai = createAi({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL });
const app = await createNodeServer({
  dbFile: path.join(dataDir, 'rezeptbox.db'),
  password,
  ai,
  fetchOptions: { allowPrivate: process.env.ALLOW_PRIVATE_URLS === 'true' },
});

app.server.listen(port, host, () => {
  console.log(`Rezeptbox läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(ai ? `KI-Analyse aktiv (${ai.model})` : 'KI-Analyse aus (ANTHROPIC_API_KEY nicht gesetzt) – Kategorien per Stichwort');
  if (!password) console.warn('Achtung: APP_PASSWORD ist nicht gesetzt, die App ist ohne Anmeldung erreichbar.');
});

function shutdown() {
  app.server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
