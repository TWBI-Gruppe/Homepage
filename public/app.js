// Rezeptbox – single-page app without build step.

const $ = (selector, root = document) => root.querySelector(selector);

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  heart: '<path d="M12 20.5s-7.5-4.4-9.3-9.2C1.4 7.9 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.7 3.4 4.4 6.8-1.8 4.8-9.3 9.2-9.3 9.2z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.5L20 15"/><path d="M20 20v-5h-5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  flame: '<path d="M12 21c-3.9 0-7-2.8-7-6.6 0-3.5 2.6-5.6 4-8.4.6 1.6 1.3 2.6 2.6 3.4.3-2.6 1.4-4.9 3.4-6.4.2 3.3 4 5.6 4 10.7 0 4.1-3.1 7.3-7 7.3z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
};

function icon(name, size = 22) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PLATFORMS = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  facebook: 'Facebook',
  web: 'Web',
};

const state = {
  recipes: [],
  categories: [],
  ai: false,
  authRequired: false,
  filter: 'all',
  query: '',
  openId: null,
  renderedDetail: null,
  checked: new Map(),
  wakeLock: null,
  installPrompt: null,
  // True when the open recipe was reached from the list, so "back" can use
  // the browser history instead of leaving the app.
  detailFromList: false,
};

// ---------------------------------------------------------------- API

class AuthError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET' && method !== 'DELETE') {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body
  }
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new AuthError(data?.error || 'Bitte anmelden');
  }
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}

function upsertRecipe(recipe) {
  const i = state.recipes.findIndex((r) => r.id === recipe.id);
  if (i >= 0) state.recipes[i] = recipe;
  else state.recipes.unshift(recipe);
}

async function loadRecipes() {
  const data = await api('/api/recipes');
  state.recipes = data.recipes;
  state.categories = data.categories;
  render();
  schedulePolling();
}

// While links are being analysed, refresh until they are done.
let pollTimer = null;
function schedulePolling() {
  clearTimeout(pollTimer);
  if (!state.recipes.some((r) => r.status === 'pending')) return;
  pollTimer = setTimeout(async () => {
    try {
      await loadRecipes();
    } catch {
      schedulePolling();
    }
  }, 2500);
}

// ---------------------------------------------------------------- helpers

function categoryInfo(id) {
  return state.categories.find((c) => c.id === id) || { id, label: id, emoji: '🏷️', custom: true };
}

function allCategoryIds() {
  const custom = new Set();
  for (const r of state.recipes) for (const c of r.categories) if (!state.categories.some((d) => d.id === c)) custom.add(c);
  return [...state.categories.map((c) => c.id), ...[...custom].sort((a, b) => a.localeCompare(b, 'de'))];
}

function platformLabel(recipe) {
  if (recipe.platform !== 'web') return PLATFORMS[recipe.platform] || 'Web';
  try {
    return new URL(recipe.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Web';
  }
}

function formatMinutes(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

const normalize = (text) => String(text ?? '').toLowerCase();

function searchText(recipe) {
  return normalize([
    recipe.title,
    recipe.author,
    recipe.caption,
    recipe.notes,
    recipe.ingredients.join(' '),
    recipe.tags.map((t) => `#${t} ${t}`).join(' '),
    recipe.categories.map((c) => categoryInfo(c).label).join(' '),
  ].join(' '));
}

function filteredRecipes() {
  const words = normalize(state.query).split(/\s+/).filter(Boolean);
  return state.recipes.filter((r) => {
    if (state.filter === 'favorites' && !r.favorite) return false;
    if (state.filter === 'cooked' && !r.cooked) return false;
    if (state.filter === 'uncategorized' && r.categories.length) return false;
    if (state.filter.startsWith('cat:') && !r.categories.includes(state.filter.slice(4))) return false;
    if (words.length) {
      const haystack = searchText(r);
      return words.every((w) => haystack.includes(w));
    }
    return true;
  });
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

function showError(error) {
  if (error instanceof AuthError) return;
  toast(error.message || 'Etwas ist schiefgelaufen');
}

// ---------------------------------------------------------------- list view

function renderChips() {
  const counts = new Map();
  let uncategorized = 0;
  for (const r of state.recipes) {
    if (!r.categories.length) uncategorized++;
    for (const c of r.categories) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const chips = [
    { key: 'all', label: 'Alle', count: state.recipes.length },
    { key: 'favorites', label: '❤️ Favoriten', count: state.recipes.filter((r) => r.favorite).length },
    { key: 'cooked', label: '✅ Nachgekocht', count: state.recipes.filter((r) => r.cooked).length },
    ...allCategoryIds()
      .filter((id) => counts.get(id) || state.filter === `cat:${id}`)
      .map((id) => {
        const c = categoryInfo(id);
        return { key: `cat:${id}`, label: `${c.emoji} ${c.label}`, count: counts.get(id) || 0 };
      }),
  ];
  if (uncategorized || state.filter === 'uncategorized') {
    chips.push({ key: 'uncategorized', label: 'Ohne Kategorie', count: uncategorized });
  }
  $('#chips').innerHTML = chips
    .filter((c) => c.key === 'all' || c.count || state.filter === c.key)
    .map(
      (c) => `<button type="button" class="chip${state.filter === c.key ? ' is-active' : ''}" data-filter="${esc(c.key)}" aria-pressed="${state.filter === c.key}">
        ${esc(c.label)} <span class="chip-count">${c.count}</span></button>`,
    )
    .join('');
}

function cardHtml(r) {
  const pending = r.status === 'pending';
  const firstEmoji = r.categories.length ? categoryInfo(r.categories[0]).emoji : '🍽️';
  const media = r.thumbnail
    ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" decoding="async">`
    : `<div class="card-placeholder" aria-hidden="true">${pending ? '' : esc(firstEmoji)}</div>`;
  const emojis = r.categories.slice(0, 4).map((c) => esc(categoryInfo(c).emoji)).join('');
  return `<a class="card${pending ? ' is-pending' : ''}" href="#/r/${r.id}">
    <div class="card-media">
      ${media}
      <span class="badge badge-${esc(r.platform)}">${esc(platformLabel(r))}</span>
      ${r.favorite ? `<span class="card-fav" title="Favorit">${icon('heart', 18)}</span>` : ''}
      ${pending ? '<span class="card-status"><span class="spinner"></span>Wird analysiert …</span>' : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${esc(r.title || 'Ohne Titel')}</h3>
      <div class="card-meta">
        <span class="card-emojis">${emojis}</span>
        ${r.prepMinutes ? `<span>${icon('clock', 14)} ${esc(formatMinutes(r.prepMinutes))}</span>` : ''}
        ${r.cooked ? `<span class="card-cooked" title="Nachgekocht">${icon('check', 14)}</span>` : ''}
      </div>
    </div>
  </a>`;
}

function renderGrid() {
  const list = filteredRecipes();
  $('#grid').innerHTML = list.map(cardHtml).join('');
  const empty = $('#empty');
  if (!state.recipes.length) {
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-emoji">🍳</div>
      <h2>Noch keine Rezepte</h2>
      <p>Teile ein Rezept-Video aus Instagram oder TikTok mit der Rezeptbox – oder füge einen Link ein.</p>
      <div class="empty-actions">
        <button class="btn btn-primary" type="button" data-action="add">${icon('plus', 18)} Ersten Link einfügen</button>
        <button class="btn btn-soft" type="button" data-open-settings>${icon('phone', 18)} Teilen einrichten</button>
      </div>`;
  } else if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-emoji">🔍</div><h2>Nichts gefunden</h2><p>Versuch es mit einem anderen Suchbegriff oder einer anderen Kategorie.</p>`;
  } else {
    empty.hidden = true;
  }
  const info = $('#result-info');
  info.textContent = state.recipes.length && (state.query || state.filter !== 'all')
    ? `${list.length} von ${state.recipes.length} Rezepten`
    : '';
}

// ---------------------------------------------------------------- detail view

function detailHtml(r) {
  const pending = r.status === 'pending';
  const checked = state.checked.get(r.id) || new Set();
  const needsCaption = !pending && !r.caption && !r.ingredients.length && !r.steps.length;
  const created = new Date(r.createdAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

  const ingredients = r.ingredients.length
    ? `<ul class="ingredients">${r.ingredients
      .map((line, i) => (/:\s*$/.test(line)
        ? `<li class="ingredient-heading">${esc(line)}</li>`
        : `<li><label class="check${checked.has(i) ? ' is-checked' : ''}"><input type="checkbox" data-ingredient="${i}"${checked.has(i) ? ' checked' : ''}><span class="check-box">${icon('check', 14)}</span><span>${esc(line)}</span></label></li>`))
      .join('')}</ul>`
    : `<p class="muted">${pending ? 'Wird gerade ausgelesen …' : 'Keine Zutatenliste gefunden. Schau ins Video oder ergänze sie über „Bearbeiten“.'}</p>`;

  const steps = r.steps.length
    ? `<ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
    : `<p class="muted">${pending ? 'Wird gerade ausgelesen …' : 'Keine Anleitung im Text gefunden.'}</p>`;

  return `
    <div class="detail-bar">
      <a class="icon-btn" href="#" data-action="close" aria-label="Zurück">${icon('back')}</a>
      <span class="detail-bar-title" aria-hidden="true">${esc(r.title || '')}</span>
      <div class="detail-bar-actions">
        <button class="icon-btn${r.favorite ? ' is-fav' : ''}" type="button" data-action="favorite" aria-pressed="${r.favorite}" aria-label="Favorit">${icon('heart')}</button>
        <button class="icon-btn" type="button" data-action="edit" aria-label="Bearbeiten">${icon('edit')}</button>
      </div>
    </div>
    <div class="detail-inner">
      <a class="hero${r.thumbnail ? '' : ' hero-empty'}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">
        ${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="">` : `<span class="hero-emoji">${esc(r.categories.length ? categoryInfo(r.categories[0]).emoji : '🍽️')}</span>`}
        <span class="hero-play">${icon('play', 18)} Original auf ${esc(platformLabel(r))} ansehen</span>
      </a>

      <h1 class="detail-title">${esc(r.title || 'Ohne Titel')}</h1>
      <p class="detail-sub">${r.author ? `von ${esc(r.author)} · ` : ''}${esc(platformLabel(r))} · gespeichert am ${esc(created)}</p>

      ${pending ? `<div class="notice"><span class="spinner"></span> Der Link wird gerade analysiert …</div>` : ''}
      ${!pending && r.statusDetail ? `<div class="notice notice-warn">${esc(r.statusDetail)}</div>` : ''}

      <div class="detail-chips">
        ${r.categories.map((c) => `<button type="button" class="chip chip-small" data-goto-category="${esc(c)}">${esc(categoryInfo(c).emoji)} ${esc(categoryInfo(c).label)}</button>`).join('')}
        ${!r.categories.length && !pending ? '<span class="muted">Noch keine Kategorie – über „Bearbeiten“ festlegen.</span>' : ''}
      </div>

      <div class="facts">
        ${r.prepMinutes ? `<span class="fact">${icon('clock', 18)} ${esc(formatMinutes(r.prepMinutes))}</span>` : ''}
        ${r.servings ? `<span class="fact">${icon('users', 18)} ${esc(r.servings)}</span>` : ''}
        <button type="button" class="fact fact-toggle${r.cooked ? ' is-on' : ''}" data-action="cooked" aria-pressed="${r.cooked}">${icon('check', 18)} ${r.cooked ? 'Nachgekocht' : 'Noch nicht gekocht'}</button>
      </div>

      ${needsCaption ? `
      <div class="card-box">
        <h2>Text aus dem Beitrag einfügen</h2>
        <p class="muted">Die Plattform hat keine Details herausgegeben. Kopiere die Bildunterschrift (in Instagram/TikTok auf den Text tippen, lange drücken → Kopieren) und füge sie hier ein – dann wird das Rezept daraus erstellt.</p>
        <textarea id="caption-input" rows="5" placeholder="Bildunterschrift hier einfügen …"></textarea>
        <button class="btn btn-primary" type="button" data-action="analyze-caption">${icon('sparkles', 18)} Rezept daraus erstellen</button>
      </div>` : ''}

      <section class="section">
        <div class="section-head">
          <h2>Zutaten</h2>
          ${r.ingredients.length ? `<button type="button" class="btn btn-soft btn-small${state.wakeLock ? ' is-on' : ''}" data-action="cook-mode" title="Bildschirm bleibt an">${icon('flame', 16)} ${state.wakeLock ? 'Kochmodus an' : 'Kochmodus'}</button>` : ''}
        </div>
        ${ingredients}
      </section>

      <section class="section">
        <h2>Zubereitung</h2>
        ${steps}
      </section>

      <section class="section">
        <h2>Notizen</h2>
        <textarea id="notes-input" class="notes" rows="3" placeholder="Eigene Notizen, z. B. „doppelte Menge Knoblauch“">${esc(r.notes)}</textarea>
        <p class="save-state" id="notes-state" aria-live="polite"></p>
      </section>

      ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<button type="button" class="tag" data-search="#${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}

      ${r.caption ? `<details class="section caption"><summary>Originaltext</summary><p>${esc(r.caption)}</p></details>` : ''}

      <div class="detail-actions">
        <button class="btn btn-soft" type="button" data-action="edit">${icon('edit', 18)} Bearbeiten</button>
        <button class="btn btn-soft" type="button" data-action="refresh"${pending ? ' disabled' : ''}>${icon('refresh', 18)} Neu analysieren</button>
        <button class="btn btn-danger" type="button" data-action="delete">${icon('trash', 18)} Löschen</button>
      </div>
      ${r.analyzedWithAi ? `<p class="ai-note">${icon('sparkles', 14)} Mit KI ausgelesen – bitte Mengen kurz gegenchecken.</p>` : ''}
    </div>`;
}

function renderDetail({ force = false } = {}) {
  const section = $('#detail');
  const recipe = state.recipes.find((r) => r.id === state.openId);
  if (!recipe) {
    if (!section.hidden) {
      section.hidden = true;
      document.body.classList.remove('has-overlay');
    }
    state.renderedDetail = null;
    return;
  }
  // Don't clobber the notes field while the user is typing in it.
  const typing = section.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
  const key = `${recipe.id}:${recipe.updatedAt}:${state.wakeLock ? 1 : 0}`;
  if (!force && (state.renderedDetail === key || typing)) return;
  const opening = section.hidden || !state.renderedDetail?.startsWith(`${recipe.id}:`);
  section.innerHTML = detailHtml(recipe);
  state.renderedDetail = key;
  if (section.hidden) {
    section.hidden = false;
    document.body.classList.add('has-overlay');
  }
  if (opening) section.scrollTop = 0;
  updateDetailBar();
}

// Once the photo has scrolled away, the floating buttons get a solid bar.
function updateDetailBar() {
  const section = $('#detail');
  const hero = section.querySelector('.hero');
  const limit = hero ? hero.offsetHeight - 70 : 0;
  section.classList.toggle('is-scrolled', section.scrollTop > limit);
}

function render() {
  renderChips();
  renderGrid();
  renderDetail();
}

async function patchRecipe(id, changes) {
  const { recipe } = await api(`/api/recipes/${id}`, { method: 'PATCH', body: changes });
  upsertRecipe(recipe);
  return recipe;
}

let notesTimer = null;
async function saveNotes(id, value) {
  const stateEl = $('#notes-state');
  try {
    const recipe = await patchRecipe(id, { notes: value });
    // Keep the textarea as it is; only remember the new version.
    state.renderedDetail = `${recipe.id}:${recipe.updatedAt}:${state.wakeLock ? 1 : 0}`;
    renderGrid();
    if (stateEl) stateEl.textContent = 'Gespeichert';
  } catch (error) {
    showError(error);
  }
}

async function toggleWakeLock() {
  if (state.wakeLock) {
    await state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  } else if ('wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
        renderDetail({ force: true });
      });
      toast('Kochmodus: Der Bildschirm bleibt an');
    } catch {
      toast('Kochmodus wird auf diesem Gerät nicht unterstützt');
    }
  } else {
    toast('Kochmodus wird auf diesem Gerät nicht unterstützt');
  }
  renderDetail({ force: true });
}

async function onDetailClick(event) {
  const recipe = state.recipes.find((r) => r.id === state.openId);
  if (!recipe) return;
  const target = event.target.closest('[data-action], [data-goto-category], [data-search]');
  if (!target) return;

  if (target.dataset.gotoCategory) {
    state.filter = `cat:${target.dataset.gotoCategory}`;
    state.query = '';
    $('#search').value = '';
    closeDetail();
    return;
  }
  if (target.dataset.search) {
    state.query = target.dataset.search;
    state.filter = 'all';
    $('#search').value = state.query;
    closeDetail();
    return;
  }

  const action = target.dataset.action;
  try {
    if (action === 'close') {
      event.preventDefault();
      closeDetail();
    } else if (action === 'favorite' || action === 'cooked') {
      await patchRecipe(recipe.id, { [action]: !recipe[action] });
      renderDetail({ force: true });
      renderChips();
      renderGrid();
    } else if (action === 'edit') {
      openEdit(recipe);
    } else if (action === 'cook-mode') {
      await toggleWakeLock();
    } else if (action === 'refresh') {
      const { recipe: updated } = await api(`/api/recipes/${recipe.id}/refresh`, { method: 'POST' });
      upsertRecipe(updated);
      render();
      schedulePolling();
    } else if (action === 'analyze-caption') {
      const caption = $('#caption-input').value.trim();
      if (!caption) {
        toast('Bitte zuerst den Text einfügen');
        return;
      }
      await patchRecipe(recipe.id, { caption });
      const { recipe: updated } = await api(`/api/recipes/${recipe.id}/refresh`, { method: 'POST' });
      upsertRecipe(updated);
      render();
      schedulePolling();
    } else if (action === 'delete') {
      if (!confirm(`„${recipe.title || 'Dieses Rezept'}“ wirklich löschen?`)) return;
      await api(`/api/recipes/${recipe.id}`, { method: 'DELETE' });
      state.recipes = state.recipes.filter((r) => r.id !== recipe.id);
      closeDetail();
      toast('Rezept gelöscht');
    }
  } catch (error) {
    showError(error);
  }
}

function onDetailChange(event) {
  const box = event.target.closest('[data-ingredient]');
  if (!box) return;
  const set = state.checked.get(state.openId) || new Set();
  const i = Number(box.dataset.ingredient);
  if (box.checked) set.add(i);
  else set.delete(i);
  state.checked.set(state.openId, set);
  box.closest('.check').classList.toggle('is-checked', box.checked);
}

function onDetailInput(event) {
  if (event.target.id !== 'notes-input') return;
  const id = state.openId;
  const value = event.target.value;
  // Keep the local copy current so a re-render never shows stale notes.
  const recipe = state.recipes.find((r) => r.id === id);
  if (recipe) recipe.notes = value;
  $('#notes-state').textContent = '…';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => saveNotes(id, value), 700);
}

// ---------------------------------------------------------------- routing

function closeDetail() {
  if (state.detailFromList) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    route();
  }
}

function onHashChange(event) {
  const wasDetail = /#\/r\//.test(new URL(event.oldURL).hash);
  const isDetail = location.hash.startsWith('#/r/');
  if (isDetail && !wasDetail) state.detailFromList = true;
  if (!isDetail) state.detailFromList = false;
  route();
}

function route() {
  const m = location.hash.match(/^#\/r\/(\d+)/);
  state.openId = m ? Number(m[1]) : null;
  if (!m && state.wakeLock) toggleWakeLock();
  render();
}

// ---------------------------------------------------------------- add / edit / settings dialogs

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function openAdd(prefill = '') {
  $('#add-url').value = prefill;
  $('#add-notes').value = '';
  $('#add-error').hidden = true;
  openDialog($('#add-dialog'));
  if (!prefill) setTimeout(() => $('#add-url').focus(), 50);
}

async function saveLink({ url, text, title, notes }) {
  const result = await api('/api/recipes', { method: 'POST', body: { url, text, title, notes } });
  upsertRecipe(result.recipe);
  render();
  schedulePolling();
  toast(result.duplicate ? 'Dieses Rezept ist schon gespeichert' : 'Gespeichert – wird analysiert …');
  return result;
}

async function onAddSubmit(event) {
  event.preventDefault();
  const error = $('#add-error');
  error.hidden = true;
  const button = event.submitter || $('#add-form button[type=submit]');
  button.disabled = true;
  try {
    const { recipe } = await saveLink({ url: $('#add-url').value.trim(), notes: $('#add-notes').value.trim() });
    $('#add-dialog').close();
    location.hash = `#/r/${recipe.id}`;
  } catch (err) {
    if (err instanceof AuthError) return;
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) $('#add-url').value = text.trim();
    else toast('Die Zwischenablage ist leer');
  } catch {
    toast('Kein Zugriff auf die Zwischenablage – bitte lange tippen und „Einfügen“ wählen');
    $('#add-url').focus();
  }
}

let editing = null;

function renderEditCategories() {
  const ids = [...new Set([...allCategoryIds(), ...editing.categories])];
  $('#edit-categories').innerHTML = ids
    .map((id) => {
      const c = categoryInfo(id);
      const on = editing.categories.includes(id);
      return `<button type="button" class="choice${on ? ' is-on' : ''}" data-category="${esc(id)}" aria-pressed="${on}">${esc(c.emoji)} ${esc(c.label)}</button>`;
    })
    .join('');
}

function openEdit(recipe) {
  editing = { id: recipe.id, categories: [...recipe.categories] };
  $('#edit-title').value = recipe.title || '';
  $('#edit-minutes').value = recipe.prepMinutes ?? '';
  $('#edit-servings').value = recipe.servings ?? '';
  $('#edit-ingredients').value = recipe.ingredients.join('\n');
  $('#edit-steps').value = recipe.steps.join('\n');
  $('#edit-caption').value = recipe.caption || '';
  $('#edit-new-category').value = '';
  $('#edit-error').hidden = true;
  renderEditCategories();
  openDialog($('#edit-dialog'));
}

function addCustomCategory() {
  const input = $('#edit-new-category');
  const name = input.value.trim().slice(0, 40);
  if (!name) return;
  const existing = allCategoryIds().find((id) => categoryInfo(id).label.toLowerCase() === name.toLowerCase());
  const id = existing || name;
  if (!editing.categories.includes(id)) editing.categories.push(id);
  input.value = '';
  renderEditCategories();
}

async function onEditSubmit(event) {
  event.preventDefault();
  const lines = (value) => value.split('\n').map((l) => l.trim()).filter(Boolean);
  const minutes = $('#edit-minutes').value.trim();
  try {
    await patchRecipe(editing.id, {
      title: $('#edit-title').value.trim(),
      categories: editing.categories,
      prepMinutes: minutes ? Math.max(0, Math.round(Number(minutes))) || null : null,
      servings: $('#edit-servings').value.trim() || null,
      ingredients: lines($('#edit-ingredients').value),
      steps: lines($('#edit-steps').value),
      caption: $('#edit-caption').value.trim(),
    });
    $('#edit-dialog').close();
    renderDetail({ force: true });
    renderChips();
    renderGrid();
    toast('Gespeichert');
  } catch (error) {
    if (error instanceof AuthError) return;
    $('#edit-error').textContent = error.message;
    $('#edit-error').hidden = false;
  }
}

function copyButton(value, label) {
  return `<span class="copy-row"><code>${esc(value)}</code><button class="btn btn-soft btn-small" type="button" data-copy="${esc(value)}" aria-label="${esc(label)} kopieren">${icon('copy', 16)} Kopieren</button></span>`;
}

async function openSettings() {
  const dialog = $('#settings-dialog');
  let setup = { endpoint: `${location.origin}/api/recipes`, apiToken: null };
  try {
    setup = await api('/api/setup');
  } catch (error) {
    showError(error);
    if (error instanceof AuthError) return;
  }
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  const android = `
    <section class="setup">
      <h3>Android</h3>
      <ol>
        <li>Rezeptbox in <strong>Chrome</strong> öffnen, Menü <strong>⋮</strong> → <strong>„App installieren“</strong> bzw. „Zum Startbildschirm hinzufügen“.${state.installPrompt ? ` <button class="btn btn-primary btn-small" type="button" data-action="install">Jetzt installieren</button>` : ''}</li>
        <li>In Instagram oder TikTok beim Rezept auf <strong>Teilen</strong> tippen (bei TikTok ggf. „Mehr“).</li>
        <li><strong>Rezeptbox</strong> auswählen – fertig. Das Rezept wird gespeichert und automatisch einsortiert.</li>
      </ol>
    </section>`;

  const ios = `
    <section class="setup">
      <h3>iPhone &amp; iPad</h3>
      <p class="muted">iOS lässt Web-Apps nicht direkt ins Teilen-Menü. Ein Kurzbefehl übernimmt das – einmal einrichten, ca. 3 Minuten:</p>
      <ol>
        <li>App <strong>Kurzbefehle</strong> öffnen → <strong>+</strong> → Name: <em>„In Rezeptbox speichern“</em>.</li>
        <li>Unten auf <strong>ⓘ</strong> (Details) → <strong>„Im Share-Sheet anzeigen“</strong> einschalten. Bei „Empfängt“ nur <em>URLs</em> und <em>Text</em> anhaken.</li>
        <li>Aktion <strong>„Inhalte von URL abrufen“</strong> hinzufügen und die URL eintragen:<br>${copyButton(setup.endpoint, 'Adresse')}</li>
        <li>In der Aktion auf <strong>„Mehr anzeigen“</strong>: Methode <strong>POST</strong>.${setup.apiToken ? ` Unter <strong>Header</strong> hinzufügen: Schlüssel <code>Authorization</code>, Wert:<br>${copyButton(`Bearer ${setup.apiToken}`, 'Header-Wert')}` : ''}</li>
        <li><strong>Anfragetext: JSON</strong> → Feld hinzufügen: Typ <em>Text</em>, Schlüssel <code>url</code>, Wert: Variable <strong>Kurzbefehleingabe</strong>.</li>
        <li>Optional: Aktion <strong>„Mitteilung anzeigen“</strong> mit „Rezept gespeichert ✅“ anhängen.</li>
        <li>In Instagram/TikTok: <strong>Teilen</strong> → „Teilen über …“ bzw. „Mehr“ → <strong>In Rezeptbox speichern</strong>.</li>
      </ol>
      <p class="muted">Zusätzlich praktisch: In Safari über <strong>Teilen → „Zum Home-Bildschirm“</strong> die Rezeptbox als App aufs iPhone legen.</p>
    </section>`;

  const fallback = `
    <section class="setup">
      <h3>Überall: Link kopieren</h3>
      <p class="muted">In Instagram/TikTok <strong>„Link kopieren“</strong> wählen, Rezeptbox öffnen, auf <strong>+ Rezept</strong> und <strong>Einfügen</strong> tippen.</p>
    </section>`;

  $('#settings-content').innerHTML = `
    <header class="sheet-head">
      <h2>Rezepte aus Instagram &amp; TikTok schicken</h2>
      <button class="icon-btn" type="button" data-close aria-label="Schließen">${icon('close')}</button>
    </header>
    ${isIos ? ios + android : android + ios}
    ${fallback}
    <section class="setup">
      <h3>Automatisch sortieren</h3>
      <p class="muted">${state.ai
        ? `${icon('sparkles', 16)} KI-Analyse ist aktiv: Titel, Zutaten, Schritte und Kategorien werden aus dem Beitragstext und Vorschaubild erstellt.`
        : 'Kategorien werden anhand von Stichwörtern und Hashtags vergeben. Für bessere Ergebnisse (Zutaten, Schritte, saubere Titel) kann die KI-Analyse mit einem Anthropic-API-Schlüssel aktiviert werden – siehe README.'}</p>
    </section>
    <div class="sheet-actions sheet-actions-split">
      <a class="btn btn-soft" href="/api/export" download>${icon('download', 18)} Sicherung herunterladen</a>
      ${state.authRequired ? `<button class="btn btn-ghost" type="button" data-action="logout">${icon('logout', 18)} Abmelden</button>` : ''}
    </div>
    ${standalone ? '' : '<p class="hint">Tipp: Als App installiert startet die Rezeptbox ohne Browserleiste.</p>'}`;
  openDialog(dialog);
}

async function onSettingsClick(event) {
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast('Kopiert');
    } catch {
      toast('Kopieren nicht möglich – bitte manuell markieren');
    }
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'install' && state.installPrompt) {
    state.installPrompt.prompt();
    state.installPrompt = null;
  } else if (action === 'logout') {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    $('#settings-dialog').close();
    showLogin();
  }
}

// ---------------------------------------------------------------- login & startup

function showLogin() {
  clearTimeout(pollTimer);
  $('#main-view').hidden = true;
  $('#detail').hidden = true;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('#login-view').hidden = false;
  setTimeout(() => $('#login-password').focus(), 50);
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const error = $('#login-error');
  error.hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#login-password').value } });
    $('#login-password').value = '';
    $('#login-view').hidden = true;
    await start();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

// Android share sheet (Web Share Target) opens /share?title=…&text=…&url=…
async function handleShareTarget() {
  if (location.pathname !== '/share') return;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', '/');
  try {
    const { recipe } = await saveLink({
      url: params.get('url') || '',
      text: params.get('text') || '',
      title: params.get('title') || '',
    });
    location.hash = `#/r/${recipe.id}`;
  } catch (error) {
    if (error instanceof AuthError) return;
    openAdd([params.get('url'), params.get('text')].filter(Boolean).join(' '));
    showError(error);
  }
}

let started = false;
function bindEvents() {
  if (started) return;
  started = true;

  $('#random-btn').innerHTML = icon('shuffle');
  $('#settings-btn').innerHTML = icon('settings');
  $('.search-icon').innerHTML = icon('search', 18);
  $('.fab-icon').innerHTML = icon('plus', 20);
  document.querySelectorAll('[data-close]').forEach((b) => { if (!b.textContent.trim()) b.innerHTML = icon('close'); });

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderGrid();
  });
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = state.filter === chip.dataset.filter ? 'all' : chip.dataset.filter;
    renderChips();
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#add-btn').addEventListener('click', () => openAdd());
  $('#random-btn').addEventListener('click', () => {
    const list = filteredRecipes().filter((r) => r.status !== 'pending');
    if (!list.length) return toast('Noch keine Rezepte zum Auswürfeln');
    location.hash = `#/r/${list[Math.floor(Math.random() * list.length)].id}`;
  });
  $('#settings-btn').addEventListener('click', openSettings);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-settings]')) {
      $('#add-dialog').close();
      openSettings();
    } else if (e.target.closest('[data-action="add"]') && !e.target.closest('#detail')) {
      openAdd();
    } else if (e.target.closest('[data-close]')) {
      e.target.closest('dialog')?.close();
    }
  });
  // Tap on the dimmed backdrop closes a dialog.
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  $('#add-form').addEventListener('submit', onAddSubmit);
  $('#paste-btn').addEventListener('click', pasteFromClipboard);
  $('#edit-form').addEventListener('submit', onEditSubmit);
  $('#edit-add-category').addEventListener('click', addCustomCategory);
  $('#edit-new-category').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomCategory();
    }
  });
  $('#edit-categories').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    const id = btn.dataset.category;
    editing.categories = editing.categories.includes(id)
      ? editing.categories.filter((c) => c !== id)
      : [...editing.categories, id];
    renderEditCategories();
  });
  $('#settings-dialog').addEventListener('click', onSettingsClick);

  const detail = $('#detail');
  detail.addEventListener('click', onDetailClick);
  detail.addEventListener('change', onDetailChange);
  detail.addEventListener('input', onDetailInput);
  detail.addEventListener('scroll', updateDetailBar, { passive: true });
  detail.addEventListener('focusout', (e) => {
    if (e.target.id === 'notes-input' && notesTimer) {
      clearTimeout(notesTimer);
      notesTimer = null;
      saveNotes(state.openId, e.target.value);
    }
  });

  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('#main-view').hidden) loadRecipes().catch(() => {});
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.openId && !document.querySelector('dialog[open]')) closeDetail();
  });
}

async function start() {
  bindEvents();
  const session = await api('/api/session');
  state.authRequired = session.authRequired;
  state.ai = session.ai;
  if (session.authRequired && !session.authenticated) {
    showLogin();
    return;
  }
  $('#login-view').hidden = true;
  $('#main-view').hidden = false;
  await loadRecipes();
  await handleShareTarget();
  route();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

$('#login-form').addEventListener('submit', onLoginSubmit);
start().catch((error) => {
  if (error instanceof AuthError) return;
  document.body.innerHTML = `<div class="fatal"><h1>Rezeptbox ist gerade nicht erreichbar</h1><p>${esc(error.message)}</p><button class="btn btn-primary" type="button">Neu laden</button></div>`;
  $('.fatal button').addEventListener('click', () => location.reload());
});
