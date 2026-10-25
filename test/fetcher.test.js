import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMetadata, parseInstagramDescription, parseInstagramEmbed, safeFetch } from '../server/fetcher.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('parseInstagramDescription handles the English and German preview text', () => {
  const en = parseInstagramDescription(
    '1,234 likes, 56 comments - koch.mit.mir on March 3, 2025: "Ofen-Gnocchi 🤤\nZutaten:\n500 g Gnocchi". ',
  );
  assert.equal(en.author, 'koch.mit.mir');
  assert.equal(en.caption, 'Ofen-Gnocchi 🤤\nZutaten:\n500 g Gnocchi');

  const de = parseInstagramDescription(
    '2.345 „Gefällt mir“-Angaben, 12 Kommentare – lisa_kocht am 3. März 2025: „Schnelle Linsensuppe &amp; Brot“',
  );
  assert.equal(de.author, 'lisa_kocht');
  assert.equal(de.caption, 'Schnelle Linsensuppe & Brot');

  const fromTitle = parseInstagramDescription('', 'Lisa (@lisa_kocht) on Instagram: "Bananenbrot"');
  assert.equal(fromTitle.author, 'lisa_kocht');
  assert.equal(fromTitle.caption, 'Bananenbrot');
});

test('parseInstagramEmbed reads caption and image from the embed page', () => {
  const html = `<div class="Embed"><img class="EmbeddedMediaImage" alt="x" src="https://scontent.cdninstagram.com/v/abc.jpg?a=1&amp;b=2">
    <div class="Caption"><a class="CaptionUsername" href="#">lisa_kocht</a><br/>Pasta alla Norma<br/><br/>Zutaten:<br/>1 Aubergine
    <div class="CaptionComments">…</div></div></div>`;
  const embed = parseInstagramEmbed(html);
  assert.equal(embed.author, 'lisa_kocht');
  assert.equal(embed.caption, 'Pasta alla Norma\n\nZutaten:\n1 Aubergine');
  assert.equal(embed.image, 'https://scontent.cdninstagram.com/v/abc.jpg?a=1&b=2');
});

test('fetchMetadata follows TikTok short links and uses oEmbed', async () => {
  const requested = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    requested.push(href);
    if (href === 'https://vm.tiktok.com/ZMshort/') {
      return new Response(null, {
        status: 301,
        headers: { location: 'https://www.tiktok.com/@kochprofi/video/7312345678901234567?_t=abc&_r=1' },
      });
    }
    if (href.startsWith('https://www.tiktok.com/oembed?')) {
      assert.ok(href.includes(encodeURIComponent('https://www.tiktok.com/@kochprofi/video/7312345678901234567')));
      return Response.json({
        title: 'Knusprige Airfryer-Gnocchi 🔥\nZutaten:\n500 g Gnocchi\n1 EL Öl\n#airfryer #fyp',
        author_name: 'Koch Profi',
        thumbnail_url: 'https://p16-sign.tiktokcdn.com/thumb.jpeg',
      });
    }
    return new Response('not found', { status: 404 });
  };

  const meta = await fetchMetadata('https://vm.tiktok.com/ZMshort/', { allowPrivate: true });
  assert.equal(meta.url, 'https://www.tiktok.com/@kochprofi/video/7312345678901234567');
  assert.equal(meta.platform, 'tiktok');
  assert.equal(meta.title, 'Knusprige Airfryer-Gnocchi 🔥');
  assert.equal(meta.author, 'Koch Profi');
  assert.equal(meta.imageUrl, 'https://p16-sign.tiktokcdn.com/thumb.jpeg');
  assert.match(meta.caption, /500 g Gnocchi/);
});

test('safeFetch refuses local network addresses unless allowed', async () => {
  await assert.rejects(safeFetch('http://127.0.0.1:1/'), /Lokale Adressen/);
  await assert.rejects(safeFetch('http://localhost/'), /Lokale Adressen/);
  await assert.rejects(safeFetch('http://[::1]/'), /Lokale Adressen/);
  await assert.rejects(safeFetch('http://192.168.1.10/'), /Lokale Adressen/);
  await assert.rejects(safeFetch('file:///etc/passwd'), /http/);
});

test('safeFetch re-checks every redirect target', async () => {
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  await assert.rejects(safeFetch('http://93.184.216.34/'), /Lokale Adressen/);
});
