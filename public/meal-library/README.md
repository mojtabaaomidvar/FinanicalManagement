# Prepared food library

This directory is a display-only projection of the reviewed recipe dataset. It is
not an import into a household database and is not a collection of cooking
instructions or established recipe amounts.

- Source schema: `2.0.0`
- Projection schema: `1`
- Foods: 4,583
- Whole ingredient variants: 5,832
- Source meal labels: 10 (including the original ambiguous placeholder)
- Source food-type paths: 50
- Source SHA-256: `da49cd9a2241b402b5cf1ccbf9a5ac1a30bde5135ed96c712447706a645af36a`

`index.json` contains titles, aliases, classification identities and short ingredient
previews. The 256 `details-*.json` shards contain separate whole variants and their
ordinary, optional, alternative, open-choice, equipment and unresolved items. The
application loads a shard only after the user selects a food. These JSON files are
not bundled into JavaScript or included in the service worker's shell precache.

Regenerate from the unchanged reviewed source in the original workspace:

```powershell
node scripts/build-meal-library.mjs "C:\Users\383\Desktop\personal-finance-pwa\غذا\processed\recipes.json"
node --test scripts/build-meal-library.test.mjs
```

Titles, ingredient names, category labels and their source identities are catalogue
data, not fixed interface copy. Only a user's explicitly reviewed selection becomes
a family dish. Unknown ingredient amounts are persisted as `qty: null`; never infer
an amount of one from a name-only ingredient.
