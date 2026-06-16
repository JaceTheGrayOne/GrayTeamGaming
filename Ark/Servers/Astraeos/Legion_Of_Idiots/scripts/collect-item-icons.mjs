// Collect local item icon PNGs for the generated item manifest.
//
// Source priority:
// 1. Local ASA packages via the ArkConfigurator CUE4Parse CLI.
// 2. ark.wiki.gg file icons for base-game/map/wiki-backed rows.

import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const workspaceRoot = resolve(root, '..', '..', '..', '..', '..');

const PATHS = {
  outputDir: join(root, '_local', 'docs', 'Data_Collection'),
  manifest: join(root, '_local', 'docs', 'Data_Collection', 'ASA_LegionOfIdiots_Item_Manifest.csv'),
  iconRoot: join(root, '_local', 'docs', 'Data_Collection', 'item-icons'),
  cliProject: join(workspaceRoot, 'docs', 'Ark_Configurator', 'src', 'ArkConfigurator.Cli', 'ArkConfigurator.Cli.csproj'),
  cliProgram: join(workspaceRoot, 'docs', 'Ark_Configurator', 'src', 'ArkConfigurator.Cli', 'Program.cs'),
  cliDll: join(workspaceRoot, 'docs', 'Ark_Configurator', 'src', 'ArkConfigurator.Cli', 'bin', 'Debug', 'net8.0', 'arkconfigurator.dll'),
};

PATHS.packageDir = join(PATHS.iconRoot, 'package');
PATHS.packageCsv = join(PATHS.iconRoot, 'package-icons.csv');
PATHS.packageLog = join(PATHS.iconRoot, 'package-extraction.log');
PATHS.wikiDir = join(PATHS.iconRoot, 'wiki');
PATHS.wikiCache = join(PATHS.iconRoot, 'wiki-icon-cache.json');
PATHS.iconCsv = join(PATHS.outputDir, 'ASA_LegionOfIdiots_Item_Icons.csv');
PATHS.manifestWithIcons = join(PATHS.outputDir, 'ASA_LegionOfIdiots_Item_Manifest_With_Icons.csv');
PATHS.report = join(PATHS.outputDir, 'ASA_LegionOfIdiots_Item_Icon_Report.md');

const WIKI_API = 'https://ark.wiki.gg/api.php';
const USER_AGENT = 'LegionOfIdiotsItemIconCollector/1.0 (local data collection)';

const ICON_COLUMNS = [
  'itemKey',
  'displayName',
  'className',
  'sourceType',
  'sourceModId',
  'sourceModName',
  'iconStatus',
  'iconLocalPath',
  'iconSource',
  'iconMethod',
  'iconUrl',
  'iconTexturePath',
  'iconConfidence',
  'iconWidth',
  'iconHeight',
  'packageStatus',
  'wikiStatus',
  'notes',
];

const ICON_MANIFEST_COLUMNS = [
  'iconStatus',
  'iconLocalPath',
  'iconSource',
  'iconMethod',
  'iconUrl',
  'iconTexturePath',
  'iconConfidence',
  'iconWidth',
  'iconHeight',
  'iconNotes',
];

function parseArgs(argv) {
  const options = {
    skipPackage: false,
    skipWiki: false,
    maxPackage: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-package') {
      options.skipPackage = true;
    } else if (arg === '--skip-wiki') {
      options.skipWiki = true;
    } else if (arg === '--max-package') {
      const value = argv[++i];
      if (!value || !/^\d+$/.test(value)) throw new Error('--max-package requires a positive integer.');
      options.maxPackage = Number(value);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Collect item icons for ASA_LegionOfIdiots_Item_Manifest.csv.

Usage:
  node scripts/collect-item-icons.mjs [--skip-package] [--skip-wiki] [--max-package <n>]

Outputs:
  ${PATHS.iconCsv}
  ${PATHS.manifestWithIcons}
  ${PATHS.report}
  ${PATHS.iconRoot}`);
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readText(path));
  } catch {
    return fallback;
  }
}

function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length || record.length) {
    record.push(field);
    records.push(record);
  }

  return records;
}

function readCsv(path) {
  const records = parseCsvRecords(readText(path));
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0];
  const rows = records.slice(1)
    .filter((record) => record.some((value) => String(value || '').trim() !== ''))
    .map((record) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = record[index] ?? '';
      });
      return row;
    });
  return { headers, rows };
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(path, columns, rows) {
  const out = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] ?? '')).join(',')),
  ].join('\r\n') + '\r\n';
  writeFileSync(path, out, 'utf8');
}

function get(row, key) {
  return row[key] ?? '';
}

function uniq(values) {
  return [...new Set(values.filter((value) => String(value || '').trim() !== ''))];
}

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function titleKey(title) {
  return String(title || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function asFileTitle(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return /^file:/i.test(s) ? s : `File:${s}`;
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function sanitizeFileName(value) {
  const s = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
  return s || 'item-icon';
}

function relativeToOutput(path) {
  if (!path) return '';
  return normalizeSlash(relative(PATHS.outputDir, path));
}

function safeResetDir(path) {
  const resolved = resolve(path);
  const iconRoot = resolve(PATHS.iconRoot);
  if (!resolved.startsWith(iconRoot + '\\') && resolved !== iconRoot) {
    throw new Error(`Refusing to reset directory outside icon root: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
  mkdirSync(resolved, { recursive: true });
}

function shouldBuildCli() {
  if (!existsSync(PATHS.cliDll)) return true;
  if (!existsSync(PATHS.cliProgram)) return false;
  return statSync(PATHS.cliProgram).mtimeMs > statSync(PATHS.cliDll).mtimeMs;
}

function runProcess(command, args, { cwd, logPath }) {
  return new Promise((resolveProcess) => {
    const started = Date.now();
    const log = createWriteStream(logPath, { flags: 'a' });
    log.write(`\r\n> ${command} ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}\r\n`);

    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => log.write(chunk));
    child.stderr.on('data', (chunk) => log.write(chunk));
    child.on('error', (error) => {
      log.write(`\r\nProcess failed to start: ${error.stack || error.message}\r\n`);
      log.end();
      resolveProcess({ exitCode: 1, durationMs: Date.now() - started, error });
    });
    child.on('close', (exitCode) => {
      log.write(`\r\nExit code: ${exitCode}\r\n`);
      log.end();
      resolveProcess({ exitCode: exitCode ?? 1, durationMs: Date.now() - started });
    });
  });
}

async function runPackageExtraction(options) {
  mkdirSync(PATHS.iconRoot, { recursive: true });
  writeFileSync(PATHS.packageLog, `Item icon package extraction log\r\nStarted: ${new Date().toISOString()}\r\n`, 'utf8');

  if (shouldBuildCli()) {
    console.log('Building ArkConfigurator CLI for CUE4Parse package icon extraction...');
    const build = await runProcess('dotnet', ['build', PATHS.cliProject, '--nologo'], {
      cwd: workspaceRoot,
      logPath: PATHS.packageLog,
    });
    if (build.exitCode !== 0) {
      return { status: 'build-failed', exitCode: build.exitCode, durationMs: build.durationMs };
    }
  }

  safeResetDir(PATHS.packageDir);
  const args = [
    PATHS.cliDll,
    'extract-item-icons',
    '--manifest',
    PATHS.manifest,
    '--out-dir',
    PATHS.packageDir,
    '--out-csv',
    PATHS.packageCsv,
  ];
  if (options.maxPackage) args.push('--max', String(options.maxPackage));

  console.log('Running CUE4Parse package icon extraction; detailed output is being written to package-extraction.log...');
  const extraction = await runProcess('dotnet', args, {
    cwd: workspaceRoot,
    logPath: PATHS.packageLog,
  });
  return {
    status: extraction.exitCode === 0 ? 'ok' : 'failed',
    exitCode: extraction.exitCode,
    durationMs: extraction.durationMs,
  };
}

function loadPackageRows() {
  if (!existsSync(PATHS.packageCsv)) return [];
  return readCsv(PATHS.packageCsv).rows;
}

function mapPackageRows(rows) {
  const byItemKey = new Map();
  for (const row of rows) {
    const key = get(row, 'itemKey');
    if (key) byItemKey.set(key, row);
  }
  return byItemKey;
}

function pageTitleFromWikiUrl(raw) {
  try {
    const url = new URL(raw.trim());
    if (!/(\.|^)ark\.wiki\.gg$/i.test(url.hostname)) return '';
    if (!url.pathname.startsWith('/wiki/')) return '';
    const title = decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
    if (!title || /^special:/i.test(title) || /^file:/i.test(title)) return '';
    return title;
  } catch {
    return '';
  }
}

function pageTitlesForRow(row) {
  const titles = [];
  if (get(row, 'displayName')) titles.push(get(row, 'displayName'));
  for (const part of String(get(row, 'enrichmentSources')).split(';')) {
    const title = pageTitleFromWikiUrl(part);
    if (title) titles.push(title);
  }
  return uniq(titles);
}

function isWikiEligible(row) {
  const sourceType = get(row, 'sourceType');
  if (sourceType === 'base-game' || sourceType === 'map') return true;
  if (String(get(row, 'sourceEvidence')).includes('wiki')) return true;
  return String(get(row, 'enrichmentSources')).includes('ark.wiki.gg/wiki/');
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function wikiApi(params) {
  const body = new URLSearchParams({ ...params, format: 'json' });
  const res = await fetchWithRetry(WIKI_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body,
  });
  return res.json();
}

function emptyWikiCache() {
  return {
    fetchedAt: null,
    pages: {},
    files: {},
  };
}

async function refreshPageThumbs(titles, cache) {
  const missing = uniq(titles)
    .filter((title) => !cache.pages[titleKey(title)]);
  const batches = chunk(missing, 50);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`  wiki page metadata: ${i + 1}/${batches.length} batches`);
    }
    const json = await wikiApi({
      action: 'query',
      titles: batch.join('|'),
      prop: 'pageprops',
    });
    for (const page of Object.values(json.query?.pages || {})) {
      cache.pages[titleKey(page.title)] = {
        title: page.title,
        exists: !page.missing,
        thumb: page.pageprops?.thumb || '',
        fetchedAt: new Date().toISOString(),
      };
    }
  }
}

async function refreshFileInfos(titles, cache) {
  const missing = uniq(titles)
    .filter((title) => !cache.files[titleKey(title)]);
  const batches = chunk(missing, 50);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`  wiki file metadata: ${i + 1}/${batches.length} batches`);
    }
    const json = await wikiApi({
      action: 'query',
      titles: batch.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|mime|size',
    });
    for (const page of Object.values(json.query?.pages || {})) {
      const info = page.imageinfo?.[0];
      cache.files[titleKey(page.title)] = {
        title: page.title,
        exists: !page.missing && Boolean(info?.url),
        url: info?.url || '',
        mime: info?.mime || '',
        width: info?.width ? String(info.width) : '',
        height: info?.height ? String(info.height) : '',
        size: info?.size ? String(info.size) : '',
        descriptionUrl: info?.descriptionurl || '',
        fetchedAt: new Date().toISOString(),
      };
    }
  }
}

function fileTitleVariants(row, pageTitles, cache) {
  const titles = [];
  for (const pageTitle of pageTitles) {
    const page = cache.pages[titleKey(pageTitle)];
    if (page?.thumb) titles.push(asFileTitle(page.thumb));
    titles.push(asFileTitle(`${pageTitle}.png`));
  }
  if (get(row, 'displayName')) titles.push(asFileTitle(`${get(row, 'displayName')}.png`));
  return uniq(titles);
}

function extensionForFile(info) {
  if (info.mime === 'image/png') return '.png';
  if (info.mime === 'image/jpeg') return '.jpg';
  if (info.mime === 'image/webp') return '.webp';
  try {
    const parsed = new URL(info.url);
    return extname(parsed.pathname) || '.img';
  } catch {
    return '.img';
  }
}

async function mapLimit(values, limit, fn) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function downloadWikiIcon(task) {
  const { row, fileInfo } = task;
  const fileBase = sanitizeFileName(get(row, 'className') || get(row, 'displayName') || get(row, 'itemKey'));
  const ext = extensionForFile(fileInfo);
  const outPath = join(PATHS.wikiDir, `${fileBase}-${shortHash(`${get(row, 'itemKey')}|${fileInfo.title}`)}${ext}`);
  try {
    const res = await fetchWithRetry(fileInfo.url, {
      headers: { 'user-agent': USER_AGENT },
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, bytes);
    return {
      itemKey: get(row, 'itemKey'),
      status: 'resolved',
      iconLocalPath: outPath,
      iconSource: 'wiki',
      iconMethod: 'wiki-file',
      iconUrl: fileInfo.url,
      texturePath: '',
      confidence: '0.7',
      width: fileInfo.width,
      height: fileInfo.height,
      notes: fileInfo.title,
    };
  } catch (error) {
    return {
      itemKey: get(row, 'itemKey'),
      status: 'missing',
      notes: `Wiki icon download failed for ${fileInfo.title}: ${error.message}`,
    };
  }
}

async function collectWikiIcons(manifestRows, packageMap, options) {
  if (options.skipWiki) {
    return { rows: [], status: 'skipped', error: '' };
  }

  safeResetDir(PATHS.wikiDir);
  const cache = loadJson(PATHS.wikiCache, emptyWikiCache());
  cache.pages ||= {};
  cache.files ||= {};

  const candidates = manifestRows.filter((row) => {
    const packageRow = packageMap.get(get(row, 'itemKey'));
    return !(packageRow && get(packageRow, 'status') === 'resolved') && isWikiEligible(row);
  });

  if (!candidates.length) {
    writeFileSync(PATHS.wikiCache, JSON.stringify({ ...cache, fetchedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { rows: [], status: 'ok', error: '' };
  }

  console.log(`Resolving wiki icon metadata for ${candidates.length} non-package rows...`);
  try {
    const pageTitlesByKey = new Map();
    for (const row of candidates) {
      pageTitlesByKey.set(get(row, 'itemKey'), pageTitlesForRow(row));
    }
    await refreshPageThumbs([...new Set([...pageTitlesByKey.values()].flat())], cache);

    const fileTitlesByKey = new Map();
    const allFileTitles = [];
    for (const row of candidates) {
      const variants = fileTitleVariants(row, pageTitlesByKey.get(get(row, 'itemKey')) || [], cache);
      fileTitlesByKey.set(get(row, 'itemKey'), variants);
      allFileTitles.push(...variants);
    }
    await refreshFileInfos(allFileTitles, cache);
    writeFileSync(PATHS.wikiCache, JSON.stringify({ ...cache, fetchedAt: new Date().toISOString() }, null, 2), 'utf8');

    const downloads = [];
    const missingRows = [];
    for (const row of candidates) {
      const fileInfo = (fileTitlesByKey.get(get(row, 'itemKey')) || [])
        .map((title) => cache.files[titleKey(title)])
        .find((info) => info?.exists && info.url);
      if (fileInfo) {
        downloads.push({ row, fileInfo });
      } else {
        missingRows.push({
          itemKey: get(row, 'itemKey'),
          status: 'missing',
          notes: 'No matching wiki File:<item>.png imageinfo result.',
        });
      }
    }

    console.log(`Downloading ${downloads.length} wiki icon files...`);
    const downloadedRows = await mapLimit(downloads, 8, async (task, index) => {
      if ((index + 1) % 200 === 0 || index === downloads.length - 1) {
        console.log(`  wiki downloads: ${index + 1}/${downloads.length}`);
      }
      return downloadWikiIcon(task);
    });
    return { rows: [...downloadedRows, ...missingRows], status: 'ok', error: '' };
  } catch (error) {
    writeFileSync(PATHS.wikiCache, JSON.stringify({ ...cache, fetchedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { rows: [], status: 'failed', error: error.stack || error.message };
  }
}

function selectIcon(manifestRow, packageRow, wikiRow) {
  if (packageRow && get(packageRow, 'status') === 'resolved') {
    return {
      status: 'resolved',
      iconLocalPath: relativeToOutput(get(packageRow, 'iconLocalPath')),
      iconSource: 'package',
      iconMethod: get(packageRow, 'iconMethod'),
      iconUrl: '',
      iconTexturePath: get(packageRow, 'texturePath'),
      iconConfidence: get(packageRow, 'confidence'),
      iconWidth: get(packageRow, 'width'),
      iconHeight: get(packageRow, 'height'),
      notes: get(packageRow, 'notes'),
    };
  }

  if (wikiRow && get(wikiRow, 'status') === 'resolved') {
    return {
      status: 'resolved',
      iconLocalPath: relativeToOutput(get(wikiRow, 'iconLocalPath')),
      iconSource: 'wiki',
      iconMethod: get(wikiRow, 'iconMethod'),
      iconUrl: get(wikiRow, 'iconUrl'),
      iconTexturePath: '',
      iconConfidence: get(wikiRow, 'confidence'),
      iconWidth: get(wikiRow, 'width'),
      iconHeight: get(wikiRow, 'height'),
      notes: get(wikiRow, 'notes'),
    };
  }

  const notes = uniq([
    packageRow && get(packageRow, 'notes') ? `package: ${get(packageRow, 'notes')}` : '',
    wikiRow && get(wikiRow, 'notes') ? `wiki: ${get(wikiRow, 'notes')}` : '',
    !isWikiEligible(manifestRow) ? 'wiki: skipped for non-wiki mod row to avoid false matches' : '',
  ]).join(' | ');

  return {
    status: 'missing',
    iconLocalPath: '',
    iconSource: '',
    iconMethod: '',
    iconUrl: '',
    iconTexturePath: '',
    iconConfidence: '0',
    iconWidth: '',
    iconHeight: '',
    notes,
  };
}

function buildIconRows(manifestRows, packageMap, wikiMap) {
  return manifestRows.map((manifestRow) => {
    const itemKey = get(manifestRow, 'itemKey');
    const packageRow = packageMap.get(itemKey);
    const wikiRow = wikiMap.get(itemKey);
    const selected = selectIcon(manifestRow, packageRow, wikiRow);
    return {
      itemKey,
      displayName: get(manifestRow, 'displayName'),
      className: get(manifestRow, 'className'),
      sourceType: get(manifestRow, 'sourceType'),
      sourceModId: get(manifestRow, 'sourceModId'),
      sourceModName: get(manifestRow, 'sourceModName'),
      iconStatus: selected.status,
      iconLocalPath: selected.iconLocalPath,
      iconSource: selected.iconSource,
      iconMethod: selected.iconMethod,
      iconUrl: selected.iconUrl,
      iconTexturePath: selected.iconTexturePath,
      iconConfidence: selected.iconConfidence,
      iconWidth: selected.iconWidth,
      iconHeight: selected.iconHeight,
      packageStatus: packageRow ? get(packageRow, 'status') : 'not-attempted',
      wikiStatus: wikiRow ? get(wikiRow, 'status') : isWikiEligible(manifestRow) ? 'not-attempted' : 'not-eligible',
      notes: selected.notes,
    };
  });
}

function buildManifestWithIcons(headers, manifestRows, iconRows) {
  const iconByKey = new Map(iconRows.map((row) => [get(row, 'itemKey'), row]));
  const outHeaders = [...headers, ...ICON_MANIFEST_COLUMNS.filter((column) => !headers.includes(column))];
  const rows = manifestRows.map((row) => {
    const icon = iconByKey.get(get(row, 'itemKey')) || {};
    return {
      ...row,
      iconStatus: get(icon, 'iconStatus'),
      iconLocalPath: get(icon, 'iconLocalPath'),
      iconSource: get(icon, 'iconSource'),
      iconMethod: get(icon, 'iconMethod'),
      iconUrl: get(icon, 'iconUrl'),
      iconTexturePath: get(icon, 'iconTexturePath'),
      iconConfidence: get(icon, 'iconConfidence'),
      iconWidth: get(icon, 'iconWidth'),
      iconHeight: get(icon, 'iconHeight'),
      iconNotes: get(icon, 'notes'),
    };
  });
  return { headers: outHeaders, rows };
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = get(row, key) || '(blank)';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function markdownCountList(entries) {
  return entries.length ? entries.map(([key, count]) => `- ${key}: ${count}`).join('\n') : '- None';
}

function sourceCoverageTable(iconRows) {
  const bySource = new Map();
  for (const row of iconRows) {
    const key = get(row, 'sourceType') || '(blank)';
    const entry = bySource.get(key) || { total: 0, resolved: 0, package: 0, wiki: 0, missing: 0 };
    entry.total++;
    if (get(row, 'iconStatus') === 'resolved') entry.resolved++;
    if (get(row, 'iconSource') === 'package') entry.package++;
    if (get(row, 'iconSource') === 'wiki') entry.wiki++;
    if (get(row, 'iconStatus') !== 'resolved') entry.missing++;
    bySource.set(key, entry);
  }

  const lines = [
    '| Source type | Total | Resolved | Package | Wiki | Missing |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [source, entry] of [...bySource.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${source} | ${entry.total} | ${entry.resolved} | ${entry.package} | ${entry.wiki} | ${entry.missing} |`);
  }
  return lines.join('\n');
}

function missingSample(iconRows) {
  const missing = iconRows.filter((row) => get(row, 'iconStatus') !== 'resolved');
  if (!missing.length) return '- None';
  return missing.slice(0, 100).map((row) => (
    `- ${get(row, 'displayName') || get(row, 'className') || get(row, 'itemKey')} ` +
    `(${get(row, 'sourceType')}${get(row, 'sourceModId') ? ` ${get(row, 'sourceModId')}` : ''}): ${get(row, 'notes') || 'no icon source found'}`
  )).join('\n') + (missing.length > 100 ? `\n- ... ${missing.length - 100} more; see ${PATHS.iconCsv}` : '');
}

function writeReport({ iconRows, packageRun, wikiRun }) {
  const runDate = new Date().toISOString();
  const total = iconRows.length;
  const resolved = iconRows.filter((row) => get(row, 'iconStatus') === 'resolved').length;
  const packageResolved = iconRows.filter((row) => get(row, 'iconSource') === 'package').length;
  const wikiResolved = iconRows.filter((row) => get(row, 'iconSource') === 'wiki').length;
  const missing = total - resolved;
  const report = `# ASA Legion Of Idiots Item Icon Collection Report

Run date/time: ${runDate}

## Inputs

- Manifest: \`${PATHS.manifest}\`
- Package extractor: \`${PATHS.cliDll}\`
- Wiki API: ${WIKI_API}

## Summary

- Manifest rows: ${total}
- Icons resolved: ${resolved}
- Icons missing: ${missing}
- Package icons resolved: ${packageResolved}
- Wiki icons resolved: ${wikiResolved}
- Package extraction status: ${packageRun.status}${packageRun.exitCode !== undefined ? ` (exit ${packageRun.exitCode})` : ''}
- Package extraction duration: ${Math.round((packageRun.durationMs || 0) / 1000)}s
- Wiki fallback status: ${wikiRun.status}
- Wiki fallback error: ${wikiRun.error || 'None'}

## Coverage By Source Type

${sourceCoverageTable(iconRows)}

## Counts By Icon Source

${markdownCountList(countBy(iconRows, 'iconSource'))}

## Counts By Package Status

${markdownCountList(countBy(iconRows, 'packageStatus'))}

## Counts By Wiki Status

${markdownCountList(countBy(iconRows, 'wikiStatus'))}

## Missing Icon Sample

${missingSample(iconRows)}

## Outputs

- Icon sidecar CSV: \`${PATHS.iconCsv}\`
- Manifest with icon columns: \`${PATHS.manifestWithIcons}\`
- Package icon CSV: \`${PATHS.packageCsv}\`
- Package extraction log: \`${PATHS.packageLog}\`
- Wiki icon cache: \`${PATHS.wikiCache}\`
- Local icon root: \`${PATHS.iconRoot}\`
`;

  writeFileSync(PATHS.report, report, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!existsSync(PATHS.manifest)) {
    throw new Error(`Item manifest not found: ${PATHS.manifest}. Run npm run collect:items first.`);
  }

  mkdirSync(PATHS.outputDir, { recursive: true });
  mkdirSync(PATHS.iconRoot, { recursive: true });

  const { headers, rows: manifestRows } = readCsv(PATHS.manifest);
  let packageRun = { status: 'skipped', durationMs: 0 };
  if (!options.skipPackage) {
    packageRun = await runPackageExtraction(options);
  }

  const packageRows = loadPackageRows();
  const packageMap = mapPackageRows(packageRows);
  const wikiRun = await collectWikiIcons(manifestRows, packageMap, options);
  const wikiMap = mapPackageRows(wikiRun.rows);
  const iconRows = buildIconRows(manifestRows, packageMap, wikiMap);
  const manifestWithIcons = buildManifestWithIcons(headers, manifestRows, iconRows);

  writeCsv(PATHS.iconCsv, ICON_COLUMNS, iconRows);
  writeCsv(PATHS.manifestWithIcons, manifestWithIcons.headers, manifestWithIcons.rows);
  writeReport({ iconRows, packageRun, wikiRun });

  const resolved = iconRows.filter((row) => get(row, 'iconStatus') === 'resolved').length;
  const packageResolved = iconRows.filter((row) => get(row, 'iconSource') === 'package').length;
  const wikiResolved = iconRows.filter((row) => get(row, 'iconSource') === 'wiki').length;
  console.log(`Icon collection complete: ${resolved}/${iconRows.length} resolved.`);
  console.log(`  package: ${packageResolved}`);
  console.log(`  wiki: ${wikiResolved}`);
  console.log(`  missing: ${iconRows.length - resolved}`);
  console.log(`Icon CSV: ${PATHS.iconCsv}`);
  console.log(`Report: ${PATHS.report}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
