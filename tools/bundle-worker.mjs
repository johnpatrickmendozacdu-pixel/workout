#!/usr/bin/env node
/**
 * Builds worker/deploy-this.js — the single file that gets pasted into the
 * Cloudflare dashboard editor.
 *
 * The Worker is written as modules because that is how it is read and tested,
 * but the dashboard editor takes one file. Keeping the paste-ready copy by hand
 * is how it silently drifts from the source, so it is generated instead:
 *
 *     node tools/bundle-worker.mjs
 *
 * Concatenation is all that is needed — the imports between these files are the
 * only ones, so dropping every `import ... from './...'` line and pasting them
 * in dependency order produces exactly the same program.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ORDER = ['worker/broker.js', 'worker/crew.js', 'worker/crew-routes.js', 'worker/index.js'];
const OUT = 'worker/deploy-this.js';

// Multi-line imports are the norm here, so this matches the whole statement
// rather than a line: the first paste of this file lost only the opening line
// of one and produced a file that would not parse.
const strip = (src) => src
  .replace(/^import\s[\s\S]*?from\s+'\.\/[^']*';[ \t]*$/gm, '')
  .replace(/^export\s+/gm, '')          // one file: nothing to export but the default
  .trimEnd();

const header = `// GENERATED — do not edit. Run: node tools/bundle-worker.mjs
//
// Paste this whole file into the Cloudflare dashboard (Workers & Pages ->
// sets-broker -> Edit code -> select all -> paste -> Deploy). It is the same
// code as worker/*.js with the imports flattened, so what runs in production is
// what the tests in tests/worker-*.test.js cover.
`;

const body = ORDER.map((f) => `\n// ===== ${f} =====\n${strip(readFileSync(f, 'utf8'))}\n`).join('');
// `export default` is the one export the Worker runtime needs back.
writeFileSync(OUT, header + body.replace(/^default \{$/m, 'export default {') + '\n');
console.log(`${OUT} written from ${ORDER.length} files`);
