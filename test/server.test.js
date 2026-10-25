import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { createEnricher } from '../server/enrich.js';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const RECIPE_PAGE = `<!doctype html><html><head>
<meta property="og:title" content="Blog-Titel">
<meta property="og:image" content="/bild.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Shakshuka mit Feta",
"recipeIngredient":["4 Eier","1 Dose Tomaten","100 g Feta"],"recipeInstructions":"Tomaten einkochen.\\nEier hineingleiten lassen.",
"totalTime":"PT25M","recipeYield":"2","author":{"name":"Testküche"}}</script></head><body></body></html>`;

const CAPTION_PAGE = `<!doctype html><html><head>
<meta property="og:description" content="Kürbissuppe in 30 Minuten 🎃
Zutaten:
1 Hokkaido
400 ml Kokosmilch
Zubereitung:
Alles kochen und pürieren. #suppe #vegan">
<meta property="og:image" content="/bild.png"></head></html>`;

let fixture;
let fixtureUrl;
let app;
let base;
let cookie;
const aiCalls = [];

const fakeAi = {
  model: 'test',
  async analyze(input) {
    aiCalls.push(input);
    return {
      isRecipe: true,
      title: 'KI-Titel',
      categories: ['vegetarisch', 'fruehstueck'],
      ingredients: ['4 Eier (KI)'],
      steps: ['Schritt (KI)'],
      prepMinutes: 25,
      servings: '2 Portionen',
      tags: ['eier'],
    };
  },
};

const silent = { warn() {}, error() {} };

// A complete app instance with its own temporary data directory.
async function startApp({ ai = null } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rezeptbox-test-'));
  const imagesDir = path.join(dataDir, 'images');
  mkdirSync(imagesDir);
  const db = openDatabase(path.join(dataDir, 'test.db'));
  const fetchOptions = { allowPrivate: true };
  const enricher = createEnricher({ db, imagesDir, ai, fetchOptions, log: silent });
  const server = createServer(createApp({ db, enricher, imagesDir, password: 'geheim', ai, fetchOptions, log: silent }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    dataDir,
    enricher,
    async close() {
      await app.enricher.idle();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function login(baseUrl) {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'geheim' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(pathname, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth && cookie ? { cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  fixture = createServer((req, res) => {
    if (req.url === '/rezept') return res.writeHead(200, { 'content-type': 'text/html' }).end(RECIPE_PAGE);
    if (req.url === '/caption') return res.writeHead(200, { 'content-type': 'text/html' }).end(CAPTION_PAGE);
    if (req.url === '/bild.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    res.writeHead(404).end();
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
  app = await startApp();
  base = app.base;
});

after(async () => {
  await app.close();
  await new Promise((resolve) => fixture.close(resolve));
});

test('API requires login', async () => {
  const session = await call('/api/session');
  assert.deepEqual(session.data, { authRequired: true, authenticated: false, ai: false });
  assert.equal((await call('/api/recipes')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { password: 'falsch' } })).status, 401);

  const ok = await call('/api/login', { method: 'POST', body: { password: 'geheim' } });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('/api/session')).data.authenticated, true);
});

test('saving a recipe page fills in details from JSON-LD', async () => {
  const created = await call('/api/recipes', {
    method: 'POST',
    body: { text: `Guck mal: ${fixtureUrl}/rezept?utm_source=insta`, notes: 'Für Sonntag' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.duplicate, false);
  assert.equal(created.data.recipe.status, 'pending');
  assert.equal(created.data.recipe.url, `${fixtureUrl}/rezept`);

  await app.enricher.idle();
  const { data } = await call(`/api/recipes/${created.data.recipe.id}`);
  const recipe = data.recipe;
  assert.equal(recipe.status, 'done');
  assert.equal(recipe.title, 'Shakshuka mit Feta');
  assert.equal(recipe.author, 'Testküche');
  assert.deepEqual(recipe.ingredients, ['4 Eier', '1 Dose Tomaten', '100 g Feta']);
  assert.deepEqual(recipe.steps, ['Tomaten einkochen.', 'Eier hineingleiten lassen.']);
  assert.equal(recipe.prepMinutes, 25);
  assert.equal(recipe.notes, 'Für Sonntag');
  assert.ok(recipe.categories.includes('fruehstueck'), recipe.categories.join());
  assert.match(recipe.thumbnail, /^\/images\/r\d+-\w+\.png$/);

  const image = await fetch(base + recipe.thumbnail, { headers: { cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(base + recipe.thumbnail)).status, 401);
});

test('the same link is only stored once', async () => {
  const again = await call('/api/recipes', { method: 'POST', body: { url: `${fixtureUrl}/rezept#top` } });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
});

test('captions from preview tags are parsed and categorised without AI', async () => {
  const created = await call('/api/recipes', { method: 'POST', body: { url: `${fixtureUrl}/caption` } });
  await app.enricher.idle();
  const { recipe } = (await call(`/api/recipes/${created.data.recipe.id}`)).data;
  assert.equal(recipe.title, 'Kürbissuppe in 30 Minuten 🎃');
  assert.deepEqual(recipe.ingredients, ['1 Hokkaido', '400 ml Kokosmilch']);
  assert.deepEqual(recipe.steps, ['Alles kochen und pürieren.']);
  assert.ok(recipe.categories.includes('suppen') && recipe.categories.includes('vegan'), recipe.categories.join());
  assert.deepEqual(recipe.tags, ['suppe', 'vegan']);
  assert.equal(recipe.analyzedWithAi, false);
});

test('the API token from /api/setup works for iOS Shortcuts', async () => {
  const { data } = await call('/api/setup');
  assert.equal(data.endpoint, `${base}/api/recipes`);
  assert.ok(data.apiToken.length >= 20);

  // Shortcuts may post the share input as a bare JSON string.
  const res = await fetch(data.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.apiToken}` },
    body: JSON.stringify(`${fixtureUrl}/rezept?variante=2`),
  });
  assert.equal(res.status, 201);
  const wrong = await fetch(data.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer falsch' },
    body: JSON.stringify({ url: `${fixtureUrl}/rezept?variante=3` }),
  });
  assert.equal(wrong.status, 401);
  await app.enricher.idle();
});

test('PATCH updates allowed fields and validates input', async () => {
  const { recipes } = (await call('/api/recipes')).data;
  const id = recipes[0].id;
  const patched = await call(`/api/recipes/${id}`, {
    method: 'PATCH',
    body: { favorite: true, categories: ['pasta', 'Weihnachten', 'pasta'], notes: '  mehr Knoblauch ', prepMinutes: 40, url: 'https://evil.example' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.recipe.favorite, true);
  assert.deepEqual(patched.data.recipe.categories, ['pasta', 'Weihnachten']);
  assert.equal(patched.data.recipe.notes, 'mehr Knoblauch');
  assert.equal(patched.data.recipe.prepMinutes, 40);
  assert.notEqual(patched.data.recipe.url, 'https://evil.example');

  assert.equal((await call(`/api/recipes/${id}`, { method: 'PATCH', body: { favorite: 'ja' } })).status, 400);
  assert.equal((await call(`/api/recipes/${id}`, { method: 'PATCH', body: { prepMinutes: -5 } })).status, 400);
  assert.equal((await call('/api/recipes/99999', { method: 'PATCH', body: {} })).status, 404);
});

test('state-changing requests must be JSON (CSRF protection)', async () => {
  const res = await fetch(`${base}/api/recipes`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: `url=${encodeURIComponent(`${fixtureUrl}/rezept?form=1`)}`,
  });
  assert.equal(res.status, 415);
  assert.equal((await call('/api/recipes', { method: 'POST', body: { text: 'kein link' } })).status, 400);
});

test('with AI configured, recipes are analysed by it and refresh keeps custom categories', async () => {
  const aiApp = await startApp({ ai: fakeAi });
  try {
    const aiCookie = await login(aiApp.base);
    const json = (method, body) => ({
      method,
      headers: { cookie: aiCookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const session = await (await fetch(`${aiApp.base}/api/session`, { headers: { cookie: aiCookie } })).json();
    assert.equal(session.ai, true);

    const created = await (await fetch(`${aiApp.base}/api/recipes`, json('POST', { url: `${fixtureUrl}/rezept` }))).json();
    const id = created.recipe.id;
    await aiApp.enricher.idle();
    const get = async () => (await (await fetch(`${aiApp.base}/api/recipes/${id}`, { headers: { cookie: aiCookie } })).json()).recipe;

    let recipe = await get();
    assert.equal(recipe.title, 'KI-Titel');
    assert.deepEqual(recipe.ingredients, ['4 Eier (KI)']);
    assert.deepEqual(recipe.categories, ['vegetarisch', 'fruehstueck']);
    assert.equal(recipe.servings, '2 Portionen');
    assert.equal(recipe.analyzedWithAi, true);
    // The AI gets the page's own data and the downloaded preview image.
    assert.equal(aiCalls.at(-1).title, 'Shakshuka mit Feta');
    assert.equal(aiCalls.at(-1).image.mediaType, 'image/png');

    await fetch(`${aiApp.base}/api/recipes/${id}`, json('PATCH', { categories: ['Weihnachten', 'pasta'], title: 'Mein Titel' }));
    const refreshed = await fetch(`${aiApp.base}/api/recipes/${id}/refresh`, json('POST', {}));
    assert.equal(refreshed.status, 202);
    await aiApp.enricher.idle();
    recipe = await get();
    assert.equal(recipe.status, 'done');
    assert.equal(recipe.title, 'KI-Titel');
    assert.deepEqual(recipe.categories, ['vegetarisch', 'fruehstueck', 'Weihnachten']);
  } finally {
    await aiApp.close();
  }
});

test('a failed AI call falls back to keyword categories and is reported', async () => {
  const brokenAi = { model: 'test', analyze: async () => { throw new Error('Netzwerk weg'); } };
  const aiApp = await startApp({ ai: brokenAi });
  try {
    const aiCookie = await login(aiApp.base);
    const created = await (await fetch(`${aiApp.base}/api/recipes`, {
      method: 'POST',
      headers: { cookie: aiCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${fixtureUrl}/caption` }),
    })).json();
    await aiApp.enricher.idle();
    const { recipe } = await (await fetch(`${aiApp.base}/api/recipes/${created.recipe.id}`, { headers: { cookie: aiCookie } })).json();
    assert.equal(recipe.status, 'done');
    assert.ok(recipe.categories.includes('suppen'));
    assert.equal(recipe.analyzedWithAi, false);
    assert.match(recipe.statusDetail, /Netzwerk weg/);
  } finally {
    await aiApp.close();
  }
});

test('links that cannot be loaded are kept and can be completed with a pasted caption', async () => {
  const created = await call('/api/recipes', { method: 'POST', body: { url: `${fixtureUrl}/gibt-es-nicht` } });
  await app.enricher.idle();
  let { recipe } = (await call(`/api/recipes/${created.data.recipe.id}`)).data;
  assert.equal(recipe.status, 'failed');
  assert.match(recipe.statusDetail, /HTTP 404/);
  assert.equal(recipe.title, 'Rezept');

  await call(`/api/recipes/${recipe.id}`, {
    method: 'PATCH',
    body: { caption: 'Overnight Oats mit Beeren\nZutaten:\n50 g Haferflocken\n100 ml Milch' },
  });
  await call(`/api/recipes/${recipe.id}/refresh`, { method: 'POST', body: {} });
  await app.enricher.idle();
  ({ recipe } = (await call(`/api/recipes/${recipe.id}`)).data);
  assert.equal(recipe.status, 'done');
  assert.equal(recipe.title, 'Overnight Oats mit Beeren');
  assert.deepEqual(recipe.ingredients, ['50 g Haferflocken', '100 ml Milch']);
  assert.ok(recipe.categories.includes('fruehstueck'));
  await call(`/api/recipes/${recipe.id}`, { method: 'DELETE' });
});

test('DELETE removes the recipe and its image', async () => {
  const { recipes } = (await call('/api/recipes')).data;
  const target = recipes.find((r) => r.thumbnail);
  const file = path.join(app.dataDir, 'images', path.basename(target.thumbnail));
  assert.ok(existsSync(file));
  assert.equal((await call(`/api/recipes/${target.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/recipes/${target.id}`)).status, 404);
  assert.ok(!existsSync(file));
});

test('export contains all recipes', async () => {
  const res = await call('/api/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.ok(Array.isArray(res.data.recipes) && res.data.recipes.length >= 2);
});

test('static files and app routes are served, traversal is not', async () => {
  const index = await call('/', { auth: false });
  assert.equal(index.status, 200);
  assert.match(index.data, /<title>Rezeptbox<\/title>/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match((await call('/share?url=x', { auth: false })).data, /Rezeptbox/);
  assert.equal((await call('/app.js', { auth: false })).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await call('/manifest.webmanifest', { auth: false })).status, 200);
  assert.equal((await call('/../server/auth.js', { auth: false })).status, 404);
  assert.equal((await call('/%2e%2e/server/auth.js', { auth: false })).status, 404);
  assert.equal((await call('/images/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await call('/healthz', { auth: false })).data, 'ok');
});

test('logout clears the session cookie', async () => {
  const res = await call('/api/logout', { method: 'POST', body: {} });
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});
