import { DatabaseSync } from 'node:sqlite';

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
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recipes (
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
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
`;

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

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const stmts = {
    list: db.prepare('SELECT * FROM recipes ORDER BY created_at DESC, id DESC'),
    get: db.prepare('SELECT * FROM recipes WHERE id = ?'),
    byUrl: db.prepare('SELECT * FROM recipes WHERE url = ?'),
    pending: db.prepare("SELECT id FROM recipes WHERE status = 'pending' ORDER BY id"),
    remove: db.prepare('DELETE FROM recipes WHERE id = ?'),
  };

  return {
    list: () => stmts.list.all().map(toRecipe),
    get: (id) => toRecipe(stmts.get.get(id)),
    // Raw thumbnail file name, which the API representation turns into a URL.
    thumbnailFile: (id) => stmts.get.get(id)?.thumbnail ?? null,
    findByUrl: (url) => toRecipe(stmts.byUrl.get(url)),
    pendingIds: () => stmts.pending.all().map((r) => r.id),

    insert(fields) {
      const now = new Date().toISOString();
      const entries = Object.entries(fields).filter(([key]) => key in COLUMNS);
      const cols = [...entries.map(([key]) => COLUMNS[key]), 'created_at', 'updated_at'];
      const values = [...entries.map(([key, value]) => toColumnValue(key, value)), now, now];
      const result = db
        .prepare(`INSERT INTO recipes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...values);
      return this.get(Number(result.lastInsertRowid));
    },

    update(id, fields) {
      const entries = Object.entries(fields).filter(([key, value]) => key in COLUMNS && value !== undefined);
      if (entries.length) {
        const sets = [...entries.map(([key]) => `${COLUMNS[key]} = ?`), 'updated_at = ?'];
        const values = [...entries.map(([key, value]) => toColumnValue(key, value)), new Date().toISOString()];
        db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      return this.get(id);
    },

    remove: (id) => stmts.remove.run(id).changes > 0,
    close: () => db.close(),
  };
}
