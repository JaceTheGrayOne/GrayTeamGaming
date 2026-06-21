// Seed a baseline mod-reference.yaml from the source CSV.
//
// The CSV (Mod Name, CurseID, URL) is the authoritative seed list. This script
// turns it into a YAML skeleton with conservative placeholders so a human can
// fill in categories / descriptions / tips.
//
// IMPORTANT: data/mod-reference.yaml is the curated source of truth. To avoid
// clobbering hand-edited content, if that file already exists this script
// writes to data/mod-reference.seed.yaml instead and tells you to merge.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dumpYaml } from './lib/mini-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CSV_PATH = join(root, '..', 'Current_Mod_List_Astraeos_Josh.md.csv');
const TARGET = join(root, 'data', 'mod-reference.yaml');
const FALLBACK = join(root, 'data', 'mod-reference.seed.yaml');

// Tiny CSV parser that understands quoted fields with embedded commas.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csv = readFileSync(CSV_PATH, 'utf8');
const rows = parseCsv(csv);
const header = rows.shift();
const nameIdx = header.indexOf('Mod Name');
const idIdx = header.indexOf('CurseID');
const urlIdx = header.indexOf('URL');

const mods = rows
  .filter((r) => r[nameIdx])
  .map((r) => ({
    curseId: parseInt(r[idIdx], 10),
    sourceName: r[nameIdx].trim(),
    displayName: r[nameIdx].trim(),
    curseforgeUrl: (r[urlIdx] || '').trim(),
    thumbnail: `assets/mod-thumbnails/${parseInt(r[idIdx], 10)}.webp`,
    primaryCategory: 'Uncategorized',
    additionalCategories: [],
    description: 'Describe what this mod does.',
    tips: [],
    tags: [],
  }));

const doc = {
  site: {
    serverName: 'Lost Colony',
    pageTitle: 'ARK Ascended Mods',
    subtitle: 'Player Quick Reference',
    introText: 'Fast answers for what each installed mod does and why it matters.',
    accentColor: '#00e5ff',
    backgroundImage: '',
    showThumbnails: true,
    showAdditionalCategoryPills: true,
    footerText: '',
    categoryOrder: [],
  },
  categories: [
    { id: 'uncategorized', label: 'Uncategorized', color: '#90a4ae', icon: 'assets/category-icons/default.svg' },
  ],
  mods,
};

const out = existsSync(TARGET) ? FALLBACK : TARGET;
writeFileSync(out, dumpYaml(doc), 'utf8');

console.log(`Seeded ${mods.length} mods -> ${out}`);
if (out === FALLBACK) {
  console.log('NOTE: data/mod-reference.yaml already exists and was NOT overwritten.');
  console.log('      Review data/mod-reference.seed.yaml and merge any new mods manually.');
}
