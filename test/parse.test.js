import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captionIntro,
  decodeEntities,
  detectPlatform,
  findUrl,
  isoDurationToMinutes,
  normalizeUrl,
  parseJsonLdRecipe,
  parseMeta,
  parseRecipeFromCaption,
  titleFromCaption,
} from '../server/parse.js';

test('findUrl pulls the link out of shared text', () => {
  assert.equal(findUrl('Schau dir das an! https://vm.tiktok.com/ZMabc123/ 😋'), 'https://vm.tiktok.com/ZMabc123/');
  assert.equal(findUrl('', null, '(https://example.com/rezept).'), 'https://example.com/rezept');
  assert.equal(findUrl('kein Link hier'), null);
});

test('detectPlatform recognises the usual sources', () => {
  assert.equal(detectPlatform('https://www.instagram.com/reel/C9xYz/'), 'instagram');
  assert.equal(detectPlatform('https://vm.tiktok.com/ZMabc/'), 'tiktok');
  assert.equal(detectPlatform('https://youtu.be/abc'), 'youtube');
  assert.equal(detectPlatform('https://pin.it/xyz'), 'pinterest');
  assert.equal(detectPlatform('https://www.chefkoch.de/rezepte/1/x.html'), 'web');
});

test('normalizeUrl gives one canonical URL per post', () => {
  assert.equal(
    normalizeUrl('https://instagram.com/reel/C9xYz-AB/?igsh=MWQ1ZGUxMzBkMA%3D%3D&utm_source=ig_web_copy_link'),
    'https://www.instagram.com/reel/C9xYz-AB/',
  );
  assert.equal(normalizeUrl('https://www.instagram.com/reels/C9xYz/'), 'https://www.instagram.com/reel/C9xYz/');
  assert.equal(normalizeUrl('https://www.instagram.com/koch.mit.mir/p/C9xYz/?img_index=2'), 'https://www.instagram.com/p/C9xYz/');
  assert.equal(
    normalizeUrl('https://www.tiktok.com/@kochprofi/video/7312345678901234567?is_from_webapp=1&sender_device=pc&_t=8abc'),
    'https://www.tiktok.com/@kochprofi/video/7312345678901234567',
  );
  assert.equal(normalizeUrl('https://youtube.com/shorts/AbC_123?si=xyz'), 'https://www.youtube.com/watch?v=AbC_123');
  assert.equal(normalizeUrl('https://youtu.be/AbC_123?t=10'), 'https://www.youtube.com/watch?v=AbC_123');
  assert.equal(
    normalizeUrl('https://www.chefkoch.de/rezepte/123/lasagne.html?utm_source=x&portionen=4#kommentare'),
    'https://www.chefkoch.de/rezepte/123/lasagne.html?portionen=4',
  );
});

test('decodeEntities and parseMeta handle typical page markup', () => {
  assert.equal(decodeEntities('Spinat &amp; Feta &#8211; lecker &#x1F60B;'), 'Spinat & Feta – lecker 😋');
  const meta = parseMeta(`<html><head><title>Seite &amp; Titel</title>
    <meta property="og:title" content="Ofen-Gnocchi">
    <meta content='Super &quot;einfach&quot;' name="description">
    <meta property="og:image" content="https://cdn.example.com/bild.jpg?x=1&amp;y=2"></head></html>`);
  assert.equal(meta['og:title'], 'Ofen-Gnocchi');
  assert.equal(meta.description, 'Super "einfach"');
  assert.equal(meta['og:image'], 'https://cdn.example.com/bild.jpg?x=1&y=2');
  assert.equal(meta['html:title'], 'Seite & Titel');
});

test('isoDurationToMinutes', () => {
  assert.equal(isoDurationToMinutes('PT1H30M'), 90);
  assert.equal(isoDurationToMinutes('PT20M'), 20);
  assert.equal(isoDurationToMinutes('P0DT0H45M'), 45);
  assert.equal(isoDurationToMinutes('PT0S'), null);
  assert.equal(isoDurationToMinutes('20 Minuten'), null);
});

test('parseJsonLdRecipe reads schema.org recipes from @graph and sections', () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
    {"@type":"WebPage","name":"Seite"},
    {"@type":["Recipe"],"name":"Linsen-Dal","author":{"@type":"Person","name":"Anna"},
     "image":[{"url":"https://example.com/dal.jpg"}],
     "recipeIngredient":["200 g rote Linsen","1 Dose Kokosmilch"],
     "recipeInstructions":[{"@type":"HowToSection","name":"Kochen","itemListElement":[
        {"@type":"HowToStep","text":"Zwiebel anbraten."},{"@type":"HowToStep","text":"Linsen &amp; Kokosmilch dazu."}]}],
     "totalTime":"PT30M","recipeYield":["4","4 Portionen"],"keywords":"vegan, indisch","recipeCategory":"Hauptgericht"}
  ]}</script>`;
  const recipe = parseJsonLdRecipe(html);
  assert.equal(recipe.title, 'Linsen-Dal');
  assert.equal(recipe.author, 'Anna');
  assert.equal(recipe.image, 'https://example.com/dal.jpg');
  assert.deepEqual(recipe.ingredients, ['200 g rote Linsen', '1 Dose Kokosmilch']);
  assert.deepEqual(recipe.steps, ['Zwiebel anbraten.', 'Linsen & Kokosmilch dazu.']);
  assert.equal(recipe.prepMinutes, 30);
  assert.equal(recipe.servings, '4');
  assert.deepEqual(recipe.keywords, ['vegan', 'indisch']);
});

test('parseJsonLdRecipe ignores broken JSON and pages without recipes', () => {
  assert.equal(parseJsonLdRecipe('<script type="application/ld+json">{oops</script>'), null);
  assert.equal(parseJsonLdRecipe('<script type="application/ld+json">{"@type":"Article"}</script>'), null);
});

test('parseRecipeFromCaption finds ingredient and step blocks in captions', () => {
  const caption = `Cremige Tomaten-Feta-Pasta 🍅 in 20 Minuten!

📝 Zutaten (2 Portionen):
- 250 g Penne
• 200 g Feta
🍅 400 g Kirschtomaten
Für die Sauce:
2 EL Olivenöl

👩‍🍳 Zubereitung:
1. Tomaten und Feta in eine Auflaufform geben.
2. 20 Min. bei 200 °C backen.
3) Mit der Pasta vermischen.

#pasta #feta #rezept`;
  const { ingredients, steps } = parseRecipeFromCaption(caption);
  assert.deepEqual(ingredients, ['250 g Penne', '200 g Feta', '400 g Kirschtomaten', 'Für die Sauce:', '2 EL Olivenöl']);
  assert.deepEqual(steps, [
    'Tomaten und Feta in eine Auflaufform geben.',
    '20 Min. bei 200 °C backen.',
    'Mit der Pasta vermischen.',
  ]);
});

test('parseRecipeFromCaption handles inline lists and captions without recipe', () => {
  assert.deepEqual(parseRecipeFromCaption('Zutaten: 2 Eier, 100 g Mehl, Prise Salz').ingredients, ['2 Eier', '100 g Mehl', 'Prise Salz']);
  assert.deepEqual(parseRecipeFromCaption('So lecker!! Rezept im Video 😍 #food'), {
    ingredients: [],
    steps: [],
    prepMinutes: null,
    servings: null,
  });
});

test('parseRecipeFromCaption separates notes, instructions, nutrition and outro in bulleted lists', () => {
  const caption = `Anzeige | Schnelle Pizzabrötchen

✅ ideal für Kinder

Zutaten für 6 Stück: ⬇️
•6 Aufbackbrötchen
•~ 50 ml Pizzasauce @saucenshop.de* oder nach Wahl
•200 g Hackfleisch
( anbraten und würzen )
•100 g Mozzarella ( 15g pro Stück) gerieben

Zum Bestreichen:
•1 Ei

(Ei verquirlen und die Brötchen damit bestreichen – optional mit Oregano bestreuen)

Ofen vorheizen:
180° Umluft – Backzeit : ca 10 min .

Nach dem Backen:
•Basilikum, gehackt

Nährwerte pro Stück: ⬇️
250 Kcal | 20g KH | 15g E

Folge mir für mehr Rezepte ✌️`;
  const recipe = parseRecipeFromCaption(caption);
  assert.deepEqual(recipe.ingredients, [
    '6 Aufbackbrötchen',
    '~ 50 ml Pizzasauce oder nach Wahl',
    '200 g Hackfleisch (anbraten und würzen)',
    '100 g Mozzarella (15g pro Stück) gerieben',
    'Zum Bestreichen:',
    '1 Ei',
    'Nach dem Backen:',
    'Basilikum, gehackt',
  ]);
  assert.deepEqual(recipe.steps, [
    'Ei verquirlen und die Brötchen damit bestreichen – optional mit Oregano bestreuen',
    'Ofen vorheizen: 180° Umluft – Backzeit: ca 10 min.',
  ]);
  assert.equal(recipe.servings, '6 Stück');
});

test('parseRecipeFromCaption reads stated times and servings instead of listing them as steps', () => {
  const caption = `Garlic Butter Shrimp

Ingredients
1 lb shrimp
2 tbsp butter
Instructions
Melt the butter.
Cook the shrimp for 3 minutes.

Prep Time: 10 minutes
Cook Time: 1 hour 5 minutes
Servings: 4

#shrimp #dinner`;
  const recipe = parseRecipeFromCaption(caption);
  assert.deepEqual(recipe.ingredients, ['1 lb shrimp', '2 tbsp butter']);
  assert.deepEqual(recipe.steps, ['Melt the butter.', 'Cook the shrimp for 3 minutes.']);
  assert.equal(recipe.prepMinutes, 75);
  assert.equal(recipe.servings, '4');
});

test('parseRecipeFromCaption strips keycap step numbers', () => {
  const { steps } = parseRecipeFromCaption('Zubereitung:\n1️⃣ Teig ausrollen.\n2️⃣ Belegen und backen.');
  assert.deepEqual(steps, ['Teig ausrollen.', 'Belegen und backen.']);
});

test('titleFromCaption drops ad labels and calms all-caps titles', () => {
  assert.equal(titleFromCaption('Anzeige | Schnelle Pizzabrötchen\n…'), 'Schnelle Pizzabrötchen');
  assert.equal(titleFromCaption('*Werbung* - Ofengemüse'), 'Ofengemüse');
  assert.equal(titleFromCaption('CHEESEBURGER CAKE - JUICY AND CHEESY\n🍔'), 'Cheeseburger Cake - Juicy And Cheesy');
  assert.equal(titleFromCaption('Mein BBQ-Rezept'), 'Mein BBQ-Rezept');
});

test('captionIntro stops at the first ingredient or step heading', () => {
  assert.equal(captionIntro('Beste Lasagne ever\nmit Spinat\n\n📝 Zutaten:\n500 g Hack'), 'Beste Lasagne ever\nmit Spinat\n');
  assert.equal(captionIntro('Nur Text ohne Rezept'), 'Nur Text ohne Rezept');
});

test('titleFromCaption takes the first meaningful line without hashtags', () => {
  assert.equal(titleFromCaption('#fyp #viral\nOne-Pot-Gnocchi mit Spinat 🤤 #gnocchi\nZutaten: …'), 'One-Pot-Gnocchi mit Spinat 🤤');
  assert.equal(titleFromCaption('😍😍'), null);
  assert.ok(titleFromCaption('a'.repeat(200)).length <= 90);
});
