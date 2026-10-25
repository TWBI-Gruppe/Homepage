import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { CATEGORY_IDS, categorize, extractHashtags, extractMinutes } from './categories.js';
import { describeAiError } from './ai.js';
import { downloadImage, fetchMetadata } from './fetcher.js';
import { parseRecipeFromCaption, titleFromCaption } from './parse.js';

const PLATFORM_NAMES = {
  tiktok: 'TikTok-Video',
  instagram: 'Instagram-Beitrag',
  youtube: 'YouTube-Video',
  pinterest: 'Pinterest-Pin',
  facebook: 'Facebook-Beitrag',
  web: 'Rezept',
};

export function placeholderTitle(platform) {
  return PLATFORM_NAMES[platform] || PLATFORM_NAMES.web;
}

const unique = (list) => [...new Set(list.filter(Boolean))];

// Loads metadata for saved links in the background, one at a time, so that
// sharing a link returns immediately.
export function createEnricher({ db, imagesDir, ai = null, fetchOptions = {}, log = console }) {
  const queue = [];
  let running = false;
  let idleWaiters = [];

  async function analyze(id, { force }) {
    const recipe = db.get(id);
    if (!recipe) return;
    const problems = [];

    let meta = null;
    try {
      meta = await fetchMetadata(recipe.url, fetchOptions);
    } catch (error) {
      problems.push(`Link konnte nicht gelesen werden (${error.message})`);
    }

    let image = null;
    if (meta?.imageUrl && (force || !recipe.thumbnail)) {
      try {
        image = await downloadImage(meta.imageUrl, imagesDir, `r${id}-${Date.now().toString(36)}`, fetchOptions);
      } catch (error) {
        log.warn?.(`Vorschaubild für #${id} nicht geladen: ${error.message}`);
      }
    }

    // A caption pasted by the user wins over an empty or failed fetch.
    const caption = meta?.caption || recipe.caption || '';
    const fromCaption = parseRecipeFromCaption(caption);
    const auto = {
      title: meta?.title || titleFromCaption(caption),
      author: meta?.author || recipe.author,
      ingredients: meta?.ingredients?.length ? meta.ingredients : fromCaption.ingredients,
      steps: meta?.steps?.length ? meta.steps : fromCaption.steps,
      prepMinutes: meta?.prepMinutes ?? extractMinutes(caption),
      servings: meta?.servings ?? null,
      tags: unique([...extractHashtags(caption), ...(meta?.keywords ?? []).map((k) => k.toLowerCase())]).slice(0, 15),
    };
    auto.categories = categorize({ ...auto, caption });

    let usedAi = false;
    if (ai && (caption || auto.title || image)) {
      try {
        const result = await ai.analyze({
          platform: meta?.platform || recipe.platform,
          url: recipe.url,
          title: meta?.title,
          author: auto.author,
          caption,
          ingredients: meta?.ingredients,
          steps: meta?.steps,
          image: image ? { mediaType: image.mediaType, data: image.data } : null,
        });
        auto.title = result.title || auto.title;
        auto.categories = result.categories;
        if (result.ingredients.length) auto.ingredients = result.ingredients;
        if (result.steps.length) auto.steps = result.steps;
        auto.prepMinutes = result.prepMinutes ?? auto.prepMinutes;
        auto.servings = result.servings ?? auto.servings;
        auto.tags = unique([...result.tags, ...auto.tags]).slice(0, 15);
        usedAi = true;
        if (!result.isRecipe) problems.push('Sieht nicht nach einem Rezept aus');
      } catch (error) {
        log.warn?.(`KI-Analyse für #${id} fehlgeschlagen: ${error.message}`);
        problems.push(describeAiError(error));
      }
    }

    // The user may have edited the recipe while it was being analysed; only an
    // explicit "neu analysieren" overwrites their changes (custom categories stay).
    const current = db.get(id);
    if (!current) return;
    const keepTitle = !force && current.title && current.title !== placeholderTitle(current.platform);
    const update = {
      caption,
      author: auto.author,
      title: keepTitle ? current.title : auto.title || current.title,
      ingredients: !force && current.ingredients.length ? current.ingredients : auto.ingredients,
      steps: !force && current.steps.length ? current.steps : auto.steps,
      categories: force
        ? unique([...auto.categories, ...current.categories.filter((c) => !CATEGORY_IDS.includes(c))])
        : unique([...current.categories, ...auto.categories]),
      tags: auto.tags,
      prepMinutes: !force && current.prepMinutes ? current.prepMinutes : auto.prepMinutes,
      servings: !force && current.servings ? current.servings : auto.servings,
      status: meta || caption ? 'done' : 'failed',
      statusDetail: problems.join(' · ') || null,
      analyzedWithAi: usedAi,
    };
    if (meta && meta.url !== current.url && !db.findByUrl(meta.url)) update.url = meta.url;

    if (image) {
      const oldFile = db.thumbnailFile(id);
      update.thumbnail = image.file;
      if (oldFile) await unlink(path.join(imagesDir, oldFile)).catch(() => {});
    }
    db.update(id, update);
  }

  async function run() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        await analyze(job.id, job);
      } catch (error) {
        log.error?.(`Analyse von #${job.id} abgebrochen:`, error);
        db.update(job.id, { status: 'failed', statusDetail: 'Unerwarteter Fehler bei der Analyse' });
      }
    }
    running = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  return {
    enqueue(id, { force = false } = {}) {
      const existing = queue.find((job) => job.id === id);
      if (existing) existing.force ||= force;
      else queue.push({ id, force });
      run();
    },
    // Resolves once the queue is empty (used by tests and graceful shutdown).
    idle() {
      return running || queue.length ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
    },
  };
}
