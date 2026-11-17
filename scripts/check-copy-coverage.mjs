import { resolve } from 'node:path';
import { collectCatalog } from './copy-workbench/catalog.mjs';

// Review definite display omissions and invalid explicit registrations. Internal
// strings, user records and form defaults are not coverage failures.
const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt >= 0 ? resolve(args[rootAt + 1] ?? '.') : process.cwd();
try {
  const catalog = await collectCatalog(root);
  const review = catalog.audit.needsReview;
  if (args.includes('--json')) console.log(JSON.stringify({ passed: review.length === 0, entries: catalog.entries.length, needsReview: review }, null, 2));
  else if (!review.length) console.log(`PASS: ${catalog.entries.length} editable UI texts; no unregistered display candidates.`);
  else {
    console.error(`Review ${review.length} UI text candidate(s). Register software text with @copy-text; preserve user data and technical values.`);
    for (const item of review) console.error(`${item.file}:${item.line} ${JSON.stringify(item.text)} — ${item.reason}`);
  }
  if (review.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
