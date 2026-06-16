// Collect a server-specific item manifest from active mods, local package
// manifests, server config references, and wiki.gg Cargo data.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseYaml } from './lib/mini-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const workspaceRoot = resolve(root, '..', '..', '..', '..', '..');

const PATHS = {
  gameUserSettings: join(workspaceRoot, 'Servers', 'Josh_Remote', 'Astraeos', 'GameUserSettings.ini'),
  gameIni: join(workspaceRoot, 'Servers', 'Josh_Remote', 'Astraeos', 'Game.ini'),
  discoveryRoot: join(workspaceRoot, 'Servers', 'Lost_Colony', 'Beacon Mod Discovery'),
  siteModYaml: join(root, 'data', 'mod-reference.yaml'),
  referenceLinks: join(root, '_local', 'references', 'Ark_Survival_Ascended_Info_Resources.md'),
  outputDir: join(root, '_local', 'docs', 'Data_Collection'),
};

PATHS.csv = join(PATHS.outputDir, 'ASA_LegionOfIdiots_Item_Manifest.csv');
PATHS.report = join(PATHS.outputDir, 'ASA_LegionOfIdiots_Item_Manifest_Report.md');
PATHS.wikiCache = join(PATHS.outputDir, 'wiki-items-cache.json');

const CSV_COLUMNS = [
  'itemKey',
  'displayName',
  'className',
  'blueprintPath',
  'gfiCode',
  'category',
  'sourceType',
  'sourceModId',
  'sourceModName',
  'sourcePackagePath',
  'assetPath',
  'spawnCommand',
  'stackSize',
  'weight',
  'itemId',
  'engramClassName',
  'craftingStation',
  'serverReferenced',
  'serverConfigReferences',
  'sourceEvidence',
  'enrichmentSources',
  'confidence',
  'needsReview',
  'notes',
];

const WIKI = {
  cargoApi: 'https://ark.wiki.gg/api.php?action=cargoquery&tables=Items&fields=_pageName,ID,Blueprint,Category,stackSize,weight&limit=500&format=json',
  itemIds: 'https://ark.wiki.gg/wiki/Item_IDs',
  cargoTable: 'https://ark.wiki.gg/wiki/Special:CargoTables/Items',
  astraeosItems: 'https://ark.wiki.gg/wiki/Astraeos#Items',
};

const ITEM_PREFIXES = [
  'PrimalItem',
  'Item',
  'Ammo_',
  'Weapon_',
  'Weap',
  'Egg',
  'Seed',
];

const STRONG_ITEM_DIRS = [
  '/Items/',
  '/Item/',
  '/Consumables/',
  '/Resources/',
  '/Armor/',
  '/Saddles/',
  '/Skins/',
  '/Weapons/',
  '/Ammo/',
  '/Structures/',
];

const EXCLUDED_DIRS = [
  '/Textures/',
  '/Texture/',
  '/Materials/',
  '/Material/',
  '/Meshes/',
  '/Mesh/',
  '/Animations/',
  '/Animation/',
  '/Buffs/',
  '/Buff/',
  '/Characters/',
  '/Character/',
  '/Creatures/',
  '/Creature/',
  '/Dinos/',
  '/Sounds/',
  '/Sound/',
  '/Particles/',
  '/VFX/',
  '/FX/',
  '/Icons/',
  '/Icon/',
  '/UI/',
];

const EXCLUDED_NAME_PREFIXES = [
  'T_',
  'MI_',
  'M_',
  'MM_',
  'SM_',
  'SK_',
  'SKM_',
  'S_',
  'Anim_',
  'Buff_',
  'Icon_',
  'UI_',
  'DA_',
  'DT_',
  'WBP_',
  'BP_',
  'BTT_',
  'BTTask_',
  'BTService_',
];

const CATEGORY_RULES = [
  ['Saddle', /\bSaddle\b|Saddles|PrimalItemArmor_.*Saddle/i],
  ['Ammo', /\bAmmo\b|Arrow|Bullet|Dart|Shell|Bolt|CannonBall|Rocket|Grenade/i],
  ['Weapon', /\bWeapon\b|Weap|Rifle|Shotgun|Pistol|Sword|Spear|Bow|Crossbow|Whip|Bola|C4/i],
  ['Armor', /\bArmor\b|Boots|Gloves|Helmet|Pants|Shirt|Shield|DivingSuit|Riot|Ghillie|Chitin|Flak|Fur/i],
  ['Skin', /\bSkin\b|Skins|Costume|Cosmetic/i],
  ['Consumable', /Consumable|Food|Meal|Soup|Stew|Drink|Potion|Kibble|Berry|Meat|Egg|Canteen|Water|Narcotic|Medical|BloodPack/i],
  ['Resource', /Resource|Resources|Ingot|Metal|Wood|Stone|Thatch|Fiber|Fibers|Hide|Pelt|Chitin|Keratin|Crystal|Obsidian|Oil|Paste|Cement|Polymer|Element|Ore|Seed/i],
  ['Artifact', /Artifact/i],
  ['Trophy', /Trophy|Tribute|Relic|Boss/i],
  ['Structure', /Structure|Structures|Wall|Floor|Ceiling|Door|Gate|Foundation|Pillar|Roof|Stairs|Ramp|Fence|Window|Trapdoor|Ladder|Bed|Bench|Table|Chair|Box|Storage|Crate|Forge|Smithy|Station|Depot|Turret|Generator|Teleporter|Flag|Sign/i],
  ['Tool', /Tool|Spyglass|Pick|Hatchet|Torch|Lantern|Fishing|GPS|Compass|Scanner|Binocular/i],
  ['Cosmetic', /Hair|Emote|Chibi|Dye|Paint|Decor/i],
  ['Utility', /Cryo|Dino[Bb]all|Pod|Soul|Glider|Parachute|Backpack|Quiver|Map|Radio|Remote/i],
];

function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

function loadJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

function uniq(values) {
  return [...new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== ''))];
}

function normalizeSlash(s) {
  return String(s || '').replace(/\\/g, '/');
}

function normalizeClassName(value) {
  const s = String(value || '').trim().replace(/^"+|"+$/g, '');
  if (!s) return '';
  if (s.endsWith('_C')) return s;
  return `${s}_C`;
}

function classNameFromBlueprint(blueprintPath) {
  const bp = normalizeBlueprintPath(blueprintPath);
  if (!bp) return '';
  const match = bp.match(/\.([A-Za-z0-9_]+)'?$/);
  return match ? normalizeClassName(match[1]) : '';
}

function normalizeBlueprintPath(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/^"+|"+$/g, '');
  s = s.replace(/^BlueprintGeneratedClass'/, "Blueprint'");
  s = s.replace(/^Class'/, "Blueprint'");
  return s;
}

function wikiPageUrl(pageName) {
  if (!pageName) return '';
  return `https://ark.wiki.gg/wiki/${encodeURIComponent(String(pageName).replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

function addDelimited(existing, values) {
  return uniq([
    ...String(existing || '').split(';').map((s) => s.trim()),
    ...values.flatMap((v) => String(v || '').split(';')).map((s) => s.trim()),
  ]).join('; ');
}

function highestConfidence(a, b) {
  const order = { low: 0, medium: 1, high: 2 };
  return (order[b] || 0) > (order[a] || 0) ? b : a;
}

function sanitizeKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^blueprint'/, '')
    .replace(/'$/g, '')
    .replace(/[^a-z0-9_./:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function displayNameFromClass(className) {
  let s = String(className || '').replace(/_C$/, '');
  s = s
    .replace(/^PrimalItemConsumableBuff_/, '')
    .replace(/^PrimalItemConsumable_/, '')
    .replace(/^PrimalItemResource_/, '')
    .replace(/^PrimalItemArmor_/, '')
    .replace(/^PrimalItemAmmo_/, '')
    .replace(/^PrimalItemStructure_/, '')
    .replace(/^PrimalItemWeapon_/, '')
    .replace(/^PrimalItemSkin_/, '')
    .replace(/^PrimalItem_/, '')
    .replace(/^PrimalItem/, '')
    .replace(/^ItemStructure/, '')
    .replace(/^Item/, '')
    .replace(/^Weapon_/, '')
    .replace(/^Weap/, '')
    .replace(/^Ammo_/, '')
    .replace(/_Child$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return s || String(className || '').replace(/_C$/, '');
}

function gfiCodeFromClass(className) {
  return displayNameFromClass(className).replace(/[^A-Za-z0-9]/g, '');
}

function normalizeCategory(raw, className = '', assetPath = '') {
  const s = String(raw || '').trim();
  const exact = {
    Resources: 'Resource',
    Resource: 'Resource',
    Structures: 'Structure',
    Structure: 'Structure',
    Saddles: 'Saddle',
    Saddle: 'Saddle',
    Weapons: 'Weapon',
    Weapon: 'Weapon',
    Armor: 'Armor',
    Skins: 'Skin',
    Skin: 'Skin',
    Consumables: 'Consumable',
    Consumable: 'Consumable',
    Ammunition: 'Ammo',
    Ammo: 'Ammo',
    Tools: 'Tool',
    Tool: 'Tool',
    Artifacts: 'Artifact',
    Artifact: 'Artifact',
    Trophies: 'Trophy',
    Trophy: 'Trophy',
    Cosmetics: 'Cosmetic',
    Cosmetic: 'Cosmetic',
  };
  if (exact[s]) return exact[s];

  const haystack = `${s} ${className} ${assetPath}`;
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(haystack)) return category;
  }
  return 'Unknown';
}

function makeSpawnCommand(blueprintPath) {
  const bp = normalizeBlueprintPath(blueprintPath);
  return bp ? `cheat GiveItem "${bp}" 1 0 0` : '';
}

function parseActiveMods(text) {
  const matches = [...text.matchAll(/^ActiveMods\s*=\s*(.*)$/gim)];
  const raw = matches.at(-1)?.[1] || '';
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const unique = [];
  const seen = new Set();
  const duplicates = [];
  const duplicateSet = new Set();

  for (const modId of entries) {
    if (seen.has(modId)) {
      duplicates.push(modId);
      duplicateSet.add(modId);
    } else {
      seen.add(modId);
      unique.push(modId);
    }
  }

  return {
    raw,
    entries,
    unique,
    duplicates,
    duplicateIds: [...duplicateSet],
  };
}

function loadSiteModNames() {
  if (!existsSync(PATHS.siteModYaml)) return new Map();
  const doc = parseYaml(readText(PATHS.siteModYaml));
  const mods = doc.mods || [];
  return new Map(mods.map((m) => [String(m.curseId), {
    displayName: m.displayName || m.sourceName || '',
    sourceName: m.sourceName || '',
    curseforgeUrl: m.curseforgeUrl || '',
  }]));
}

function modNameFromEvidence(modId, modJson, siteModNames) {
  return modJson?.name
    || siteModNames.get(String(modId))?.displayName
    || siteModNames.get(String(modId))?.sourceName
    || `Mod ${modId}`;
}

function validateModEvidence(activeMods, siteModNames) {
  const statuses = [];

  for (const modId of activeMods.unique) {
    const folder = join(PATHS.discoveryRoot, modId);
    const manifest = join(folder, 'Manifest_UFSFiles_Win64.txt');
    const modJsonPath = join(folder, 'Mod.json');
    const exists = existsSync(folder);
    const files = exists ? readdirSync(folder) : [];
    const packageFiles = files.filter((f) => /\.(pak|ucas|utoc)$/i.test(f));
    const modJson = existsSync(modJsonPath) ? loadJson(modJsonPath) : null;
    const manifestExists = existsSync(manifest);

    statuses.push({
      modId,
      folder,
      exists,
      manifest,
      manifestExists,
      packageFiles,
      modJsonPath,
      modJsonExists: existsSync(modJsonPath),
      modJson,
      modName: modNameFromEvidence(modId, modJson, siteModNames),
      version: modJson?.latestFiles?.[0]?.displayName || modJson?.dateReleased || '',
      siteName: siteModNames.get(String(modId))?.displayName || '',
      curseforgeUrl: modJson?.links?.websiteUrl || siteModNames.get(String(modId))?.curseforgeUrl || '',
    });
  }

  return statuses;
}

function isProbablyItemAsset(assetPath, assetName) {
  const normalized = `/${normalizeSlash(assetPath)}`;
  if (!assetPath.toLowerCase().endsWith('.uasset')) return false;
  if (EXCLUDED_NAME_PREFIXES.some((prefix) => assetName.startsWith(prefix))) return false;
  if (/(_Icon|Icon_|_Preview|Preview_|_Texture|Texture_|_Mat|_MI|_M|_SM|_SK|_Anim|_Buff)$/i.test(assetName)) return false;

  const itemLikePrefix = ITEM_PREFIXES.some((prefix) => assetName.startsWith(prefix));
  const strongDir = STRONG_ITEM_DIRS.some((dir) => normalized.includes(dir));
  const excludedDir = EXCLUDED_DIRS.some((dir) => normalized.includes(dir));

  if (assetName.startsWith('BaseBP_')) {
    return strongDir && /\b(Item|Resource|Ammo|Weapon|Armor|Consumable|Structure|Storage|Box|Crate|Station|Tool)\b/i.test(assetName.replace(/_/g, ' '));
  }

  if (assetName.startsWith('Egg') || assetName.startsWith('Seed')) {
    return strongDir && !excludedDir;
  }

  if (excludedDir && !strongDir) return false;
  return itemLikePrefix || (strongDir && /(?:PrimalItem|^Item|Ammo|Weapon|Weap|Egg|Seed)/i.test(assetName));
}

function manifestBlueprintPath(assetPath) {
  const path = normalizeSlash(assetPath);
  const match = path.match(/^ShooterGame\/Mods\/([^/]+)\/Content\/(.+)\.uasset$/i);
  if (!match) return '';
  const [, modRoot, relative] = match;
  const assetName = relative.split('/').pop();
  return `Blueprint'/Game/Mods/${modRoot}/${relative}.${assetName}'`;
}

function confidenceForManifestAsset(assetPath, className) {
  const normalized = `/${normalizeSlash(assetPath)}`;
  const strongDir = STRONG_ITEM_DIRS.some((dir) => normalized.includes(dir));
  if (className.startsWith('PrimalItem') && strongDir) return 'high';
  if (/^(Item|Ammo_|Weapon_|Weap)/.test(className) && strongDir) return 'high';
  if (className.startsWith('BaseBP_')) return 'medium';
  if (/^(Egg|Seed)/.test(className)) return 'medium';
  return strongDir ? 'medium' : 'low';
}

function readManifestCandidates(statuses) {
  const candidates = [];

  for (const status of statuses) {
    if (!status.manifestExists) continue;
    const lines = readText(status.manifest).split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const assetPath = line.split('\t')[0].trim();
      if (!assetPath.toLowerCase().endsWith('.uasset')) continue;

      const fileName = assetPath.split(/[\\/]/).pop() || '';
      const assetName = fileName.replace(/\.uasset$/i, '');
      if (!isProbablyItemAsset(assetPath, assetName)) continue;

      const className = normalizeClassName(assetName);
      const blueprintPath = manifestBlueprintPath(assetPath);
      const category = normalizeCategory('', className, assetPath);
      const confidence = confidenceForManifestAsset(assetPath, className);
      candidates.push({
        itemKey: blueprintPath ? sanitizeKey(blueprintPath) : sanitizeKey(`${status.modId}:${className}`),
        displayName: displayNameFromClass(className),
        className,
        blueprintPath,
        gfiCode: gfiCodeFromClass(className),
        category,
        sourceType: 'mod',
        sourceModId: status.modId,
        sourceModName: status.modName,
        sourcePackagePath: status.folder,
        assetPath,
        spawnCommand: makeSpawnCommand(blueprintPath),
        stackSize: '',
        weight: '',
        itemId: '',
        engramClassName: '',
        craftingStation: '',
        serverReferenced: 'false',
        serverConfigReferences: '',
        sourceEvidence: 'package-manifest',
        enrichmentSources: status.curseforgeUrl || '',
        confidence,
        needsReview: confidence === 'low' ? 'true' : 'false',
        notes: confidence === 'low' ? 'Weak manifest filename/path inference.' : '',
      });
    }
  }

  return candidates;
}

function addConfigRef(map, className, context, lineNumber, sourceFile) {
  const key = normalizeClassName(className);
  if (!key || !/^(PrimalItem|Item|Ammo_|Weapon_|Weap|BaseBP_|Egg|Seed)/.test(key)) return;
  const entry = map.get(key) || {
    className: key,
    contexts: new Set(),
    lineNumbers: new Set(),
    sourceFiles: new Set(),
  };
  entry.contexts.add(context);
  entry.lineNumbers.add(lineNumber);
  entry.sourceFiles.add(sourceFile);
  map.set(key, entry);
}

function addEngramRef(map, className, context, lineNumber, sourceFile) {
  const key = normalizeClassName(className);
  if (!key || !/(?:Engram|EngramEntry)/i.test(key)) return;
  const entry = map.get(key) || {
    className: key,
    contexts: new Set(),
    lineNumbers: new Set(),
    sourceFiles: new Set(),
  };
  entry.contexts.add(context);
  entry.lineNumbers.add(lineNumber);
  entry.sourceFiles.add(sourceFile);
  map.set(key, entry);
}

function parseConfigReferences(gameIniText, gusText) {
  const itemRefs = new Map();
  const engramRefs = new Map();
  const blueprintRefs = [];

  const scan = (text, sourceFile) => {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const lineNumber = idx + 1;
      let context = 'generic item reference';
      if (/ConfigOverrideItemCraftingCosts/i.test(line)) context = 'crafting cost override';
      else if (/ResourceItemTypeString/i.test(line)) context = 'resource requirement';
      else if (/ConfigOverrideItemMaxQuantity|ItemMaxQuantity|Stack/i.test(line)) context = 'stack override';
      else if (/OverrideNamedEngramEntries/i.test(line)) context = 'engram override';

      for (const match of line.matchAll(/\b(ItemClassString|ResourceItemTypeString)\s*=\s*"([^"]+)"/gi)) {
        addConfigRef(itemRefs, match[2], match[1] === 'ItemClassString' ? 'crafting cost override target' : 'crafting cost resource requirement', lineNumber, sourceFile);
      }
      for (const match of line.matchAll(/\b(EngramClassName|EngramClassNameOverride)\s*=\s*"([^"]+)"/gi)) {
        addEngramRef(engramRefs, match[2], context, lineNumber, sourceFile);
      }
      for (const match of line.matchAll(/Blueprint'([^']+)'/gi)) {
        const bp = `Blueprint'${match[1]}'`;
        blueprintRefs.push({ blueprintPath: bp, className: classNameFromBlueprint(bp), context, lineNumber, sourceFile });
      }
      for (const match of line.matchAll(/\b((?:PrimalItem|Item|Ammo_|Weapon_|Weap|BaseBP_|Egg|Seed)[A-Za-z0-9_]*_C)\b/g)) {
        addConfigRef(itemRefs, match[1], context, lineNumber, sourceFile);
      }
    });
  };

  scan(gameIniText, 'Game.ini');
  scan(gusText, 'GameUserSettings.ini');

  for (const bp of blueprintRefs) {
    if (bp.className) addConfigRef(itemRefs, bp.className, bp.context, bp.lineNumber, bp.sourceFile);
  }

  return {
    itemRefs,
    engramRefs,
    blueprintRefs,
  };
}

function wikiRowFromCargoTitle(title, astraeosItemNames) {
  const displayName = String(title._pageName || '').trim();
  const blueprintPath = normalizeBlueprintPath(title.Blueprint || '');
  const className = classNameFromBlueprint(blueprintPath);
  const sourceType = astraeosItemNames.has(displayName) ? 'map' : 'base-game';
  const category = normalizeCategory(title.Category || '', className, blueprintPath);
  const hasAsaishBlueprint = /Blueprint'\/Game\/(?:PrimalEarth|ASA|Aberration|ScorchedEarth|Extinction|Genesis|LostIsland|TheIsland|Astraeos)\//i.test(blueprintPath);
  const confidence = className && hasAsaishBlueprint ? 'medium' : 'low';
  const sources = uniq([
    wikiPageUrl(displayName),
    WIKI.cargoTable,
    sourceType === 'map' ? WIKI.astraeosItems : '',
  ]).join('; ');

  return {
    itemKey: blueprintPath ? sanitizeKey(blueprintPath) : sanitizeKey(`wiki:${displayName}`),
    displayName,
    className,
    blueprintPath,
    gfiCode: gfiCodeFromClass(className),
    category,
    sourceType,
    sourceModId: '',
    sourceModName: '',
    sourcePackagePath: '',
    assetPath: '',
    spawnCommand: makeSpawnCommand(blueprintPath),
    stackSize: title.stackSize || '',
    weight: title.weight || '',
    itemId: title.ID || '',
    engramClassName: '',
    craftingStation: '',
    serverReferenced: 'false',
    serverConfigReferences: '',
    sourceEvidence: 'wiki',
    enrichmentSources: sources,
    confidence,
    needsReview: confidence === 'low' ? 'true' : 'false',
    notes: confidence === 'low' ? 'Wiki-only row with unclear ASA/server specificity.' : '',
  };
}

function wikiRowFromAstraeosItem(item) {
  const displayName = String(item.name || '').trim();
  const category = item.category || normalizeCategory('', displayName, displayName);
  const sources = uniq([
    wikiPageUrl(displayName),
    WIKI.astraeosItems,
  ]).join('; ');

  return {
    itemKey: sanitizeKey(`wiki-astraeos:${displayName}`),
    displayName,
    className: '',
    blueprintPath: '',
    gfiCode: '',
    category,
    sourceType: 'map',
    sourceModId: '',
    sourceModName: '',
    sourcePackagePath: '',
    assetPath: '',
    spawnCommand: '',
    stackSize: '',
    weight: '',
    itemId: '',
    engramClassName: '',
    craftingStation: '',
    serverReferenced: 'false',
    serverConfigReferences: '',
    sourceEvidence: 'wiki',
    enrichmentSources: sources,
    confidence: 'low',
    needsReview: 'true',
    notes: 'Astraeos page item link without Cargo item table blueprint/class data.',
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ArkManifestCollector/1.0 (local diagnostic workspace)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchCargoRows() {
  const rows = [];
  let offset = 0;
  const limit = 500;

  for (;;) {
    const url = `${WIKI.cargoApi}&offset=${offset}`;
    const json = await fetchJson(url);
    if (json.error) throw new Error(`${json.error.code || 'wiki error'}: ${json.error.info || ''}`);
    const chunk = json.cargoquery || [];
    rows.push(...chunk.map((r) => r.title || {}));
    if (chunk.length < limit) break;
    offset += limit;
  }

  return rows;
}

function extractWikiLinksFromHtml(html) {
  const names = new Set();
  for (const match of String(html || '').matchAll(/<a\b[^>]*href="\/wiki\/([^"#?]+)"[^>]*title="([^"]+)"/g)) {
    const title = match[2]
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
    if (!/^(File|Category|Special|Template):/i.test(title)) names.add(title);
  }
  return names;
}

function astraeosSectionCategory(sectionLine, itemName) {
  const section = String(sectionLine || '').trim();
  if (/Consumables/i.test(section)) return 'Consumable';
  if (/Trophies|Tributes/i.test(section)) return 'Trophy';
  if (/Saddles/i.test(section)) return 'Saddle';
  if (/Cosmetics/i.test(section)) return 'Skin';
  return normalizeCategory('', itemName, itemName);
}

async function fetchAstraeosItems() {
  const sectionJson = await fetchJson('https://ark.wiki.gg/api.php?action=parse&page=Astraeos&prop=sections&format=json');
  const sections = sectionJson.parse?.sections || [];
  const itemSection = sections.find((s) => s.line === 'Items' && s.level === '2');
  if (!itemSection) return [];

  const itemNumber = String(itemSection.number || '');
  const childSections = sections.filter((s) => String(s.number || '').startsWith(`${itemNumber}.`));
  const itemSections = childSections.length ? childSections : [itemSection];
  const itemsByName = new Map();

  for (const section of itemSections) {
    const json = await fetchJson(`https://ark.wiki.gg/api.php?action=parse&page=Astraeos&section=${encodeURIComponent(section.index)}&prop=text&format=json`);
    for (const name of extractWikiLinksFromHtml(json.parse?.text?.['*'] || '')) {
      if (!itemsByName.has(name)) {
        itemsByName.set(name, {
          name,
          section: section.line || 'Items',
          category: astraeosSectionCategory(section.line, name),
        });
      }
    }
  }

  return [...itemsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function loadWikiData() {
  let oldCache = null;
  if (existsSync(PATHS.wikiCache)) oldCache = loadJson(PATHS.wikiCache);

  try {
    const [cargoRows, astraeosItems] = await Promise.all([
      fetchCargoRows(),
      fetchAstraeosItems(),
    ]);
    const astraeosItemNames = new Set(astraeosItems.map((item) => item.name));
    const cargoNames = new Set(cargoRows.map((title) => String(title._pageName || '').trim()).filter(Boolean));
    const astraeosPageOnlyRows = astraeosItems
      .filter((item) => !cargoNames.has(item.name))
      .map((item) => wikiRowFromAstraeosItem(item));

    const cache = {
      fetchedAt: new Date().toISOString(),
      source: 'ark.wiki.gg cargo API',
      cargoApi: WIKI.cargoApi,
      itemIdsPage: WIKI.itemIds,
      astraeosItemsPage: WIKI.astraeosItems,
      cargoRows,
      astraeosItems,
      astraeosItemNames: [...astraeosItemNames].sort((a, b) => a.localeCompare(b)),
      error: null,
    };
    writeFileSync(PATHS.wikiCache, JSON.stringify(cache, null, 2), 'utf8');
    return {
      rows: [
        ...cargoRows.map((title) => wikiRowFromCargoTitle(title, astraeosItemNames)),
        ...astraeosPageOnlyRows,
      ],
      astraeosItemNames,
      astraeosPageOnlyRows: astraeosPageOnlyRows.length,
      status: `Fetched ${cargoRows.length} Cargo item rows and ${astraeosItemNames.size} Astraeos item links; emitted ${astraeosPageOnlyRows.length} page-only Astraeos rows.`,
      source: 'live',
      error: null,
    };
  } catch (err) {
    if (oldCache?.cargoRows) {
      const astraeosItems = oldCache.astraeosItems || (oldCache.astraeosItemNames || []).map((name) => ({
        name,
        section: 'Items',
        category: normalizeCategory('', name, name),
      }));
      const astraeosItemNames = new Set(astraeosItems.map((item) => item.name));
      const cargoNames = new Set(oldCache.cargoRows.map((title) => String(title._pageName || '').trim()).filter(Boolean));
      const astraeosPageOnlyRows = astraeosItems
        .filter((item) => !cargoNames.has(item.name))
        .map((item) => wikiRowFromAstraeosItem(item));
      return {
        rows: [
          ...oldCache.cargoRows.map((title) => wikiRowFromCargoTitle(title, astraeosItemNames)),
          ...astraeosPageOnlyRows,
        ],
        astraeosItemNames,
        astraeosPageOnlyRows: astraeosPageOnlyRows.length,
        status: `Live wiki fetch failed; used cache from ${oldCache.fetchedAt || 'unknown time'} and emitted ${astraeosPageOnlyRows.length} page-only Astraeos rows.`,
        source: 'cache',
        error: String(err.message || err),
      };
    }

    writeFileSync(PATHS.wikiCache, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source: 'ark.wiki.gg cargo API',
      cargoApi: WIKI.cargoApi,
      itemIdsPage: WIKI.itemIds,
      astraeosItemsPage: WIKI.astraeosItems,
      cargoRows: [],
      astraeosItemNames: [],
      error: String(err.message || err),
    }, null, 2), 'utf8');

    return {
      rows: [],
      astraeosItemNames: new Set(),
      astraeosPageOnlyRows: 0,
      status: 'Live wiki fetch failed and no cache was available.',
      source: 'failed',
      error: String(err.message || err),
    };
  }
}

function mergeRows(rows) {
  const byKey = new Map();
  const byClass = new Map();

  function register(row) {
    byKey.set(row.itemKey, row);
    if (row.className) byClass.set(row.className.toLowerCase(), row);
  }

  function mergeInto(existing, incoming) {
    for (const column of CSV_COLUMNS) {
      if (column === 'itemKey') continue;
      const cur = existing[column] ?? '';
      const next = incoming[column] ?? '';
      if (!cur && next) existing[column] = next;
    }

    if (incoming.sourceEvidence) {
      existing.sourceEvidence = addDelimited(existing.sourceEvidence, [incoming.sourceEvidence]);
    }
    if (incoming.enrichmentSources) {
      existing.enrichmentSources = addDelimited(existing.enrichmentSources, [incoming.enrichmentSources]);
    }
    if (incoming.serverConfigReferences) {
      existing.serverConfigReferences = addDelimited(existing.serverConfigReferences, [incoming.serverConfigReferences]);
    }
    if (incoming.notes) {
      existing.notes = addDelimited(existing.notes, [incoming.notes]);
    }
    if (incoming.confidence) {
      existing.confidence = highestConfidence(existing.confidence || 'low', incoming.confidence);
    }
    existing.needsReview = existing.confidence === 'low' || existing.needsReview === 'true' || incoming.needsReview === 'true' ? 'true' : 'false';

    if (incoming.sourceEvidence === 'wiki') {
      if (incoming.displayName && (!existing.displayName || existing.displayName === displayNameFromClass(existing.className))) {
        existing.displayName = incoming.displayName;
      }
      if (incoming.category && existing.category === 'Unknown') existing.category = incoming.category;
      if (incoming.stackSize) existing.stackSize = incoming.stackSize;
      if (incoming.weight) existing.weight = incoming.weight;
      if (incoming.itemId) existing.itemId = incoming.itemId;
    }
  }

  for (const row of rows) {
    const classKey = row.className ? row.className.toLowerCase() : '';
    const existing = byKey.get(row.itemKey) || (classKey ? byClass.get(classKey) : null);
    if (existing) {
      mergeInto(existing, row);
      if (row.itemKey && !byKey.has(row.itemKey)) byKey.set(row.itemKey, existing);
    } else {
      register({ ...row });
    }
  }

  return [...new Set(byKey.values())];
}

function applyConfigReferences(rows, configRefs) {
  const byClass = new Map(rows.filter((r) => r.className).map((r) => [r.className.toLowerCase(), r]));
  const unresolvedItemRefs = [];

  for (const ref of configRefs.itemRefs.values()) {
    const classKey = ref.className.toLowerCase();
    let row = byClass.get(classKey);
    const context = [...ref.contexts].sort().join('; ');
    const lines = [...ref.lineNumbers].sort((a, b) => a - b);
    const files = [...ref.sourceFiles].sort().join(', ');
    const configReference = `${context} (${files} lines ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ', ...' : ''})`;

    if (row) {
      row.serverReferenced = 'true';
      row.serverConfigReferences = addDelimited(row.serverConfigReferences, [configReference]);
      row.sourceEvidence = addDelimited(row.sourceEvidence, ['config']);
      if (!row.enrichmentSources) row.enrichmentSources = '';
    } else {
      row = {
        itemKey: sanitizeKey(`server-config:${ref.className}`),
        displayName: displayNameFromClass(ref.className),
        className: ref.className,
        blueprintPath: '',
        gfiCode: gfiCodeFromClass(ref.className),
        category: normalizeCategory('', ref.className, ''),
        sourceType: 'server-config',
        sourceModId: '',
        sourceModName: '',
        sourcePackagePath: '',
        assetPath: '',
        spawnCommand: '',
        stackSize: '',
        weight: '',
        itemId: '',
        engramClassName: '',
        craftingStation: '',
        serverReferenced: 'true',
        serverConfigReferences: configReference,
        sourceEvidence: 'config',
        enrichmentSources: '',
        confidence: 'low',
        needsReview: 'true',
        notes: 'Config-referenced item class was not resolved to active package manifest or wiki data.',
      };
      rows.push(row);
      byClass.set(classKey, row);
      unresolvedItemRefs.push(ref);
    }
  }

  return { rows, unresolvedItemRefs };
}

function applyEngramLinks(rows, configRefs) {
  const byLooseName = new Map();

  for (const row of rows) {
    const classBase = row.className.replace(/_C$/, '');
    const names = uniq([
      classBase,
      classBase.replace(/^PrimalItem[A-Za-z]*_?/, ''),
      classBase.replace(/^ItemStructure/, ''),
      classBase.replace(/^Item/, ''),
    ]).map((s) => s.toLowerCase());
    for (const name of names) byLooseName.set(name, row);
  }

  const unresolvedEngramRefs = [];
  for (const ref of configRefs.engramRefs.values()) {
    const base = ref.className
      .replace(/_C$/, '')
      .replace(/^EngramEntry_/, '')
      .replace(/^PrimalEngramEntry_/, '')
      .replace(/^PrimalEngram_/, '')
      .replace(/^Engram_/, '')
      .toLowerCase();
    const row = byLooseName.get(base);
    if (row) {
      row.engramClassName = addDelimited(row.engramClassName, [ref.className]);
      row.serverReferenced = 'true';
      row.serverConfigReferences = addDelimited(row.serverConfigReferences, [`engram override (${[...ref.sourceFiles].sort().join(', ')})`]);
      row.sourceEvidence = addDelimited(row.sourceEvidence, ['config']);
    } else {
      unresolvedEngramRefs.push(ref);
    }
  }
  return unresolvedEngramRefs;
}

function finalSort(rows) {
  return rows.sort((a, b) => {
    const fields = ['sourceType', 'sourceModName', 'category', 'displayName', 'className'];
    for (const field of fields) {
      const cmp = String(a[field] || '').localeCompare(String(b[field] || ''), undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(rows) {
  const out = [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col] ?? '')).join(',')),
  ].join('\r\n') + '\r\n';
  writeFileSync(PATHS.csv, out, 'utf8');
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field] || '', (counts.get(row[field] || '') || 0) + 1);
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function markdownCountList(entries) {
  if (!entries.length) return '- None';
  return entries.map(([key, count]) => `- ${key || '(blank)'}: ${count}`).join('\n');
}

function evidenceSummary(statuses) {
  const missingFolders = statuses.filter((s) => !s.exists).map((s) => s.modId);
  const missingManifests = statuses.filter((s) => !s.manifestExists).map((s) => s.modId);
  const missingPackages = statuses.filter((s) => s.packageFiles.length === 0).map((s) => s.modId);
  const missingModJson = statuses.filter((s) => !s.modJsonExists).map((s) => s.modId);
  return { missingFolders, missingManifests, missingPackages, missingModJson };
}

function formatModList(values) {
  return values.length ? values.join(', ') : 'None';
}

function formatUnresolvedRefs(refs) {
  if (!refs.length) return '- None';
  return refs.map((ref) => {
    const contexts = [...ref.contexts].sort().join('; ');
    const files = [...ref.sourceFiles].sort().join(', ');
    const lines = [...ref.lineNumbers].sort((a, b) => a - b);
    return `- ${ref.className}: ${contexts} (${files} lines ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ', ...' : ''})`;
  }).join('\n');
}

function formatExtractionStatusTable(statuses, manifestCandidates) {
  const candidatesByMod = new Map();
  for (const candidate of manifestCandidates) {
    candidatesByMod.set(candidate.sourceModId, (candidatesByMod.get(candidate.sourceModId) || 0) + 1);
  }

  const lines = [
    '| Mod ID | Mod name | Folder | Manifest | Package files | Mod.json | First-pass item candidates |',
    '| --- | --- | --- | --- | --- | --- | ---: |',
  ];

  for (const status of statuses) {
    lines.push(`| ${status.modId} | ${String(status.modName).replace(/\|/g, '\\|')} | ${status.exists ? 'ok' : 'missing'} | ${status.manifestExists ? 'ok' : 'missing'} | ${status.packageFiles.length || 'missing'} | ${status.modJsonExists ? 'ok' : 'missing'} | ${candidatesByMod.get(status.modId) || 0} |`);
  }

  return lines.join('\n');
}

function writeReport({ activeMods, statuses, rows, manifestCandidates, wikiData, unresolvedItemRefs, unresolvedEngramRefs, configRefs }) {
  const evidence = evidenceSummary(statuses);
  const runDate = new Date().toISOString();
  const report = `# ASA Legion Of Idiots Item Manifest Collection Report

Run date/time: ${runDate}

## Inputs

- Active mod source: \`${PATHS.gameUserSettings}\`
- Server config overlay: \`${PATHS.gameIni}\`
- Local package evidence root: \`${PATHS.discoveryRoot}\`
- Site mod reference: \`${PATHS.siteModYaml}\`
- Local reference links: \`${PATHS.referenceLinks}\`
- Wiki sources: ${WIKI.itemIds}; ${WIKI.cargoTable}; ${WIKI.astraeosItems}

## Modset Summary

- Active mod entries: ${activeMods.entries.length}
- Unique active mod IDs: ${activeMods.unique.length}
- Duplicate active mod IDs: ${formatModList(activeMods.duplicateIds)}
- Discovered package folders matched: ${statuses.filter((s) => s.exists).length}
- Missing package folders: ${formatModList(evidence.missingFolders)}
- Missing manifests: ${formatModList(evidence.missingManifests)}
- Missing package files: ${formatModList(evidence.missingPackages)}
- Missing Mod.json files: ${formatModList(evidence.missingModJson)}
- Site-only mod ID 930128 included: ${activeMods.unique.includes('930128') ? 'yes' : 'no'}

## Collection Summary

- Manifest-derived first-pass item candidates: ${manifestCandidates.length}
- Final item rows: ${rows.length}
- Rows requiring review: ${rows.filter((r) => r.needsReview === 'true').length}
- Server item config references parsed: ${configRefs.itemRefs.size}
- Server engram references parsed: ${configRefs.engramRefs.size}
- Unresolved config item references added as review rows: ${unresolvedItemRefs.length}
- Unresolved engram references reported only: ${unresolvedEngramRefs.length}

## Counts By Source Type

${markdownCountList(countBy(rows, 'sourceType'))}

## Counts By Confidence

${markdownCountList(countBy(rows, 'confidence'))}

## Wiki Enrichment

- Status: ${wikiData.status}
- Source used: ${wikiData.source}
- Error: ${wikiData.error || 'None'}
- Wiki-enriched or wiki-sourced rows: ${rows.filter((r) => String(r.sourceEvidence).includes('wiki')).length}
- Astraeos page item links found: ${wikiData.astraeosItemNames.size}
- Astraeos page-only rows emitted without Cargo item data: ${wikiData.astraeosPageOnlyRows || 0}
- Cache path: \`${PATHS.wikiCache}\`

## Missing Evidence

- Missing package folders: ${formatModList(evidence.missingFolders)}
- Missing manifests: ${formatModList(evidence.missingManifests)}
- Missing package files: ${formatModList(evidence.missingPackages)}
- Missing Mod.json files: ${formatModList(evidence.missingModJson)}

## Extraction Status By Active Mod

${formatExtractionStatusTable(statuses, manifestCandidates)}

## Unresolved Config Item References

These references were not resolved to package or wiki evidence, so they were added to the CSV as \`server-config\` rows with \`confidence=low\` and \`needsReview=true\`.

${formatUnresolvedRefs(unresolvedItemRefs)}

## Unresolved Engram References

Engram references are not item classes. They are reported here when no loose name match to an item row was found.

${formatUnresolvedRefs(unresolvedEngramRefs)}

## Outputs

- CSV: \`${PATHS.csv}\`
- Report: \`${PATHS.report}\`
`;

  writeFileSync(PATHS.report, report, 'utf8');
}

function validateRequiredInputs() {
  const missing = [
    PATHS.gameUserSettings,
    PATHS.gameIni,
    PATHS.discoveryRoot,
    PATHS.siteModYaml,
  ].filter((path) => !existsSync(path));
  if (missing.length) {
    throw new Error(`Missing required input(s): ${missing.join(', ')}`);
  }
  if (!statSync(PATHS.discoveryRoot).isDirectory()) {
    throw new Error(`Discovery root is not a directory: ${PATHS.discoveryRoot}`);
  }
}

async function main() {
  validateRequiredInputs();
  mkdirSync(PATHS.outputDir, { recursive: true });

  const gusText = readText(PATHS.gameUserSettings);
  const gameIniText = readText(PATHS.gameIni);
  const activeMods = parseActiveMods(gusText);
  const siteModNames = loadSiteModNames();
  const statuses = validateModEvidence(activeMods, siteModNames);
  const manifestCandidates = readManifestCandidates(statuses);
  const configRefs = parseConfigReferences(gameIniText, gusText);
  const wikiData = await loadWikiData();

  const merged = mergeRows([...manifestCandidates, ...wikiData.rows]);
  const { rows: configAppliedRows, unresolvedItemRefs } = applyConfigReferences(merged, configRefs);
  const unresolvedEngramRefs = applyEngramLinks(configAppliedRows, configRefs);
  const rows = finalSort(configAppliedRows);

  writeCsv(rows);
  writeReport({
    activeMods,
    statuses,
    rows,
    manifestCandidates,
    wikiData,
    unresolvedItemRefs,
    unresolvedEngramRefs,
    configRefs,
  });

  const evidence = evidenceSummary(statuses);
  console.log(`Active mod entries: ${activeMods.entries.length}`);
  console.log(`Unique active mod IDs: ${activeMods.unique.length}`);
  console.log(`Duplicate active mod IDs: ${formatModList(activeMods.duplicateIds)}`);
  console.log(`Package folders matched: ${statuses.filter((s) => s.exists).length}`);
  console.log(`Missing folders/manifests/packages: ${evidence.missingFolders.length}/${evidence.missingManifests.length}/${evidence.missingPackages.length}`);
  console.log(`Manifest candidates: ${manifestCandidates.length}`);
  console.log(`Final rows: ${rows.length}`);
  console.log(`Rows requiring review: ${rows.filter((r) => r.needsReview === 'true').length}`);
  console.log(`Wiki: ${wikiData.status}`);
  console.log(`Wrote ${PATHS.csv}`);
  console.log(`Wrote ${PATHS.report}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
