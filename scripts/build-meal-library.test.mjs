import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { projectMealLibrary } from './build-meal-library.mjs';

const ingredient = { id: 'item-one', kind: 'ingredient', name: 'برنج', required: true, quantity: 2, unit: 'پیمانه' };
const source = () => ({ schema_version: '2.0.0', recipes: [{ id: 'recipe_00000000000000000001', name: 'عدس پلو',
  name_aliases: ['عدس‌پلو'], meals: ['ناهار', 'شام'], food_types: ['غذای اصلی / پلویی و چلویی'],
  variant_selection: { mode: 'choose_one' }, variants: [
    { id: 'variant_00000000000000000001', ready_for_ingredient_selection: true, ingredients: [ingredient] },
    { id: 'variant_00000000000000000002', ready_for_ingredient_selection: true, ingredients: [{ ...ingredient, name: 'عدس' }] },
  ] }] });

test('projects every classification without mixing whole variants or copying source amounts', () => {
  const original = source(), result = projectMealLibrary(original, 'verified-hash');
  assert.equal(result.index.foodCount, 1); assert.equal(result.index.variantCount, 2);
  assert.deepEqual(result.index.meals.map(row => row.label), ['ناهار', 'شام']);
  assert.deepEqual(result.index.foods[0].aliases, ['عدس‌پلو']);
  assert.equal(result.index.foods[0].variantCount, 2);
  const detail = [...result.details.values()][0][0];
  assert.deepEqual(detail.variants.map(row => row.items[0].name), ['برنج', 'عدس']);
  assert.equal(JSON.stringify(detail).includes('quantity'), false);
  assert.equal(JSON.stringify(detail).includes('unit'), false);
  assert.equal(original.recipes[0].variants[0].ingredients[0].quantity, 2);
});

test('preserves alternatives, open selections, optional items, equipment and unresolved review', () => {
  const original = source();
  original.recipes[0].variants[0].ready_for_ingredient_selection = false;
  original.recipes[0].variants[0].ingredients = [
    { id: 'choice', kind: 'choice', label: 'آرد یا نشاسته', required: true, options: [{ name: 'آرد' }, { name: 'نشاسته' }] },
    { id: 'open', kind: 'open_choice', label: 'سبزی دلخواه', required: true, allow_custom: true },
    { ...ingredient, required: false }, { ...ingredient, kind: 'equipment', name: 'قالب' },
    { id: 'review', kind: 'unresolved', source_expressions: ['مادهٔ مبهم'], required: true },
  ];
  const result = projectMealLibrary(original, 'hash');
  const variant = [...result.details.values()][0][0].variants[0];
  assert.equal(variant.needsReview, true);
  assert.deepEqual(variant.items[0].options, ['آرد', 'نشاسته']);
  assert.equal(variant.items[1].allowCustom, true);
  assert.equal(variant.items[2].required, false);
  assert.equal(variant.items[3].kind, 'equipment');
  assert.equal(variant.items[4].label, 'مادهٔ مبهم');
});

test('category keys depend on source identity, not localized display text or order', () => {
  const one = source(), two = source(); two.recipes[0].meals.reverse();
  const a = projectMealLibrary(one, 'hash'), b = projectMealLibrary(two, 'hash');
  assert.deepEqual(a.index.meals.map(row => row.id).sort(), b.index.meals.map(row => row.id).sort());
});

test('fails closed on duplicate identities, unknown kinds and unsupported variants', () => {
  const duplicate = source(); duplicate.recipes.push(duplicate.recipes[0]);
  assert.throws(() => projectMealLibrary(duplicate, 'hash'), /duplicate/);
  const unknown = source(); unknown.recipes[0].variants[0].ingredients[0] = { ...ingredient, kind: 'mystery' };
  assert.throws(() => projectMealLibrary(unknown, 'hash'), /Unknown/);
  const union = source(); union.recipes[0].variant_selection.mode = 'union';
  assert.throws(() => projectMealLibrary(union, 'hash'), /whole variant/);
});

test('checked-in library has all reviewed foods and variants, separate immutable categories, and no recipe quantities', async () => {
  const directory = new URL('../public/meal-library/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('index.json', directory), 'utf8'));
  const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
  assert.equal(index.foodCount, 4583); assert.equal(index.variantCount, 5832);
  assert.equal(index.sourceHash, 'da49cd9a2241b402b5cf1ccbf9a5ac1a30bde5135ed96c712447706a645af36a');
  assert.equal(provenance.sourceHash, index.sourceHash);
  assert.equal(new Set(index.foods.map(food => food.id)).size, 4583);
  assert.equal(index.meals.length, 10); assert.equal(index.categories.length, 50);
  for (const tag of [...index.meals, ...index.categories]) assert(index.foods.some(food => [...food.meals, ...food.categories].includes(tag.id)));
  const shards = (await readdir(directory)).filter(file => /^details-[a-f0-9]{2}\.json$/.test(file));
  assert.equal(shards.length, provenance.detailShards);
  const details = (await Promise.all(shards.map(async file => JSON.parse(await readFile(new URL(file, directory), 'utf8'))))).flat();
  assert.equal(details.length, 4583);
  const byId = new Map(details.map(food => [food.id, food]));
  const variantIds = new Set();
  const kindCounts = {};
  for (const food of index.foods) {
    const detail = byId.get(food.id);
    assert.equal(detail.variants.length, food.variantCount);
    for (const variant of detail.variants) {
      assert(!variantIds.has(variant.id)); variantIds.add(variant.id);
      assert(variant.items.length <= 50);
      assert.equal(new Set(variant.items.map(item => item.id)).size, variant.items.length);
      for (const item of variant.items) {
        for (const key of ['qty', 'quantity', 'unit', 'preparation_steps', 'servings']) assert(!Object.hasOwn(item, key));
        kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;
      }
    }
  }
  assert.equal(variantIds.size, 5832);
  assert.equal(kindCounts.ingredient, 58255); assert.equal(kindCounts.choice, 117);
  assert.equal(kindCounts.equipment, 14); assert.equal(kindCounts.open_choice, 6); assert.equal(kindCounts.unresolved, 2);
});
