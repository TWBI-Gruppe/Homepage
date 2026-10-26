// Small, dependency-free helpers for pulling data out of shared text, HTML
// pages and recipe captions.

const URL_RE = /https?:\/\/[^\s<>"'`]+/i;

// Share sheets hand over all kinds of shapes: a bare URL, "Look at this! https://…",
// or title/text/url split over separate fields.
export function findUrl(...inputs) {
  for (const input of inputs) {
    if (!input) continue;
    const m = String(input).match(URL_RE);
    if (m) return m[0].replace(/[),.;!?]+$/, '');
  }
  return null;
}

const TRACKING_PARAMS = [
  /^utm_/, /^igsh$/, /^igshid$/, /^_t$/, /^_r$/, /^is_from_webapp$/, /^sender_device$/, /^web_id$/,
  /^share_/, /^fbclid$/, /^si$/, /^feature$/, /^ref$/, /^tt_from$/, /^u_code$/, /^user_id$/,
  /^checksum$/, /^sec_user_id$/, /^sec_uid$/, /^social_sharing$/, /^mibextid$/, /^rdt$/, /^img_index$/,
];

export function detectPlatform(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return 'web';
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return 'instagram';
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  if (host.startsWith('pinterest.') || host.includes('.pinterest.') || host === 'pin.it') return 'pinterest';
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook';
  return 'web';
}

// Short links that have to be followed before the real post URL is known.
export function isShortLink(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ['vm.tiktok.com', 'vt.tiktok.com', 'pin.it', 'fb.watch'].includes(host)
      || (host.endsWith('tiktok.com') && /^\/t\//.test(new URL(url).pathname))
      || (host.endsWith('facebook.com') && /^\/share\//.test(new URL(url).pathname));
  } catch {
    return false;
  }
}

// Canonical form used for de-duplication: same post shared twice → same URL.
export function normalizeUrl(raw) {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname === 'm.tiktok.com') url.hostname = 'www.tiktok.com';
  if (url.hostname === 'instagram.com' || url.hostname === 'm.instagram.com') url.hostname = 'www.instagram.com';

  const platform = detectPlatform(url.href);
  if (platform === 'instagram') {
    const m = url.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    if (m) return `https://www.instagram.com/${m[1] === 'p' || m[1] === 'tv' ? 'p' : 'reel'}/${m[2]}/`;
  }
  if (platform === 'tiktok') {
    const m = url.pathname.match(/^\/(@[\w.-]+)\/(video|photo)\/(\d+)/);
    if (m) return `https://www.tiktok.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  if (platform === 'youtube') {
    const id = url.hostname === 'youtu.be'
      ? url.pathname.slice(1)
      : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  let out = url.href;
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(str = '') {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function parseAttributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

// og:*, twitter:* and plain <meta name=…> values, keyed by lower-cased name.
export function parseMeta(html = '') {
  const meta = {};
  // Preview tags live in <head>; skipping the (often huge) body saves CPU time.
  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd > 0) html = html.slice(0, headEnd);
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content != null && !(key in meta)) meta[key] = attrs.content;
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) meta['html:title'] = decodeEntities(title[1].trim());
  return meta;
}

// ISO-8601 durations as used by schema.org ("PT1H30M") → minutes.
export function isoDurationToMinutes(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const minutes = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
  return minutes > 0 ? minutes : null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecipeNode(node) {
  return node && typeof node === 'object' && asArray(node['@type']).some((t) => String(t).toLowerCase() === 'recipe');
}

function findRecipeNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (isRecipeNode(node)) return node;
  const children = Array.isArray(node) ? node : [node['@graph'], node.mainEntity, node.mainEntityOfPage].filter(Boolean);
  for (const child of children.flat()) {
    const found = findRecipeNode(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function stripTags(str) {
  return decodeEntities(String(str).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
}

function flattenInstructions(value) {
  const steps = [];
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      steps.push(...stripTags(item).split(/\n+/));
    } else if (item && typeof item === 'object') {
      if (item.itemListElement) steps.push(...flattenInstructions(item.itemListElement));
      else if (item.text) steps.push(stripTags(item.text));
      else if (item.name) steps.push(stripTags(item.name));
    }
  }
  return steps.map((s) => s.trim()).filter(Boolean);
}

function pickImage(value) {
  for (const img of asArray(value)) {
    if (typeof img === 'string') return img;
    if (img?.url) return img.url;
  }
  return null;
}

// schema.org/Recipe from JSON-LD, which most recipe blogs embed.
export function parseJsonLdRecipe(html = '') {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const recipe = findRecipeNode(data);
    if (!recipe) continue;
    const author = asArray(recipe.author).map((a) => (typeof a === 'string' ? a : a?.name)).find(Boolean);
    const yieldValue = asArray(recipe.recipeYield).find((y) => y != null && y !== '');
    return {
      title: recipe.name ? stripTags(recipe.name) : null,
      description: recipe.description ? stripTags(recipe.description) : null,
      author: author || null,
      image: pickImage(recipe.image),
      ingredients: asArray(recipe.recipeIngredient || recipe.ingredients).map(stripTags).filter(Boolean),
      steps: flattenInstructions(recipe.recipeInstructions),
      prepMinutes: isoDurationToMinutes(recipe.totalTime)
        ?? ((isoDurationToMinutes(recipe.prepTime) ?? 0) + (isoDurationToMinutes(recipe.cookTime) ?? 0) || null),
      servings: yieldValue != null ? String(yieldValue) : null,
      keywords: asArray(recipe.keywords).join(',').split(',').map((k) => k.trim()).filter(Boolean),
      category: asArray(recipe.recipeCategory).join(', '),
    };
  }
  return null;
}

const INGREDIENT_HEADINGS = /^(zutaten|ingredients?|du brauchst|ihr braucht|you(?:'ll)? need|einkaufsliste|was du brauchst)\b/i;
const STEP_HEADINGS = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|instructions?|method|directions|steps|preparation|how to make( it)?|schritte)\b/i;
// Bullets, "1." / "1)" numbering, keycap digits like 1️⃣ and leading emoji.
const BULLET = /^\s*(?:[-–—•·*▪︎▫️●○◦✔✅☑️➡️👉🔸🔹⭐️]+|\d{1,2}[.)]|\d️?⃣|\p{Extended_Pictographic}️?)\s*/u;
// "Prep Time: 15 minutes", "Portionen: 4" and similar fact lines.
const TIME_LINE = /^(total time|gesamtzeit|prep(?:aration)? time|zubereitungszeit|arbeitszeit|vorbereitung(?:szeit)?|cook(?:ing)? time|kochzeit|backzeit|garzeit)\s*:\s*(.+)$/i;
const SERVINGS_LINE = /^(servings|serves|portionen|portion|yield|ergibt|menge)\s*:\s*(.+)$/i;
// Nutrition facts and the usual "follow me / ad" outro are not part of the recipe.
const NUTRITION_LINE = /^(nährwerte?|naehrwerte?|nährwertangaben|makros|macros|nutrition(?: facts)?|kalorien|calories)\b|\b\d+\s*kcal\b/i;
const OUTRO_LINE = /^(folge|folgt|follow|link in|mehr rezepte|more recipes|speicher|save (?:this|for)|teile|share|werbung|anzeige|rabatt|code\b|tag (?:a|someone)|markiere|kommentier|comment)/i;
// Lines in an ingredient list that are really instructions.
const INSTRUCTION_WORDS = /\b(vorheizen|preheat|backen|bake|braten|anbraten|kochen|köcheln|rühren|verrühren|mischen|vermischen|vermengen|geben|schneiden|würzen|servieren|serve|mix|stir|cook|fry|heat)\b/i;

function cleanLine(line) {
  return line
    .replace(BULLET, '')
    .replace(/@[\w.]+\*?/g, '')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([.,;:!?])(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Zutaten:" may be followed by items on the same line; a heading without a
// colon only counts when the line is short.
function sectionHeading(line) {
  const plain = cleanLine(line).replace(/^[^\p{L}]+/u, '');
  const colon = plain.indexOf(':');
  const head = colon >= 0 ? plain.slice(0, colon).trim() : plain;
  if (head.length > 40 || (colon < 0 && plain.length > 40)) return null;
  const rest = colon >= 0 ? plain.slice(colon + 1).replace(/[^\p{L}\p{N}]+$/u, '').trim() : '';
  if (INGREDIENT_HEADINGS.test(head)) return { section: 'ingredients', head, rest };
  if (STEP_HEADINGS.test(head)) return { section: 'steps', head, rest };
  return null;
}

// "15 minutes", "1 Std. 20 Min.", "1 hour" → minutes
function durationToMinutes(text) {
  const hours = Number(text.match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|std|stunde|hour|hr)/i)?.[1]?.replace(',', '.') ?? 0);
  const minutes = Number(text.match(/(\d+)\s*(?:min|minute)/i)?.[1] ?? 0);
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

// "Zutaten für 8 Stück" / "Zutaten (2 Portionen)" → "8 Stück" / "2 Portionen"
function servingsFromHeading(head) {
  const m = head.match(/\((\d+[^)]*)\)/) || head.match(/\b(?:für|for)\s+(\d+(?:\s+[\p{L}]+)?)/iu);
  return m ? m[1].trim() : null;
}

// The part of a caption before its ingredient list or instructions – what the
// post is about, without every ingredient that happens to be in it.
export function captionIntro(caption = '') {
  const intro = [];
  for (const line of caption.split('\n')) {
    if (sectionHeading(line)) break;
    intro.push(line);
  }
  return intro.join('\n');
}

// Many TikTok/Instagram captions contain the whole recipe in a loose
// "Zutaten: … Zubereitung: …" layout. This picks it up without AI, along with
// stated times and servings, and leaves out nutrition facts and outros.
export function parseRecipeFromCaption(caption = '') {
  const lines = caption.replace(/\r/g, '').split('\n');
  const ingredients = [];
  const steps = [];
  const times = {};
  let servings = null;
  let section = null;
  // Whether the current ingredient list marks its items with bullets; then
  // unmarked lines in between are notes or instructions, not ingredients.
  let bulleted = null;

  const addStep = (text) => {
    const previous = steps.at(-1);
    // "Backofen vorheizen:" followed by the details belongs together.
    if (previous?.endsWith(':')) steps[steps.length - 1] = `${previous} ${text}`;
    else steps.push(text);
  };

  const isBulletLine = (line) => BULLET.test(line) && !/^\d{1,2}[.)]/.test(line);
  const nextLine = (i) => lines.slice(i + 1).find((l) => l.trim())?.trim() ?? '';

  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const heading = sectionHeading(line);
    if (heading) {
      section = heading.section;
      bulleted = null;
      if (section === 'ingredients') {
        servings ||= servingsFromHeading(heading.head);
        if (heading.rest) ingredients.push(...heading.rest.split(/,\s*/).map(cleanLine).filter(Boolean));
      } else if (heading.rest) {
        addStep(cleanLine(heading.rest));
      }
      continue;
    }
    // A block of hashtags ends the recipe part of a caption.
    if (/^(#[\p{L}\p{N}_]+\s*)+$/u.test(line)) {
      section = null;
      continue;
    }

    const cleaned = cleanLine(line).replace(/(?:\s*#[\p{L}\p{N}_]+)+$/u, '').trim();
    const endsWithTags = /#[\p{L}\p{N}_]+\s*$/u.test(line);
    const plain = cleaned.replace(/^[^\p{L}\p{N}(]+/u, '');

    const time = plain.match(TIME_LINE);
    const serving = plain.match(SERVINGS_LINE);
    if (time || serving) {
      if (time) times[/total|gesamt/i.test(time[1]) ? 'total' : /cook|koch|back|gar/i.test(time[1]) ? 'cook' : 'prep'] = durationToMinutes(time[2]);
      if (serving) servings ||= serving[2].trim();
    } else if (OUTRO_LINE.test(plain)) {
      section = null;
    } else if (NUTRITION_LINE.test(plain)) {
      // skip the nutrition table, but keep reading: a recipe may follow
    } else if (cleaned && section === 'ingredients') {
      const isBullet = isBulletLine(line);
      const parenthetical = /^\(.*\)$/.test(cleaned);
      const subheading = cleaned.endsWith(':') && cleaned.length <= 40;
      if (!subheading && !parenthetical) bulleted ??= isBullet;
      if (parenthetical && cleaned.length <= 40 && ingredients.length && !ingredients.at(-1).endsWith(':')) {
        ingredients[ingredients.length - 1] += ` ${cleaned}`;
      } else if (parenthetical) {
        addStep(cleaned.slice(1, -1).trim());
      } else if (subheading && !(bulleted && isBulletLine(nextLine(i))) && INSTRUCTION_WORDS.test(cleaned)) {
        // "Backofen vorheizen:" is an instruction; "Nach dem Backen:" followed
        // by more bullet points is a group of ingredients.
        addStep(cleaned);
      } else if (subheading) {
        // A new group ("Für die Sauce:") may use its own list style.
        ingredients.push(cleaned);
        bulleted = null;
      } else if (isBullet || !bulleted) {
        ingredients.push(cleaned);
      } else {
        addStep(cleaned);
      }
    } else if (cleaned && section === 'steps') {
      addStep(cleaned);
    }
    if (endsWithTags) section = null;
  }

  const prepMinutes = times.total ?? (times.prep || times.cook ? (times.prep ?? 0) + (times.cook ?? 0) : null);
  return {
    // A trailing sub-heading without items ("Zum Servieren:") is noise.
    ingredients: ingredients.filter((l, i, all) => l.length <= 200 && !(l.endsWith(':') && i === all.length - 1)).slice(0, 60),
    steps: steps.filter((l) => l.length <= 1000).slice(0, 40),
    prepMinutes,
    servings,
  };
}

const AD_PREFIX = /^\s*(?:[*[(]?\s*(?:anzeige|werbung|ad|sponsored|unbezahlte werbung)\s*[*\])]?\s*[|:–—-]\s*)+/i;

// SHOUTING TITLES → Shouting Titles
function calmCaps(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length < 6 || upper.length / letters.length < 0.8) return text;
  return text.toLowerCase().replace(/(^|[\s\-–—/(&+])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// First sensible line of a caption, without hashtags and ad labels, as a
// fallback title.
export function titleFromCaption(caption = '') {
  for (const raw of caption.split('\n')) {
    const line = calmCaps(
      raw.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/@[\w.]+/g, '').replace(AD_PREFIX, '').replace(/\s+/g, ' ').trim(),
    );
    if (line.replace(/[^\p{L}]/gu, '').length >= 3) {
      return line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line;
    }
  }
  return null;
}
