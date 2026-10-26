import { captionIntro } from './parse.js';

// Default categories. `id` is what gets stored on a recipe; anything stored
// that is not one of these ids is treated as a user-defined category name.
// `match` runs against the lower-cased title, hashtags and the intro of the
// caption; categories with `scope: 'all'` also look at the ingredient list
// (a "Teriyaki-Sauce" among the ingredients doesn't make a dish a sauce, but
// "Hähnchenbrust" does make it a chicken dish).
export const CATEGORIES = [
  {
    id: 'fruehstueck',
    label: 'Frühstück',
    emoji: '🥐',
    match: /frühstück|fruehstueck|breakfast|brunch|overnight ?oats|porridge|pancake|pfannkuchen|waffel|waffle|granola|müsli|muesli|rührei|scrambled egg|omelett|omelette|french toast|shakshuka/,
  },
  {
    id: 'pasta',
    label: 'Pasta & Nudeln',
    emoji: '🍝',
    match: /pasta|nudel|noodle|spaghetti|penne|lasagne|lasagna|tagliatelle|gnocchi|ravioli|tortellini|carbonara|bolognese|mac ?(and|n|&) ?cheese|orzo|rigatoni|fusilli|linguine|pappardelle|spätzle/,
  },
  {
    id: 'fleisch',
    label: 'Fleisch',
    emoji: '🥩',
    scope: 'all',
    match: /fleisch|\bmeat|\bbeef|\brind|steak|schwein|\bpork|hackfleisch|\bhack\b|ground beef|minced|bacon|speck|\blamm|\blamb|burger|bratwurst|schnitzel|gulasch|goulash|pulled pork|frikadelle|meatball|köttbullar|salami|chorizo/,
  },
  {
    id: 'gefluegel',
    label: 'Hähnchen & Geflügel',
    emoji: '🍗',
    scope: 'all',
    match: /hähnchen|haehnchen|hühnchen|chicken|\bhuhn|geflügel|gefluegel|\bpute|turkey|\bente\b|duck|chicken wings|nuggets/,
  },
  {
    id: 'fisch',
    label: 'Fisch & Meeresfrüchte',
    emoji: '🐟',
    scope: 'all',
    match: /fisch|\bfish|lachs|salmon|thunfisch|\btuna|garnele|shrimp|prawn|scampi|kabeljau|\bcod\b|muschel|mussel|tintenfisch|calamari|squid|sushi|seafood|meeresfrücht|forelle|trout|dorade/,
  },
  {
    id: 'vegetarisch',
    label: 'Vegetarisch',
    emoji: '🥦',
    scope: 'all',
    match: /vegetarisch|vegetarian|\bveggie|fleischlos|meatless/,
  },
  {
    id: 'vegan',
    label: 'Vegan',
    emoji: '🌱',
    scope: 'all',
    match: /\bvegan|plant[- ]?based|pflanzlich/,
  },
  {
    id: 'suppen',
    label: 'Suppen & Eintöpfe',
    emoji: '🍲',
    match: /suppe|\bsoup|eintopf|\bstew|ramen|chili con carne|brühe|broth|minestrone|\bpho\b|\bdal\b|\bdhal\b/,
  },
  {
    id: 'salate',
    label: 'Salate & Bowls',
    emoji: '🥗',
    match: /salat|salad|\bbowl|poke|buddha/,
  },
  {
    id: 'snacks',
    label: 'Snacks & Fingerfood',
    emoji: '🥨',
    match: /snack|fingerfood|finger food|appetizer|vorspeise|tapas|nachos|party ?food|häppchen|toastie|quesadilla|wrap\b|frühlingsrolle|spring roll|\bfries|pommes|chips/,
  },
  {
    id: 'backen',
    label: 'Brot & Backen',
    emoji: '🍞',
    match: /brot\b|brötchen|\bbread|backen|baking|focaccia|sauerteig|sourdough|baguette|pizzateig|pizza dough|hefeteig|zopf|bagel|croissant|ciabatta/,
  },
  {
    id: 'dessert',
    label: 'Desserts & Süßes',
    emoji: '🍰',
    match: /dessert|nachtisch|kuchen|\bcake|torte|cookie|keks|plätzchen|brownie|schoko|chocolate|tiramisu|cheesecake|\beis\b|ice ?cream|pudding|muffin|cupcake|tarte|crumble|mousse|zimtschnecke|cinnamon roll|donut|praline|\bsweets\b|sweet treat|süßes|süßspeise|naschen|blondie|crêpe|crepe/,
  },
  {
    id: 'getraenke',
    label: 'Getränke',
    emoji: '🍹',
    match: /getränk|\bdrink|cocktail|mocktail|smoothie|\bshake|kaffee|coffee|latte|matcha|limonade|lemonade|eistee|iced tea|spritz|sangria/,
  },
  {
    id: 'saucen',
    label: 'Saucen & Dips',
    emoji: '🫙',
    // Only when the dish itself is a sauce: "Steak mit Kräutersauce" is not.
    scope: 'title',
    match: /\bsauce|soße|sosse|\bdip\b|dips\b|dressing|pesto|hummus|aioli|guacamole|marinade|salsa|tzatziki|chutney/,
    exclude: /\b(mit|with|in|an|auf|und|and|&|plus|dazu)\b.*(sauce|soße|sosse|\bdips?\b|dressing|pesto|aioli|salsa|tzatziki|chutney)/,
  },
  {
    id: 'asiatisch',
    label: 'Asiatisch',
    emoji: '🥢',
    match: /asian|asiatisch|\bwok|curry|ramen|sushi|teriyaki|kimchi|korean|koreanisch|thai|japan|chines|dumpling|gyoza|fried rice|bratreis|pad thai|udon|\bbao\b|bibimbap|satay|miso|bulgogi|katsu|tikka|masala|indisch|indian/,
  },
  {
    id: 'airfryer',
    label: 'Airfryer',
    emoji: '💨',
    scope: 'all',
    match: /air ?fryer|airfryer|heißluftfritteuse|heissluftfritteuse|heissluft-fritteuse|heißluft-fritteuse/,
  },
  {
    id: 'mealprep',
    label: 'Meal Prep',
    emoji: '📦',
    scope: 'all',
    match: /meal ?prep|meal-prep|vorkochen|lunchbox|lunch box/,
  },
  {
    id: 'schnell',
    label: 'Schnell & Einfach',
    emoji: '⏱️',
    match: /schnell|\bquick|\beasy|einfach|simple|one ?pot|one-pot|blitz|in no time|lazy|feierabend/,
  },
  {
    id: 'protein',
    label: 'High Protein & Fit',
    emoji: '💪',
    match: /protein|eiweiß|eiweiss|fitness|\bgym\b|macros|low ?carb|kalorienarm|low ?cal|abnehmen|kcal|kalorien|healthy|gesund/,
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const MEAT_IDS = ['fleisch', 'gefluegel', 'fisch'];

// Hashtags that say nothing about the dish itself.
const GENERIC_TAGS = new Set([
  'fyp', 'fy', 'fypシ', 'foryou', 'foryoupage', 'fürdich', 'fuerdich', 'fürdichseite', 'viral', 'trending',
  'explore', 'explorepage', 'reels', 'reel', 'instagram', 'insta', 'tiktok', 'tiktokfood', 'foodtok',
  'food', 'foodie', 'foodporn', 'foodblogger', 'foodlover', 'instafood', 'yummy', 'lecker', 'delicious',
  'rezept', 'rezepte', 'recipe', 'recipes', 'rezeptideen', 'kochen', 'cooking', 'cook', 'essen', 'eat',
  'homemade', 'selbstgemacht', 'easyrecipe', 'easyrecipes', 'foodtiktok', 'tiktokrezept', 'tiktokrezepte',
  'cookingtiktok', 'cookwithme', 'kochenmitliebe', 'essenistfertig', 'mittagessen', 'abendessen', 'dinner',
  'lunch', 'dinnerideas', 'foodstagram', 'foodphotography', 'germanfood', 'deutsch', 'foodgasm', 'tasty',
  'learnontiktok', 'kochtipps', 'foodinspiration', 'reelsinstagram', 'instareels', 'xyzbca',
]);

export function extractHashtags(text = '') {
  const tags = [];
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1].toLowerCase();
    if (!GENERIC_TAGS.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 15);
}

// Total time phrases like "in 15 Minuten", "nur 10 min", "Zeit: 30 Min." or
// "15-Minuten-Rezept" – but not step timings such as "20 Min. backen".
const TIME_PATTERNS = [
  /(?:\bin|\bnur|\bunter|\bzeit|\bdauer|gesamtzeit|ready in|done in|\btakes|\btotal)\s*:?\s*(?:nur\s*|ca\.?\s*|about\s*|only\s*)?(\d{1,3})\s*(?:min\b|min\.|mins\b|minuten|minutes)/i,
  /\b(\d{1,3})\s*[- ]?(?:minuten|minute|min)[- ]?(?:rezept|recipe|meal|dinner|gericht|mahlzeit|snack|lunch|frühstück)/i,
];

export function extractMinutes(text = '') {
  for (const pattern of TIME_PATTERNS) {
    const n = Number(text.match(pattern)?.[1]);
    if (n > 0 && n <= 600) return n;
  }
  return null;
}

// Keyword-based fallback used when no AI key is configured (or the AI call fails).
export function categorize({ title = '', caption = '', tags = [], ingredients = [], prepMinutes = null } = {}) {
  const hashtags = tags.map((t) => `#${t}`).join(' ');
  const titleText = [title, hashtags].join('\n').toLowerCase();
  const intro = [title, captionIntro(caption), hashtags].join('\n').toLowerCase();
  const all = [title, caption, hashtags, ingredients.join('\n')].join('\n').toLowerCase();
  const text = { title: titleText, all, intro };
  const found = CATEGORIES.filter(
    (c) => c.match.test(text[c.scope || 'intro']) && !c.exclude?.test(title.toLowerCase()),
  ).map((c) => c.id);

  const minutes = prepMinutes ?? extractMinutes(intro);
  if (minutes && minutes <= 20 && !found.includes('schnell')) found.push('schnell');

  // "Veggie-Burger" or "vegane Bolognese" should not land in the meat category.
// Checked the other way round, a "Cheeseburger Cake" is no dessert.
  if (found.includes('vegan') || found.includes('vegetarisch')) {
    return found.filter((id) => !MEAT_IDS.includes(id));
  }
  if (found.some((id) => MEAT_IDS.includes(id))) return found.filter((id) => id !== 'dessert');
  return found;
}
