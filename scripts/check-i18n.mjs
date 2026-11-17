// Verifies every static t('key') used in src/ exists in src/i18n/locales/en.json.
// Dynamic keys (template literals) are listed with their static prefix so they can be checked by hand.
// Run with: node scripts/check-i18n.mjs [--list]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(root, 'src/i18n/locales/en.json'), 'utf8'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function has(key) {
  let node = en;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) node = node[part];
    else {
      // i18next plural forms: key_one / key_other.
      const last = key.split('.').pop();
      return node && typeof node === 'object' && (`${last}_one` in node || `${last}_other` in node) && part === last;
    }
  }
  return true;
}

const used = new Set();
const dynamic = new Set();
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]*)\$\{/g)) dynamic.add(m[1]);
  for (const m of src.matchAll(/\bi18n\.t\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\b(?:t|tr)\(\s*(?:[a-zA-Z]+\s*\?\s*)?'([a-zA-Z0-9_.]+)'\s*:\s*'([a-zA-Z0-9_.]+)'/g)) {
    used.add(m[1]);
    used.add(m[2]);
  }
}

const missing = [...used].filter((k) => !has(k)).sort();
if (process.argv.includes('--list')) console.log([...used].sort().join('\n'));
console.log(`Static keys used: ${used.size}`);
console.log(`Dynamic key prefixes: ${[...dynamic].sort().join(', ')}`);
if (missing.length) {
  console.log(`MISSING (${missing.length}):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log('All static keys present.');
