// Build a local item wiki cache for the static item reference page.
//
// This script is the only place item wiki network calls belong. The generated
// site consumes data/item-wiki-cache.json and never fetches wiki data at view time.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readCsv } from './lib/csv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PATHS = {
  manifest: join(root, 'assets', 'items', 'ASA_LegionOfIdiots_Item_Manifest.csv'),
  cache: join(root, 'data', 'item-wiki-cache.json'),
  reportDir: join(root, '_local', 'docs', 'Data_Collection'),
};
PATHS.report = join(PATHS.reportDir, 'Item_Wiki_Enrichment_Report.md');

const WIKI_API = 'https://ark.wiki.gg/api.php';
const USER_AGENT = 'LegionOfIdiotsItemWikiEnricher/1.0 (local static-site data cache)';

const BLOCKED_WIKI_TITLE_PATTERNS = [
  /^Mobile:/i,
  /^ARK Mobile:/i,
];

function parseArgs(argv) {
  const options = { limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') {
      const value = argv[++i];
      if (!value || !/^\d+$/.test(value)) throw new Error('--limit requires a positive integer.');
      options.limit = Number(value);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`Enrich item descriptions from ark.wiki.gg.

Usage:
  node scripts/enrich-item-wiki-data.mjs [--limit <n>]

Outputs:
  ${PATHS.cache}
  ${PATHS.report}`);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function titleKey(title) {
  return String(title || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isBlockedWikiTitle(title) {
  return BLOCKED_WIKI_TITLE_PATTERNS.some((pattern) => pattern.test(String(title || '').trim()));
}

function firstWikiUrl(enrichmentSources) {
  return String(enrichmentSources || '')
    .split(';')
    .map((part) => part.trim())
    .find((url) => {
      if (!/^https:\/\/ark\.wiki\.gg\/wiki\//i.test(url)) return false;
      const title = decodeURIComponent(url.split('/wiki/')[1] || '');
      return !/^(Special|File|Category|Template):/i.test(title) && !isBlockedWikiTitle(title);
    }) || '';
}

function titleFromWikiUrl(raw) {
  try {
    const url = new URL(raw);
    if (!/(\.|^)ark\.wiki\.gg$/i.test(url.hostname)) return '';
    if (!url.pathname.startsWith('/wiki/')) return '';
    const title = decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
    return /^(Special|File|Category|Template):/i.test(title) || isBlockedWikiTitle(title) ? '' : title;
  } catch {
    return '';
  }
}

function cleanDescription(text) {
  const stripped = String(text || '')
    .replace(/<\/?(?:onlyinclude|includeonly|noinclude)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isUsableDescription(stripped)) return '';

  const sentences = stripped.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [stripped];
  let out = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (out.length > 240) {
    out = `${out.slice(0, 237).replace(/\s+\S*$/, '')}...`;
  }
  return isUsableDescription(out) ? out : '';
}

function cleanWikiText(value) {
  let s = String(value || '');
  for (let i = 0; i < 4 && /\{\{[^{}]+\}\}/.test(s); i++) {
    s = s.replace(/\{\{ItemLink\|([^{}|]+)(?:\|([^{}]+))?\}\}/gi, (_match, target, label) => label || target);
    s = s.replace(/\{\{(?:nowrap|tooltip|ItemQuality|ItemLink|DLC|GFI)\|([^{}]+)\}\}/gi, (_match, body) => {
      const parts = String(body).split('|').filter((part) => !/^[a-z0-9_]+\s*=/i.test(part));
      return parts.at(-1) || parts[0] || '';
    });
    s = s.replace(/\{\{[^{}]+\}\}/g, '');
  }
  return s
    .replace(/<\/?(?:onlyinclude|includeonly|noinclude)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableDescription(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/<[^>]+>/.test(s)) return false;
  if (/^\s*[a-z]{2}\s*:/i.test(s)) return false;
  if (/^\{\{.*\}\}$/.test(s)) return false;
  return s.length >= 8;
}

function parseInfoboxFields(wikitext) {
  const fields = {};
  let sawInfobox = false;
  for (const line of String(wikitext || '').split(/\r?\n/)) {
    if (/^\{\{infobox/i.test(line.trim())) sawInfobox = true;
    if (!sawInfobox) continue;
    const match = line.match(/^\|\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match) fields[match[1].toLowerCase()] = cleanWikiText(match[2]);
    if (sawInfobox && line.trim() === '}}') break;
  }
  return fields;
}

function stripInfobox(wikitext) {
  const lines = String(wikitext || '').split(/\r?\n/);
  const out = [];
  let inInfobox = false;
  let depth = 0;

  for (const line of lines) {
    if (!inInfobox && /^\{\{infobox/i.test(line.trim())) {
      inInfobox = true;
    }
    if (inInfobox) {
      depth += (line.match(/\{\{/g) || []).length;
      depth -= (line.match(/\}\}/g) || []).length;
      if (depth <= 0) inInfobox = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function introDescriptionFromWikitext(wikitext) {
  const intro = stripInfobox(wikitext).split(/\n==+\s*/)[0] || '';
  const paragraphs = intro.split(/\n{2,}/)
    .map((paragraph) => cleanWikiText(paragraph))
    .filter((paragraph) => paragraph && !/^\[\[Category:/i.test(paragraph));
  return cleanDescription(paragraphs[0] || '');
}

function descriptionFromWikitext(wikitext, fields) {
  return cleanDescription(fields.description) || introDescriptionFromWikitext(wikitext);
}

function craftingStationsFromFields(fields) {
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (/^craftedin\d*$/i.test(key) && value) values.push(value);
  }
  return [...new Set(values)].join('; ');
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function wikiApi(params) {
  const body = new URLSearchParams({ ...params, format: 'json' });
  const res = await fetch(WIKI_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.code || 'wiki error'}: ${json.error.info || ''}`);
  return json;
}

async function fetchPageBatch(titles) {
  const json = await wikiApi({
    action: 'query',
    prop: 'revisions|info',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    inprop: 'url',
    titles: titles.join('|'),
  });

  const redirects = new Map();
  for (const redirect of json.query?.redirects || []) {
    redirects.set(titleKey(redirect.from), redirect.to);
  }

  const pages = new Map();
  for (const page of Object.values(json.query?.pages || {})) {
    pages.set(titleKey(page.title), page);
  }

  const out = new Map();
  for (const title of titles) {
    const finalTitle = redirects.get(titleKey(title)) || title;
    const page = pages.get(titleKey(finalTitle)) || pages.get(titleKey(title));
    const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] || page?.revisions?.[0]?.['*'] || '';
    const fields = parseInfoboxFields(wikitext);
    out.set(titleKey(title), page && !page.missing ? {
      title: page.title,
      fullUrl: page.fullurl || '',
      description: descriptionFromWikitext(wikitext, fields),
      craftingStation: craftingStationsFromFields(fields),
    } : null);
  }
  return out;
}

function buildTasks(rows, limit) {
  const tasks = rows.map((row) => {
    const wikiUrl = firstWikiUrl(row.enrichmentSources);
    return {
      row,
      wikiUrl,
      title: titleFromWikiUrl(wikiUrl),
    };
  });
  return limit ? tasks.slice(0, limit) : tasks;
}

function baseCacheEntry(task, oldEntry) {
  const oldWikiUrl = titleFromWikiUrl(oldEntry.wikiUrl || '') ? oldEntry.wikiUrl : '';
  const oldWikiTitle = oldWikiUrl ? oldEntry.wikiTitle : '';
  const oldDescription = task.wikiUrl || oldWikiUrl ? cleanDescription(oldEntry.description || '') : '';
  return {
    itemKey: task.row.itemKey,
    displayName: task.row.displayName,
    className: task.row.className,
    wikiUrl: task.wikiUrl || oldWikiUrl || '',
    wikiTitle: task.title || oldWikiTitle || '',
    description: oldDescription,
    craftingStation: oldEntry.craftingStation || task.row.craftingStation || '',
    status: task.wikiUrl ? 'pending' : 'no-wiki',
    fetchedAt: oldEntry.fetchedAt || null,
    error: '',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!existsSync(PATHS.manifest)) {
    throw new Error(`Item manifest not found: ${PATHS.manifest}`);
  }

  mkdirSync(PATHS.reportDir, { recursive: true });
  const manifestRows = readCsv(PATHS.manifest).rows;
  const oldCache = readJson(PATHS.cache, { items: {} });
  const oldItems = oldCache.items || {};
  const tasks = buildTasks(manifestRows, options.limit);
  const items = {};
  for (const task of tasks) {
    items[task.row.itemKey] = baseCacheEntry(task, oldItems[task.row.itemKey] || {});
  }

  const titleMap = new Map();
  for (const task of tasks) {
    if (task.title) titleMap.set(titleKey(task.title), task.title);
  }
  const titles = [...titleMap.values()];
  const batches = chunk(titles, 50);
  const pageData = new Map();
  const batchErrors = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const fetched = await fetchPageBatch(batch);
      for (const [key, value] of fetched) pageData.set(key, value);
    } catch (error) {
      batchErrors.push(`Batch ${i + 1}: ${error.message}`);
      for (const title of batch) pageData.set(titleKey(title), null);
    }
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`Wiki description batches: ${i + 1}/${batches.length}`);
    }
    if (i < batches.length - 1) await sleep(150);
  }

  const now = new Date().toISOString();
  for (const task of tasks) {
    const oldEntry = oldItems[task.row.itemKey] || {};
    const entry = items[task.row.itemKey];
    if (!task.title) {
      entry.status = 'no-wiki';
      continue;
    }

    const page = pageData.get(titleKey(task.title));
    if (!page) {
      entry.status = oldEntry.description ? 'cached' : 'missing';
      entry.error = 'No wiki extract returned.';
      continue;
    }

    entry.wikiTitle = page.title || task.title;
    entry.wikiUrl = page.fullUrl || task.wikiUrl;
    entry.description = page.description || cleanDescription(oldEntry.description || '') || '';
    entry.craftingStation = page.craftingStation || oldEntry.craftingStation || task.row.craftingStation || '';
    entry.status = entry.description ? 'resolved' : 'no-description';
    entry.fetchedAt = now;
    entry.error = '';
  }

  const output = {
    generatedAt: now,
    source: 'ark.wiki.gg revision wikitext',
    api: WIKI_API,
    manifest: 'assets/items/ASA_LegionOfIdiots_Item_Manifest.csv',
    note: 'Build-time cache only. The generated static site does not fetch wiki data at runtime.',
    items,
  };
  writeFileSync(PATHS.cache, JSON.stringify(output, null, 2), 'utf8');

  const processed = tasks.length;
  const entries = Object.values(items);
  const wikiLinks = entries.filter((entry) => entry.wikiUrl).length;
  const descriptions = entries.filter((entry) => entry.description).length;
  const craftingStations = entries.filter((entry) => entry.craftingStation).length;
  const missingDescriptions = entries.filter((entry) => !entry.description).length;

  const report = `# Item Wiki Enrichment Report

Run date/time: ${now}

## Inputs

- Manifest: \`${PATHS.manifest}\`
- Wiki API: ${WIKI_API}
- Existing cache: \`${PATHS.cache}\`

## Summary

- Rows processed: ${processed}
- Wiki links resolved: ${wikiLinks}
- Descriptions resolved: ${descriptions}
- Crafting stations resolved: ${craftingStations}
- Rows missing descriptions: ${missingDescriptions}
- Batch errors: ${batchErrors.length || 'None'}

## Notes

- Crafting station values are only preserved from existing cache/manual data; no guessed wiki field is used.
- Existing cached descriptions are preserved when a page extract is missing.

${batchErrors.length ? `## Batch Errors\n\n${batchErrors.map((error) => `- ${error}`).join('\n')}\n` : ''}
## Outputs

- Cache: \`${PATHS.cache}\`
- Report: \`${PATHS.report}\`
`;
  writeFileSync(PATHS.report, report, 'utf8');

  console.log(`Rows processed: ${processed}`);
  console.log(`Wiki links resolved: ${wikiLinks}`);
  console.log(`Descriptions resolved: ${descriptions}`);
  console.log(`Crafting stations resolved: ${craftingStations}`);
  console.log(`Rows missing descriptions: ${missingDescriptions}`);
  console.log(`Wrote ${PATHS.cache}`);
  console.log(`Wrote ${PATHS.report}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
