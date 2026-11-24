import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Use the production pure parser without a database, live API or duplicated rules.
const bundled = buildSync({ entryPoints: [fileURLToPath(new URL('../../src/shared/lib/sms-parser.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
export const { parseSms } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
