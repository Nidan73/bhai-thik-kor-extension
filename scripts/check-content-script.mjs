import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contentPath = resolve('dist/content.js');
const source = readFileSync(contentPath, 'utf8');
const firstCodeLine = source
  .split(/\r?\n/)
  .map(line => line.trim())
  .find(line => line && !line.startsWith('//'));

const hasStaticImport = /^import\s/.test(firstCodeLine ?? '') || /\n\s*import\s/.test(source);
const hasStaticExport = /^export\s/.test(firstCodeLine ?? '') || /\n\s*export\s/.test(source);
const importsSharedChunk = /from\s+["']\.\/chunks\//.test(source);

if (hasStaticImport || hasStaticExport || importsSharedChunk) {
  console.error(
    'dist/content.js must be a classic self-contained content script. ' +
    'Static import/export or shared chunk imports were found.',
  );
  process.exit(1);
}

console.log('content script guard passed');
