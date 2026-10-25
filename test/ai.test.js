import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAi } from '../server/ai.js';

// A stand-in for the Messages API so the real SDK request can be inspected.
let server;
let lastRequest;
let nextResponse;

function message(content, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(nextResponse));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  delete process.env.ANTHROPIC_BASE_URL;
  await new Promise((resolve) => server.close(resolve));
});

test('createAi is disabled without an API key', () => {
  assert.equal(createAi({ apiKey: '' }), null);
});

test('analyze sends caption and image with a JSON schema and parses the result', async () => {
  nextResponse = message([
    { type: 'thinking', thinking: '', signature: 'x' },
    {
      type: 'text',
      text: JSON.stringify({
        is_recipe: true,
        title: ' Ofen-Gnocchi mit Feta ',
        categories: ['vegetarisch', 'schnell', 'erfunden'],
        ingredients: ['500 g Gnocchi', ' '],
        steps: ['Alles in den Ofen.'],
        prep_minutes: 0,
        servings: '',
        tags: ['Feta', 'Ofengericht'],
      }),
    },
  ]);
  const ai = createAi({ apiKey: 'sk-test', model: 'claude-opus-5-5' });
  const result = await ai.analyze({
    platform: 'instagram',
    url: 'https://www.instagram.com/reel/abc/',
    author: 'lisa_kocht',
    caption: 'Ofen-Gnocchi 🤤 Zutaten: 500 g Gnocchi',
    image: { mediaType: 'image/jpeg', data: Buffer.from('fake-jpeg') },
  });

  assert.deepEqual(result, {
    isRecipe: true,
    title: 'Ofen-Gnocchi mit Feta',
    categories: ['vegetarisch', 'schnell'],
    ingredients: ['500 g Gnocchi'],
    steps: ['Alles in den Ofen.'],
    prepMinutes: null,
    servings: null,
    tags: ['feta', 'ofengericht'],
  });

  const { url, headers, body } = lastRequest;
  assert.match(url, /^\/v1\/messages/);
  assert.ok(headers['x-api-key'] === 'sk-test' || headers.authorization === 'Bearer sk-test');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.ok(body.output_config.format.schema.properties.categories.items.enum.includes('vegetarisch'));
  const [image, text] = body.messages[0].content;
  assert.equal(image.type, 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(image.source.data, Buffer.from('fake-jpeg').toString('base64'));
  assert.match(text.text, /<beitrag>[\s\S]*Ofen-Gnocchi[\s\S]*<\/beitrag>/);
  assert.match(text.text, /Autor: lisa_kocht/);
});

test('analyze reports refusals and truncated answers as errors', async () => {
  const ai = createAi({ apiKey: 'sk-test' });
  nextResponse = { ...message([]), stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } };
  await assert.rejects(ai.analyze({ platform: 'web', url: 'https://example.com', caption: 'x' }), /abgelehnt/);
  nextResponse = message([{ type: 'text', text: '{"is_recipe": tr' }], 'max_tokens');
  await assert.rejects(ai.analyze({ platform: 'web', url: 'https://example.com', caption: 'x' }), /unvollständig/);
});
