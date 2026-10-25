import { Buffer } from 'node:buffer';
import {
  decodeEntities,
  detectPlatform,
  isShortLink,
  normalizeUrl,
  parseJsonLdRecipe,
  parseMeta,
  titleFromCaption,
} from './parse.js';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
// Instagram only serves preview tags (caption, image) to link-preview crawlers.
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const isIPv4 = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
const isIPv6 = (host) => host.includes(':');

function isPrivateAddress(address) {
  if (isIPv6(address)) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

// The server fetches URLs that users send it, so keep it away from the
// local network unless explicitly allowed (tests, self-hosted setups).
// `resolveHost` (hostname → IP list) is passed in on Node; Cloudflare Workers
// cannot reach private networks anyway.
async function assertPublicUrl(url, allowPrivate, resolveHost) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Nur http(s)-Links werden unterstützt');
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Lokale Adressen sind nicht erlaubt');
  }
  const addresses = isIPv4(host) || isIPv6(host) ? [host] : resolveHost ? await resolveHost(host) : [];
  if (addresses.some(isPrivateAddress)) throw new Error('Lokale Adressen sind nicht erlaubt');
}

async function readLimited(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Antwort ist zu groß');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// fetch() with redirect checks, a timeout and a size cap.
export async function safeFetch(
  rawUrl,
  { allowPrivate = false, resolveHost = null, timeoutMs = 12000, headers = {}, maxRedirects = 6 } = {},
) {
  let url = new URL(rawUrl);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(url, allowPrivate, resolveHost);
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': BROWSER_UA, 'accept-language': 'de-DE,de;q=0.9,en;q=0.8', ...headers },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return { res, url: url.href };
  }
  throw new Error('Zu viele Weiterleitungen');
}

async function fetchText(url, options, maxBytes = MAX_HTML_BYTES) {
  const { res, url: finalUrl } = await safeFetch(url, options);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  return { text: (await readLimited(res, maxBytes)).toString('utf8'), url: finalUrl };
}

async function fetchJson(url, options) {
  const { text } = await fetchText(url, { ...options, headers: { accept: 'application/json', ...options.headers } }, 512 * 1024);
  return JSON.parse(text);
}

// Follows vm.tiktok.com / pin.it style short links to the real post.
export async function resolveShortLink(url, options = {}) {
  if (!isShortLink(url)) return url;
  const { res, url: finalUrl } = await safeFetch(url, { timeoutMs: 6000, ...options });
  await res.body?.cancel();
  return finalUrl;
}

// "1.234 likes, 5 comments - koch.mit.mir on March 3, 2024: "Caption…"" and
// the German variant with „…“ quotes.
export function parseInstagramDescription(description = '', title = '') {
  const text = decodeEntities(description);
  let caption = null;
  const quoted = text.match(/:\s*["„“](.*)["“”]\s*\.?\s*$/s);
  if (quoted) caption = quoted[1].trim();
  else {
    const titleQuoted = decodeEntities(title).match(/:\s*["„“](.*)["“”]\s*$/s);
    if (titleQuoted) caption = titleQuoted[1].trim();
  }
  const author =
    text.match(/[-–]\s*([\w.]+)\s+(?:on|am)\s/)?.[1]
    || decodeEntities(title).match(/\(@([\w.]+)\)/)?.[1]
    || decodeEntities(title).match(/^([\w.]+) (?:on|auf) Instagram/)?.[1]
    || null;
  return { caption, author };
}

// The public embed page of a post still carries the caption when the
// regular page only shows a login wall.
export function parseInstagramEmbed(html = '') {
  const block = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i)
    || html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
  let caption = null;
  let author = null;
  if (block) {
    author = block[1].match(/class="CaptionUsername"[^>]*>([^<]+)</)?.[1]?.trim() || null;
    caption = decodeEntities(
      block[1]
        .replace(/<a[^>]*class="CaptionUsername"[^>]*>[^<]*<\/a>/i, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    ).trim() || null;
  }
  const image = html.match(/<img[^>]+class="EmbeddedMediaImage"[^>]+src="([^"]+)"/i)?.[1]
    || html.match(/<img[^>]+src="([^"]+)"[^>]+class="EmbeddedMediaImage"/i)?.[1];
  return { caption, author, image: image ? decodeEntities(image) : null };
}

// YouTube keeps the full video description in an inline JSON blob.
function parseYoutubeDescription(html) {
  const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return null;
  }
}

function fromGenericHtml(html, pageUrl) {
  const meta = parseMeta(html);
  const recipe = parseJsonLdRecipe(html);
  const image = recipe?.image || meta['og:image'] || meta['twitter:image'] || null;
  return {
    title: recipe?.title || meta['og:title'] || meta['twitter:title'] || meta['html:title'] || null,
    caption: recipe?.description || meta['og:description'] || meta['twitter:description'] || meta.description || '',
    author: recipe?.author || meta.author || meta['og:site_name'] || null,
    imageUrl: image ? new URL(image, pageUrl).href : null,
    ingredients: recipe?.ingredients ?? [],
    steps: recipe?.steps ?? [],
    prepMinutes: recipe?.prepMinutes ?? null,
    servings: recipe?.servings ?? null,
    keywords: recipe ? [...recipe.keywords, ...recipe.category.split(',')].map((k) => k.trim()).filter(Boolean) : [],
  };
}

async function fetchTiktok(url, options) {
  try {
    const data = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, options);
    return {
      title: null,
      caption: data.title || '',
      author: data.author_name || data.author_unique_id || null,
      imageUrl: data.thumbnail_url || null,
    };
  } catch {
    const { text } = await fetchText(url, options);
    const meta = parseMeta(text);
    return {
      title: null,
      caption: meta['og:description'] || meta.description || '',
      author: null,
      imageUrl: meta['og:image'] || null,
    };
  }
}

async function fetchInstagram(url, options) {
  let caption = null;
  let author = null;
  let imageUrl = null;
  try {
    const { text } = await fetchText(url, { ...options, headers: { 'user-agent': PREVIEW_UA } });
    const meta = parseMeta(text);
    ({ caption, author } = parseInstagramDescription(meta['og:description'], meta['og:title']));
    imageUrl = meta['og:image'] || null;
  } catch {
    // fall through to the embed page
  }
  if (!caption || !imageUrl) {
    try {
      const { text } = await fetchText(`${url.replace(/\/?$/, '/')}embed/captioned/`, options);
      const embed = parseInstagramEmbed(text);
      caption ||= embed.caption;
      author ||= embed.author;
      imageUrl ||= embed.image;
    } catch {
      // nothing more to try
    }
  }
  if (!caption && !imageUrl) throw new Error('Instagram hat keine Vorschau geliefert');
  return { title: null, caption: caption || '', author, imageUrl };
}

async function fetchYoutube(url, options) {
  const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, options);
  let caption = '';
  try {
    const { text } = await fetchText(url, options);
    caption = parseYoutubeDescription(text) || parseMeta(text)['og:description'] || '';
  } catch {
    // the oEmbed data alone is good enough
  }
  return { title: data.title || null, caption, author: data.author_name || null, imageUrl: data.thumbnail_url || null };
}

// Everything we can learn about a shared link without AI.
export async function fetchMetadata(rawUrl, options = {}) {
  const url = normalizeUrl(await resolveShortLink(rawUrl, options));
  const platform = detectPlatform(url);
  let data;
  if (platform === 'tiktok') data = await fetchTiktok(url, options);
  else if (platform === 'instagram') data = await fetchInstagram(url, options);
  else if (platform === 'youtube') data = await fetchYoutube(url, options);
  else {
    const page = await fetchText(url, options);
    data = fromGenericHtml(page.text, page.url);
  }
  const caption = (data.caption || '').trim();
  return {
    url,
    platform,
    title: data.title?.trim() || titleFromCaption(caption),
    caption,
    author: data.author || null,
    imageUrl: data.imageUrl || null,
    ingredients: data.ingredients ?? [],
    steps: data.steps ?? [],
    prepMinutes: data.prepMinutes ?? null,
    servings: data.servings ?? null,
    keywords: data.keywords ?? [],
  };
}

// Social-media CDN image links expire, so thumbnails are stored locally.
export async function downloadImage(imageUrl, options = {}) {
  const { res } = await safeFetch(imageUrl, { ...options, headers: { accept: 'image/*' } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const mediaType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[mediaType];
  if (!ext) {
    await res.body?.cancel();
    throw new Error(`Kein unterstütztes Bildformat (${mediaType || 'unbekannt'})`);
  }
  return { ext, mediaType, data: await readLimited(res, MAX_IMAGE_BYTES) };
}
