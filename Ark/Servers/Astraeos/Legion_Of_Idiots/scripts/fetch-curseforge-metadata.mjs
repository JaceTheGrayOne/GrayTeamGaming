// Fetch + cache CurseForge metadata for every mod in mod-reference.yaml.
//
// Behaviour:
//   - If CURSEFORGE_API_KEY is set, query the official API by CurseID and cache
//     name / summary / logo URL / website URL / categories, and download the
//     logo into assets/mod-thumbnails/<id>.<ext>.
//   - If no API key is set, this is best-effort only: it records the public
//     CurseForge URL from the YAML so the build still has a link source. It does
//     NOT scrape pages and never fails the pipeline.
//
// Nothing here is required at runtime. The generated site works from static
// files alone; this only enriches the cache in data/fetched-metadata.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseYaml } from './lib/mini-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const YAML_PATH = join(root, 'data', 'mod-reference.yaml');
const CACHE_PATH = join(root, 'data', 'fetched-metadata.json');
const THUMB_DIR = join(root, 'assets', 'mod-thumbnails');

const API_KEY = process.env.CURSEFORGE_API_KEY?.trim();
const API_BASE = 'https://api.curseforge.com/v1';

function loadCache() {
  if (existsSync(CACHE_PATH)) {
    try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { /* ignore */ }
  }
  return { fetchedAt: null, source: null, mods: {} };
}

async function fetchOne(curseId) {
  const res = await fetch(`${API_BASE}/mods/${curseId}`, {
    headers: { Accept: 'application/json', 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data } = await res.json();
  return {
    name: data.name,
    summary: data.summary,
    websiteUrl: data.links?.websiteUrl || '',
    logoUrl: data.logo?.thumbnailUrl || data.logo?.url || '',
    categories: (data.categories || []).map((c) => c.name),
  };
}

async function downloadThumb(curseId, url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = (url.split('?')[0].match(/\.(png|jpg|jpeg|webp|gif)$/i)?.[1] || 'png').toLowerCase();
    mkdirSync(THUMB_DIR, { recursive: true });
    const file = join(THUMB_DIR, `${curseId}.${ext}`);
    writeFileSync(file, buf);
    return `assets/mod-thumbnails/${curseId}.${ext}`;
  } catch {
    return null;
  }
}

async function main() {
  const doc = parseYaml(readFileSync(YAML_PATH, 'utf8'));
  const mods = doc.mods || [];
  const cache = loadCache();

  if (!API_KEY) {
    console.log('No CURSEFORGE_API_KEY set — best-effort mode (recording URLs only, no API calls).');
    cache.source = 'csv-urls';
    cache.fetchedAt = new Date().toISOString();
    for (const m of mods) {
      cache.mods[m.curseId] = {
        ...(cache.mods[m.curseId] || {}),
        name: m.sourceName,
        websiteUrl: m.curseforgeUrl || cache.mods[m.curseId]?.websiteUrl || '',
      };
    }
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
    console.log(`Cache updated for ${mods.length} mods (URLs only) -> ${CACHE_PATH}`);
    return;
  }

  console.log(`Fetching metadata for ${mods.length} mods from CurseForge API...`);
  cache.source = 'curseforge-api';
  cache.fetchedAt = new Date().toISOString();
  let ok = 0, failed = 0;
  for (const m of mods) {
    try {
      const meta = await fetchOne(m.curseId);
      const thumb = await downloadThumb(m.curseId, meta.logoUrl);
      cache.mods[m.curseId] = { ...meta, thumbnail: thumb || cache.mods[m.curseId]?.thumbnail || null };
      ok++;
      process.stdout.write('.');
    } catch (err) {
      failed++;
      cache.mods[m.curseId] = {
        ...(cache.mods[m.curseId] || {}),
        name: m.sourceName,
        websiteUrl: m.curseforgeUrl || '',
        error: String(err.message || err),
      };
      process.stdout.write('x');
    }
  }
  process.stdout.write('\n');
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  console.log(`Done. ${ok} fetched, ${failed} failed -> ${CACHE_PATH}`);
}

main().catch((err) => {
  console.error('fetch failed (non-fatal):', err);
  process.exit(0); // never break the pipeline
});
