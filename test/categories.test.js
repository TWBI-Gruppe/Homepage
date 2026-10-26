import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, extractHashtags, extractMinutes } from '../server/categories.js';

const has = (list, ...ids) => ids.every((id) => list.includes(id));

test('categorize picks dish, diet and preparation categories', () => {
  const cats = categorize({ title: 'Cremige Spinat-Pasta', caption: 'Vegetarisch und in 15 Minuten fertig #pasta #veggie' });
  assert.ok(has(cats, 'pasta', 'vegetarisch', 'schnell'), cats.join());
  assert.ok(!cats.includes('fleisch'));
});

test('categorize drops meat categories for vegetarian/vegan dishes', () => {
  const cats = categorize({ title: 'Veganer Burger mit Hähnchen-Ersatz', caption: '#vegan' });
  assert.ok(cats.includes('vegan'));
  assert.ok(!cats.includes('fleisch') && !cats.includes('gefluegel'), cats.join());
});

test('categorize avoids common false positives', () => {
  assert.ok(!categorize({ title: 'Gebratener Reis mit Ei' }).includes('dessert'));
  const fries = categorize({ title: 'Süßkartoffel-Pommes aus dem Airfryer' });
  assert.ok(has(fries, 'airfryer', 'snacks'), fries.join());
  assert.ok(!fries.includes('dessert'), fries.join());
});

test('categorize recognises international dishes and bowls', () => {
  const cats = categorize({ title: 'Chicken Teriyaki Bowl', caption: 'Meal prep for the week' });
  assert.ok(has(cats, 'gefluegel', 'asiatisch', 'salate', 'mealprep'), cats.join());
  assert.ok(has(categorize({ title: 'Schokoladenkuchen ohne Mehl' }), 'dessert'));
  assert.ok(has(categorize({ title: 'Bananenbrot' }), 'backen'));
});

test('dish types come from the title and intro, not from single ingredients', () => {
  const cats = categorize({
    title: 'Kürbissuppe',
    caption: 'Wärmt so schön!\nZutaten:\n1 Hokkaido\n1 TL Curry\n2 EL Sojasauce\n1 Hähnchenbrust',
    ingredients: ['1 Hokkaido', '1 TL Curry', '2 EL Sojasauce', '1 Hähnchenbrust'],
  });
  assert.ok(has(cats, 'suppen', 'gefluegel'), cats.join());
  assert.ok(!cats.includes('saucen') && !cats.includes('asiatisch'), cats.join());
});

test('savoury "cakes" are no desserts, and a dish with a sauce is no sauce', () => {
  const cake = categorize({ title: 'Cheeseburger Cake', tags: ['kuchen', 'burger'], ingredients: ['200 g Rinderhackfleisch'] });
  assert.ok(cake.includes('fleisch') && !cake.includes('dessert'), cake.join());
  const steak = categorize({ title: 'Garlic Butter Steak with Herb Sauce', caption: 'A rich creamy sauce on top.' });
  assert.ok(steak.includes('fleisch') && !steak.includes('saucen'), steak.join());
  assert.ok(categorize({ title: 'Knoblauch-Dip in 5 Minuten' }).includes('saucen'));
  assert.ok(!categorize({ title: 'Nudeln mit Tomatensoße' }).includes('saucen'));
});

test('categorize marks quick recipes by prep time', () => {
  assert.ok(categorize({ title: 'Omelett', prepMinutes: 10 }).includes('schnell'));
  assert.ok(!categorize({ title: 'Schmorbraten', prepMinutes: 180 }).includes('schnell'));
});

test('extractHashtags drops generic social-media tags', () => {
  assert.deepEqual(extractHashtags('Lecker! #fyp #FoodTok #Pasta #feta #viral #pasta #Weihnachtsplätzchen'), [
    'pasta',
    'feta',
    'weihnachtsplätzchen',
  ]);
});

test('extractMinutes', () => {
  assert.equal(extractMinutes('Fertig in 25 Minuten!'), 25);
  assert.equal(extractMinutes('nur 10 min'), 10);
  assert.equal(extractMinutes('Das perfekte 15-Minuten-Rezept'), 15);
  assert.equal(extractMinutes('Für 4 Personen'), null);
  assert.equal(extractMinutes('Dann 20 Min. bei 200 °C backen'), null);
});
