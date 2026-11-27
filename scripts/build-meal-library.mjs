import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = text => createHash('sha256').update(text).digest('hex');
const categoryId = (kind, label) => kind + '-' + hash(label).slice(0, 12);
const nameKey = value => value.normalize('NFKC').toLowerCase()
  .replace(/[يىكآأإٱۀە]/g, char => ({ ي: 'ی', ى: 'ی', ك: 'ک', آ: 'ا', أ: 'ا', إ: 'ا', ٱ: 'ا', ۀ: 'ه', ە: 'ه' }[char] ?? char))
  .replace(/[\u064B-\u065F\u0670\u0640\u200c\u200d]/g, '')
  .replace(/\s+/g, '').trim();

function inventoryCatalogMap(catalog = {}) {
  const result = new Map();
  for (const [group, items] of Object.entries(catalog)) {
    for (const item of items) {
      const id = 'preset:' + nameKey(item.title);
      result.set(nameKey(item.title), id);
      for (const alias of item.aliases ?? []) result.set(nameKey(alias), id);
    }
  }
  return result;
}

/** Display-only projection. Reviewed source quantities never enter this library. */
export function projectMealLibrary(source, sourceHash, inventoryCatalog = {}) {
  if (source.schema_version !== '2.0.0' || !Array.isArray(source.recipes)) throw new Error('Unsupported reviewed recipe schema');
  const categories = new Map(), meals = new Map(), details = new Map(), foods = [];
  const inventoryIds = inventoryCatalogMap(inventoryCatalog);
  const ids = new Set(), variantIds = new Set();
  let variantCount = 0;
  const tags = (kind, labels, target) => labels.map(label => {
    const id = categoryId(kind, label);
    target.set(id, { id, label });
    return id;
  });
  const projectItem = item => {
    const base = { id: item.id, kind: item.kind, required: item.required !== false };
    if (item.kind === 'ingredient' || item.kind === 'equipment') return {
      ...base, name: item.name,
      ...(item.kind === 'ingredient' && inventoryIds.has(nameKey(item.name))
        ? { catalogId: inventoryIds.get(nameKey(item.name)) } : {}),
    };
    if (item.kind === 'choice' || item.kind === 'open_choice') return {
      ...base, label: item.label, options: (item.options ?? []).map(option => option.name),
      allowCustom: item.allow_custom === true || item.kind === 'open_choice',
    };
    if (item.kind === 'unresolved') return { ...base, label: item.label ?? item.name ?? item.source_expressions?.join(' / ') ?? '' };
    throw new Error('Unknown reviewed ingredient kind: ' + item.kind);
  };
  for (const recipe of source.recipes) {
    if (!/^recipe_[a-f0-9]{20}$/.test(recipe.id) || ids.has(recipe.id) || !recipe.name?.trim()) throw new Error('Invalid/duplicate recipe identity');
    if (recipe.variant_selection?.mode !== 'choose_one' || !recipe.variants?.length) throw new Error('A whole variant must be chosen');
    ids.add(recipe.id);
    const variants = recipe.variants.map(variant => {
      if (variantIds.has(variant.id) || !/^variant_[a-f0-9]{20}$/.test(variant.id)) throw new Error('Invalid/duplicate variant identity');
      variantIds.add(variant.id); variantCount++;
      return { id: variant.id, items: variant.ingredients.map(projectItem), needsReview: !variant.ready_for_ingredient_selection };
    });
    const shard = recipe.id.slice(7, 9);
    const detailFile = 'details-' + shard + '.json';
    const bucket = details.get(detailFile) ?? [];
    bucket.push({ id: recipe.id, variants }); details.set(detailFile, bucket);
    const preview = variants[0].items.filter(item => item.kind !== 'equipment').slice(0, 4).map(item => item.name ?? item.label);
    foods.push({ id: recipe.id, title: recipe.name, aliases: recipe.name_aliases ?? [],
      meals: tags('meal', recipe.meals, meals), categories: tags('type', recipe.food_types, categories),
      variantCount: variants.length, ingredientPreview: preview, detailFile });
  }
  return { index: { schemaVersion: 1, sourceHash, foodCount: foods.length, variantCount,
    meals: [...meals.values()], categories: [...categories.values()], foods }, details };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/build-meal-library.mjs <reviewed recipes.json> [output directory]');
  const bytes = await readFile(resolve(input));
  const catalogPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/domain/inventory/inventory.catalog.json');
  const catalog = JSON.parse((await readFile(catalogPath)).toString('utf8'));
  const projection = projectMealLibrary(JSON.parse(bytes.toString('utf8')), hash(bytes), catalog);
  const output = resolve(process.argv[3] ?? 'public/meal-library');
  await mkdir(output, { recursive: true });
  const files = [['index.json', projection.index], ...projection.details];
  for (const [name, value] of files) await writeFile(resolve(output, name), JSON.stringify(value) + '\n', 'utf8');
  await writeFile(resolve(output, 'provenance.json'), JSON.stringify({ schemaVersion: 1, sourceHash: projection.index.sourceHash,
    foodCount: projection.index.foodCount, variantCount: projection.index.variantCount, detailShards: projection.details.size,
    projection: 'Titles, source categories and separate ingredient variants only; no quantities or preparation steps.' }, null, 2) + '\n');
  console.log(JSON.stringify({ output, foods: projection.index.foodCount, variants: projection.index.variantCount,
    shards: projection.details.size, sourceHash: projection.index.sourceHash }));
}
