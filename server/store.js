import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

// All data lives in one SQL database: SQLite on a normal server (node:sqlite)
// or Cloudflare D1. Both are reached through a tiny driver with the same
// async shape: all(), first(), run() and exec() for a list of statements.

const JSON_FIELDS = ['ingredients', 'steps', 'categories', 'tags'];

// API field name → column name for everything that may be written.
const COLUMNS = {
  url: 'url',
  platform: 'platform',
  title: 'title',
  author: 'author',
  caption: 'caption',
  thumbnail: 'thumbnail',
  ingredients: 'ingredients',
  steps: 'steps',
  categories: 'categories',
  tags: 'tags',
  notes: 'notes',
  favorite: 'favorite',
  cooked: 'cooked',
  prepMinutes: 'prep_minutes',
  servings: 'servings',
  status: 'status',
  statusDetail: 'status_detail',
  analyzedWithAi: 'analyzed_with_ai',
  attempts: 'attempts',
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS recipes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    url              TEXT NOT NULL UNIQUE,
    platform         TEXT NOT NULL DEFAULT 'web',
    title            TEXT,
    author           TEXT,
    caption          TEXT NOT NULL DEFAULT '',
    thumbnail        TEXT,
    ingredients      TEXT NOT NULL DEFAULT '[]',
    steps            TEXT NOT NULL DEFAULT '[]',
    categories       TEXT NOT NULL DEFAULT '[]',
    tags             TEXT NOT NULL DEFAULT '[]',
    notes            TEXT NOT NULL DEFAULT '',
    favorite         INTEGER NOT NULL DEFAULT 0,
    cooked           INTEGER NOT NULL DEFAULT 0,
    prep_minutes     INTEGER,
    servings         TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    status_detail    TEXT,
    analyzed_with_ai INTEGER NOT NULL DEFAULT 0,
    attempts         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  )`,
  // Preview images, base64-encoded so they work the same on every database.
  `CREATE TABLE IF NOT EXISTS images (
    name       TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    data       TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

function toRecipe(row) {
  if (!row) return null;
  const recipe = {
    id: row.id,
    url: row.url,
    platform: row.platform,
    title: row.title,
    author: row.author,
    caption: row.caption,
    thumbnail: row.thumbnail ? `/images/${row.thumbnail}` : null,
    notes: row.notes,
    favorite: Boolean(row.favorite),
    cooked: Boolean(row.cooked),
    prepMinutes: row.prep_minutes,
    servings: row.servings,
    status: row.status,
    statusDetail: row.status_detail,
    analyzedWithAi: Boolean(row.analyzed_with_ai),
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const field of JSON_FIELDS) {
    try {
      recipe[field] = JSON.parse(row[field]);
    } catch {
      recipe[field] = [];
    }
  }
  return recipe;
}

function toColumnValue(field, value) {
  if (JSON_FIELDS.includes(field)) return JSON.stringify(value ?? []);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value ?? null;
}

export async function createStore(sql) {
  await sql.exec(SCHEMA);

  const getRow = (id) => sql.first('SELECT * FROM recipes WHERE id = ?', id);
  const get = async (id) => toRecipe(await getRow(id));

  async function removeImage(name) {
    if (name) await sql.run('DELETE FROM images WHERE name = ?', name);
  }

  return {
    get,
    list: async () => (await sql.all('SELECT * FROM recipes ORDER BY created_at DESC, id DESC')).map(toRecipe),
    findByUrl: async (url) => toRecipe(await sql.first('SELECT * FROM recipes WHERE url = ?', url)),
    pendingIds: async () => (await sql.all("SELECT id FROM recipes WHERE status = 'pending' ORDER BY id")).map((r) => r.id),

    async insert(fields) {
      const now = new Date().toISOString();
      const entries = Object.entries(fields).filter(([key]) => key in COLUMNS);
      const cols = [...entries.map(([key]) => COLUMNS[key]), 'created_at', 'updated_at'];
      const values = [...entries.map(([key, value]) => toColumnValue(key, value)), now, now];
      const { lastRowId } = await sql.run(
        `INSERT INTO recipes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        ...values,
      );
      return get(lastRowId);
    },

    async update(id, fields) {
      const entries = Object.entries(fields).filter(([key, value]) => key in COLUMNS && value !== undefined);
      if (entries.length) {
        const sets = [...entries.map(([key]) => `${COLUMNS[key]} = ?`), 'updated_at = ?'];
        const values = [...entries.map(([key, value]) => toColumnValue(key, value)), new Date().toISOString()];
        await sql.run(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
      }
      return get(id);
    },

    async remove(id) {
      const row = await getRow(id);
      if (!row) return false;
      await sql.run('DELETE FROM recipes WHERE id = ?', id);
      await removeImage(row.thumbnail);
      return true;
    },

    // Stores a new preview image for a recipe and drops the one it replaces.
    async setThumbnail(id, { name, mediaType, data }) {
      const old = (await getRow(id))?.thumbnail;
      await sql.run(
        'INSERT OR REPLACE INTO images (name, media_type, data) VALUES (?, ?, ?)',
        name,
        mediaType,
        Buffer.from(data).toString('base64'),
      );
      await this.update(id, { thumbnail: name });
      if (old && old !== name) await removeImage(old);
    },

    async getImage(name) {
      const row = await sql.first('SELECT media_type, data FROM images WHERE name = ?', name);
      return row ? { mediaType: row.media_type, data: Buffer.from(row.data, 'base64') } : null;
    },

    // Random per-installation key for signing logins, created on first use.
    async secret() {
      const row = await sql.first("SELECT value FROM settings WHERE key = 'secret'");
      if (row) return row.value;
      await sql.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('secret', ?)", randomBytes(32).toString('hex'));
      return (await sql.first("SELECT value FROM settings WHERE key = 'secret'")).value;
    },
  };
}

// Driver for a Cloudflare D1 binding.
export function d1Driver(d1) {
  return {
    exec: async (statements) => {
      await d1.batch(statements.map((statement) => d1.prepare(statement)));
    },
    all: async (query, ...params) => (await d1.prepare(query).bind(...params).all()).results,
    first: async (query, ...params) => d1.prepare(query).bind(...params).first(),
    run: async (query, ...params) => {
      const { meta } = await d1.prepare(query).bind(...params).run();
      return { changes: meta.changes, lastRowId: meta.last_row_id };
    },
  };
}
