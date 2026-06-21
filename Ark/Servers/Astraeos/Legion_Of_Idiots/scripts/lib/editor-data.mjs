import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './mini-yaml.mjs';
import { readCsv } from './csv.mjs';
import { itemEngramClassCandidates } from './item-engram-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const siteRoot = join(__dirname, '..', '..');

export const PATHS = {
  modYaml: join(siteRoot, 'data', 'mod-reference.yaml'),
  itemYaml: join(siteRoot, 'data', 'item-reference.yaml'),
  creatureYaml: join(siteRoot, 'data', 'creature-reference.yaml'),
  fetchedMetadata: join(siteRoot, 'data', 'fetched-metadata.json'),
  itemWikiCache: join(siteRoot, 'data', 'item-wiki-cache.json'),
  itemManifest: join(siteRoot, 'assets', 'items', 'ASA_LegionOfIdiots_Item_Manifest.csv'),
  itemIconManifest: join(siteRoot, 'assets', 'items', 'ASA_LegionOfIdiots_Item_Manifest_With_Icons.csv'),
  thumbDir: join(siteRoot, 'assets', 'mod-thumbnails'),
};

export const ITEM_CATEGORY_DEFAULTS = [
  { id: 'ammo', label: 'Ammo', color: '#ff6b6b', textColor: '#ffb0b0', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'armor', label: 'Armor', color: '#8cf4ff', textColor: '#b9fbff', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'artifact', label: 'Artifact', color: '#d7a8ff', textColor: '#ead3ff', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'consumable', label: 'Consumable', color: '#a6ff3d', textColor: '#d0ff86', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'cosmetic', label: 'Cosmetic', color: '#ff5fb7', textColor: '#ff9bd3', icon: 'assets/category-icons/cosmetic.svg' },
  { id: 'egg', label: 'Egg', color: '#e9f7da', textColor: '#f5ffe8', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'kibble', label: 'Kibble', color: '#c37cff', textColor: '#e2c2ff', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'recipe', label: 'Recipe', color: '#f2d27a', textColor: '#fff0b2', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'resource', label: 'Resource', color: '#ffb347', textColor: '#ffd18a', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'saddle', label: 'Saddle', color: '#30f0c2', textColor: '#8cffdf', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'skin', label: 'Skin', color: '#d9f7ff', textColor: '#f2fdff', icon: 'assets/category-icons/cosmetic.svg' },
  { id: 'structure', label: 'Structure', color: '#c46f32', textColor: '#efad78', icon: 'assets/category-icons/building.svg' },
  { id: 'tool', label: 'Tool', color: '#2f67ff', textColor: '#93aaff', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'trophy', label: 'Trophy', color: '#ffe45c', textColor: '#fff1a3', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'utility', label: 'Utility', color: '#b86cff', textColor: '#d7a8ff', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'weapon', label: 'Weapon', color: '#e32636', textColor: '#ff7f8a', icon: 'assets/category-icons/equipment-items.svg' },
  { id: 'unknown', label: 'Unknown', color: '#b2c0ca', textColor: '#e1e7ec', icon: 'assets/category-icons/equipment-items.svg' },
];

export function relativeSitePath(path) {
  return relative(siteRoot, path).replace(/\\/g, '/');
}

export function boolish(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function splitDelimited(value) {
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasDelimitedValue(value, expected) {
  const needle = String(expected || '').toLowerCase();
  return splitDelimited(value).some((part) => part.toLowerCase() === needle);
}

export function filterKey(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

const BLOCKED_WIKI_TITLE_PATTERNS = [
  /^Mobile:/i,
  /^ARK Mobile:/i,
];

const BLOCKED_BLUEPRINT_ROOTS = [
  {
    pattern: /^\/Game\/Abyss\//i,
    platformScope: 'ase',
    reason: 'blocked-blueprint-root-abyss',
  },
];

function loadYamlFile(path) {
  if (!existsSync(path)) return {};
  return parseYaml(readFileSync(path, 'utf8')) || {};
}

function loadJsonFile(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function configuredPath(value) {
  const raw = String(value || '').trim();
  return raw ? resolve(raw) : '';
}

function collectionGameIniPath(itemDoc) {
  const collection = itemDoc.collection || {};
  if (collection.gameIniPath) return configuredPath(collection.gameIniPath);
  if (collection.serverConfigRoot) return join(configuredPath(collection.serverConfigRoot), 'Game.ini');
  return '';
}

function parseDisabledEngrams(gameIniText) {
  const disabled = new Map();
  const lines = String(gameIniText || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/OverrideNamedEngramEntries/i.test(line) || !/\bEngramHidden\s*=\s*True\b/i.test(line)) return;
    const match = line.match(/\bEngramClassName\s*=\s*"([^"]+)"/i);
    if (!match) return;
    disabled.set(match[1].toLowerCase(), {
      className: match[1],
      lineNumber: index + 1,
    });
  });
  return disabled;
}

function loadDisabledEngrams(itemDoc) {
  const path = collectionGameIniPath(itemDoc);
  if (!path || !existsSync(path)) return { path, disabled: new Map() };
  return { path, disabled: parseDisabledEngrams(readFileSync(path, 'utf8')) };
}

function fileMeta(path) {
  if (!existsSync(path)) return { path: relativeSitePath(path), exists: false };
  const stat = statSync(path);
  return {
    path: relativeSitePath(path),
    exists: true,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  };
}

function normalizeAssetPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function assetExists(assetPath) {
  if (!assetPath) return false;
  return existsSync(join(siteRoot, ...normalizeAssetPath(assetPath).split('/')));
}

function itemCacheEntries() {
  const cache = loadJsonFile(PATHS.itemWikiCache, {});
  return cache.items || cache.pages || {};
}

function cacheForItem(row, cacheItems) {
  return cacheItems[row.itemKey]
    || cacheItems[row.className]
    || cacheItems[String(row.className || '').toLowerCase()]
    || cacheItems[row.displayName]
    || {};
}

function isBlockedWikiTitle(title) {
  return BLOCKED_WIKI_TITLE_PATTERNS.some((pattern) => pattern.test(String(title || '').trim()));
}

function wikiTitleFromSource(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new URL(raw);
    if (!/(\.|^)ark\.wiki\.gg$/i.test(parsed.hostname)) return '';
    if (!parsed.pathname.startsWith('/wiki/')) return '';
    return decodeURIComponent(parsed.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
  } catch {
    return '';
  }
}

function hasBlockedWikiTitle(row) {
  if (isBlockedWikiTitle(row.displayName)) return true;
  return splitDelimited(row.enrichmentSources).some((source) => isBlockedWikiTitle(wikiTitleFromSource(source)));
}

function blueprintBody(value) {
  const match = String(value || '').match(/Blueprint'([^']+)'/i);
  return match ? match[1] : String(value || '');
}

function blockedBlueprintRoot(row) {
  const body = blueprintBody(row.blueprintPath);
  if (!body) return null;
  return BLOCKED_BLUEPRINT_ROOTS.find((entry) => entry.pattern.test(body)) || null;
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

function wikiTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/(\.|^)ark\.wiki\.gg$/i.test(parsed.hostname)) return '';
    if (!parsed.pathname.startsWith('/wiki/')) return '';
    const title = decodeURIComponent(parsed.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
    return isBlockedWikiTitle(title) ? '' : title;
  } catch {
    return '';
  }
}

function displayNotes(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ');
  return String(value || '').trim();
}

function sourceLabelFor(row, sourceLabels, override = {}) {
  if (override.sourceLabel) return override.sourceLabel;
  if (row.sourceType === 'mod') return row.sourceModName || (row.sourceModId ? `Mod ${row.sourceModId}` : 'Mod');
  return sourceLabels[row.sourceType] || row.sourceType || 'Unknown';
}

function spawnDisplayFor(row) {
  if (row.gfiCode) return { label: 'Spawn Code', code: `cheat gfi ${row.gfiCode} 1 0 0` };
  if (row.spawnCommand) return { label: 'Spawn Command', code: row.spawnCommand };
  return { label: 'Spawn Code', code: 'Unavailable' };
}

function loadIconAssociations() {
  if (!existsSync(PATHS.itemIconManifest)) return { byKey: new Map(), byClass: new Map() };
  const rows = readCsv(PATHS.itemIconManifest).rows;
  const byKey = new Map();
  const byClass = new Map();
  for (const row of rows) {
    if (row.itemKey) byKey.set(row.itemKey, row);
    if (row.className) byClass.set(row.className.toLowerCase(), row);
  }
  return { byKey, byClass };
}

function hardCategoryForClass(className = '', assetPath = '', displayName = '', rawCategory = '') {
  const haystack = `${className} ${assetPath} ${displayName}`;
  if (
    /^Skins?$/i.test(rawCategory)
    || /\b(Skin|Costume|Emote|Hair(?:style)?|Hair\s+Style|Head\s+Hair\s+Style)\b/i.test(displayName)
    || /(?:UnlockEmote|UnlockHair|Hairstyle|HairStyle)/i.test(className)
    || /^PrimalItemSkin_/i.test(className)
  ) {
    return { category: 'Cosmetic', reason: 'skin-cosmetic' };
  }
  if (/^Saddles?$/i.test(rawCategory) || /\bSaddle\b/i.test(displayName) || /\/Saddles?\//i.test(assetPath) || /PrimalItemArmor_.*Saddle/i.test(className)) {
    return { category: 'Saddle', reason: 'saddle-item' };
  }
  if (/\bRecipe\b/i.test(displayName) || /RecipeNote|_Recipe|Recipes?\//i.test(haystack)) return { category: 'Recipe', reason: 'recipe-item' };
  if (/\bKibble\b/i.test(displayName) || /Kibble/i.test(className)) return { category: 'Kibble', reason: 'kibble-item' };
  if (/\bEgg\b/i.test(displayName) || /(?:^|_)Egg_/i.test(className) || /_Egg_|Egg_/i.test(className)) return { category: 'Egg', reason: 'egg-item' };
  if (/^(PrimalItemStructure_|ItemStructure)/i.test(className)) return { category: 'Structure', reason: 'class-structure' };
  if (/^PrimalItemArmor_/i.test(className)) return { category: 'Armor', reason: 'class-armor' };
  if (/^PrimalItemAmmo_/i.test(className) || /\bAmmo\b/i.test(assetPath)) return { category: 'Ammo', reason: 'class-ammo' };
  if (/^(PrimalItemWeapon_|PrimalItem_Weapon|Weapon_|Weap)/i.test(className)) return { category: 'Weapon', reason: 'class-weapon' };
  if (/^PrimalItemResource_/i.test(className)) return { category: 'Resource', reason: 'class-resource' };
  if (/^PrimalItemConsumable_/i.test(className)) return { category: 'Consumable', reason: 'class-consumable' };
  if (/^PrimalItemArtifact/i.test(className)) return { category: 'Artifact', reason: 'class-artifact' };
  if (/^PrimalItemTrophy/i.test(className)) return { category: 'Trophy', reason: 'class-trophy' };
  if (/\/Structures?\//i.test(haystack)) return { category: 'Structure', reason: 'path-structure' };
  return null;
}

function normalizedItemCategory(row, override = {}) {
  if (override.category) return { category: override.category, reason: 'manual-override' };
  const hard = hardCategoryForClass(
    row.className || '',
    row.assetPath || row.blueprintPath || '',
    row.displayName || '',
    row.rawCategory || row.category || ''
  );
  if (hard) return hard;
  return { category: row.category || 'Unknown', reason: row.category ? 'source-category' : 'missing-category' };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanDescriptionText(value) {
  return decodeEntities(value)
    .replace(/<\/?(?:onlyinclude|includeonly|noinclude)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableDescription(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/<[^>]+>/.test(raw)) return false;
  if (/^\s*[a-z]{2}\s*:/i.test(raw)) return false;
  const cleaned = cleanDescriptionText(raw);
  if (!cleaned) return false;
  if (/^\s*[a-z]{2}\s*:/i.test(cleaned)) return false;
  if (/^\{\{.*\}\}$/.test(cleaned)) return false;
  return cleaned.length >= 8;
}

function usableDescription(value) {
  const cleaned = cleanDescriptionText(value);
  return isUsableDescription(cleaned) ? cleaned : '';
}

function platformScopeForItem(row) {
  if (hasBlockedWikiTitle(row)) return 'mobile';
  const blockedRoot = blockedBlueprintRoot(row);
  if (blockedRoot) return blockedRoot.platformScope;
  if (row.sourceType === 'base-game' || row.sourceType === 'map') return 'asa';
  if (row.sourceType === 'mod') return 'asa';
  return 'unknown';
}

function evidenceTierFor(row, override = {}) {
  if (override.publishStatus === 'publish') return 'manual';
  const hasPackage = hasDelimitedValue(row.sourceEvidence, 'package-manifest');
  const hasWiki = hasDelimitedValue(row.sourceEvidence, 'wiki');
  const hasConfig = hasDelimitedValue(row.sourceEvidence, 'config');
  if (hasPackage && hasConfig) return 'package+config';
  if (hasPackage) return 'package';
  if (hasWiki && hasConfig) return 'wiki+config';
  if (hasWiki) return 'wiki-only';
  if (hasConfig || row.sourceType === 'server-config') return 'config-only';
  return 'unknown';
}

function hasExecutableIdentity(row) {
  return Boolean(row.className || row.blueprintPath || row.spawnCommand);
}

function disabledEngramForRow(row, disabledEngrams) {
  for (const engram of itemEngramClassCandidates(row)) {
    const disabled = disabledEngrams.get(engram.toLowerCase());
    if (disabled) return disabled;
  }
  return null;
}

function itemPublication(row, cache, override, descriptionWasRejected, disabledEngrams) {
  const platformScope = platformScopeForItem(row);
  const evidenceTier = evidenceTierFor(row, override);
  const manualStatus = String(override.publishStatus || '').trim().toLowerCase();

  if (manualStatus === 'exclude' || manualStatus === 'review-only') {
    return {
      publishStatus: manualStatus,
      publishReason: override.publishReason || `manual-${manualStatus}`,
      evidenceTier,
      platformScope,
    };
  }

  const disabledEngram = disabledEngramForRow(row, disabledEngrams);
  if (disabledEngram) {
    return {
      publishStatus: 'exclude',
      publishReason: 'game-ini-engram-hidden',
      evidenceTier,
      platformScope,
      disabledEngram,
    };
  }

  const rowPublishStatus = String(row.publishStatus || '').trim().toLowerCase();
  const rowPublishReason = String(row.publishReason || '').trim().toLowerCase();
  if ((rowPublishStatus === 'exclude' || rowPublishStatus === 'review-only') && rowPublishReason !== 'game-ini-engram-hidden') {
    return {
      publishStatus: rowPublishStatus,
      publishReason: row.publishReason || 'manifest-publish-status',
      evidenceTier: row.evidenceTier || evidenceTier,
      platformScope: row.platformScope || platformScope,
    };
  }

  if (platformScope === 'mobile') {
    return { publishStatus: 'exclude', publishReason: 'mobile-platform-exclusive', evidenceTier, platformScope };
  }

  const blockedRoot = blockedBlueprintRoot(row);
  if (blockedRoot && !hasDelimitedValue(row.sourceEvidence, 'package-manifest')) {
    return { publishStatus: 'exclude', publishReason: blockedRoot.reason, evidenceTier, platformScope };
  }

  if (evidenceTier === 'config-only' || row.sourceType === 'server-config') {
    return { publishStatus: 'review-only', publishReason: 'config-only-unresolved', evidenceTier, platformScope };
  }

  if (evidenceTier === 'wiki-only' && !hasExecutableIdentity(row)) {
    return { publishStatus: 'exclude', publishReason: 'wiki-only-no-executable-id', evidenceTier, platformScope };
  }

  if (evidenceTier === 'wiki-only' && row.confidence === 'low' && !boolish(row.serverReferenced)) {
    return { publishStatus: 'review-only', publishReason: 'low-confidence-wiki-only', evidenceTier, platformScope };
  }

  if (evidenceTier === 'package' && row.confidence === 'low') {
    return { publishStatus: 'review-only', publishReason: 'low-confidence-package-inference', evidenceTier, platformScope };
  }

  if (descriptionWasRejected && evidenceTier === 'wiki-only' && !boolish(row.serverReferenced)) {
    return { publishStatus: 'review-only', publishReason: 'wiki-only-rejected-description', evidenceTier, platformScope };
  }

  if (row.publishStatus === 'publish') {
    return {
      publishStatus: 'publish',
      publishReason: row.publishReason || 'manifest-publish-status',
      evidenceTier: row.evidenceTier || evidenceTier,
      platformScope: row.platformScope || platformScope,
    };
  }

  return { publishStatus: 'publish', publishReason: 'accepted', evidenceTier, platformScope };
}

function categoryMap(categories) {
  const byLabel = new Map();
  for (const category of ITEM_CATEGORY_DEFAULTS) byLabel.set(category.label, category);
  for (const category of categories || []) byLabel.set(category.label, category);
  return byLabel;
}

function itemIconFor(row, icon, category, pageConfig) {
  const local = normalizeAssetPath(icon.iconLocalPath);
  const resolvedPath = icon.iconStatus === 'resolved' && local ? `assets/items/${local}` : '';
  if (resolvedPath && assetExists(resolvedPath)) {
    return { path: resolvedPath, fallback: false, status: icon.iconStatus };
  }

  return {
    path: category?.icon || pageConfig.defaultIcon || 'assets/category-icons/equipment-items.svg',
    fallback: true,
    status: icon.iconStatus || 'missing',
  };
}

function overrideKeyForItem(row, manualOverrides) {
  const candidates = [row.itemKey, row.className, row.displayName].filter(Boolean);
  const overrideKey = candidates.find((key) => Object.prototype.hasOwnProperty.call(manualOverrides, key)) || '';
  return {
    overrideKey,
    suggestedOverrideKey: row.className || row.itemKey || row.displayName || '',
  };
}

function valuesForItem(row, override, cache, pageConfig, sourceLabels, disabledEngrams) {
  const sourceLabel = sourceLabelFor(row, sourceLabels, override);
  const wikiUrl = override.wikiUrl || cache.wikiUrl || firstWikiUrl(row.enrichmentSources);
  const rawDescription = override.description || cache.description || '';
  const cleanDescription = usableDescription(rawDescription);
  const descriptionWasRejected = Boolean(rawDescription && !cleanDescription);
  const publication = itemPublication(row, cache, override, descriptionWasRejected, disabledEngrams);
  const categoryInfo = normalizedItemCategory(row, override);
  const description = cleanDescription || pageConfig.unavailableDescriptionLabel;
  const craftingStation = override.craftingStation || cache.craftingStation || row.craftingStation || pageConfig.unknownCraftingStationLabel;
  const notes = displayNotes(override.notes || cache.notes || row.notes) || 'No notes listed.';
  const displayName = override.displayName || row.displayName || row.className || row.itemKey;

  return {
    displayName,
    category: categoryInfo.category,
    categoryReason: categoryInfo.reason,
    sourceLabel,
    description,
    craftingStation,
    notes,
    wikiUrl,
    publishStatus: String(override.publishStatus || '').trim().toLowerCase() || publication.publishStatus,
    publishReason: override.publishReason || publication.publishReason,
    effectivePublishStatus: publication.publishStatus,
    effectivePublishReason: publication.publishReason,
    evidenceTier: publication.evidenceTier,
    platformScope: publication.platformScope,
    isPublic: publication.publishStatus === 'publish',
    disabledEngram: publication.disabledEngram?.className || '',
    disabledLine: publication.disabledEngram?.lineNumber || '',
  };
}

function normalizeItems(itemDoc) {
  const pageConfig = {
    title: 'Item Reference',
    intro: 'Quick lookup for server items, sources, crafting context, and spawn codes.',
    defaultIcon: 'assets/category-icons/equipment-items.svg',
    unknownCraftingStationLabel: 'Not listed',
    unavailableDescriptionLabel: 'Description unavailable',
    maxSourceFilterButtons: 18,
    ...(itemDoc.page || {}),
  };
  const sourceLabels = {
    'base-game': 'Ark',
    map: 'Ark',
    'server-config': 'Ark',
    ...(itemDoc.sourceLabels || {}),
  };
  const manualOverrides = itemDoc.manualOverrides || {};
  const categories = itemDoc.categories?.length ? itemDoc.categories : ITEM_CATEGORY_DEFAULTS;
  const catByLabel = categoryMap(categories);
  const fallbackCategory = catByLabel.get('Unknown') || ITEM_CATEGORY_DEFAULTS.at(-1);
  const cacheItems = itemCacheEntries();
  const icons = loadIconAssociations();
  const disabledEngramData = loadDisabledEngrams(itemDoc);

  if (!existsSync(PATHS.itemManifest)) {
    return {
      page: pageConfig,
      sourceLabels,
      categories,
      entries: [],
      stats: {
        manifestRows: 0,
        publicRows: 0,
        hiddenRows: 0,
        disabledByGameIniRows: 0,
        disabledEngrams: disabledEngramData.disabled.size,
        wikiUrls: 0,
        descriptions: 0,
        icons: 0,
        manualOverrides: Object.keys(manualOverrides).length,
      },
    };
  }

  const rows = readCsv(PATHS.itemManifest).rows;
  const entries = rows.map((row) => {
    const cache = cacheForItem(row, cacheItems);
    const { overrideKey, suggestedOverrideKey } = overrideKeyForItem(row, manualOverrides);
    const override = overrideKey ? manualOverrides[overrideKey] : {};
    const baseline = valuesForItem(row, {}, cache, pageConfig, sourceLabels, disabledEngramData.disabled);
    const current = valuesForItem(row, override, cache, pageConfig, sourceLabels, disabledEngramData.disabled);
    const category = catByLabel.get(current.category) || fallbackCategory;
    const icon = icons.byKey.get(row.itemKey)
      || icons.byClass.get(String(row.className || '').toLowerCase())
      || {};
    const itemIcon = itemIconFor(row, icon, category, pageConfig);
    const spawn = spawnDisplayFor(row);
    const id = suggestedOverrideKey || row.itemKey || row.displayName;
    const searchText = [
      current.displayName,
      baseline.displayName,
      current.sourceLabel,
      row.sourceType,
      row.sourceModName,
      row.sourceModId,
      current.category,
      current.craftingStation,
      current.publishStatus,
      current.publishReason,
      current.effectivePublishStatus,
      current.effectivePublishReason,
      current.evidenceTier,
      current.platformScope,
      row.gfiCode,
      spawn.code,
      row.className,
      row.itemKey,
      row.blueprintPath,
      current.description,
      current.notes,
      row.enrichmentSources,
      row.notes,
    ].filter(Boolean).join(' ').toLowerCase();

    return {
      id,
      itemKey: row.itemKey,
      className: row.className,
      blueprintPath: row.blueprintPath,
      sourceType: row.sourceType,
      sourceModName: row.sourceModName,
      sourceModId: row.sourceModId,
      gfiCode: row.gfiCode,
      spawnLabel: spawn.label,
      spawnCode: spawn.code,
      iconPath: itemIcon.path,
      iconFallback: itemIcon.fallback,
      iconStatus: itemIcon.status,
      categoryColor: category.color || fallbackCategory.color,
      wikiTitle: wikiTitleFromUrl(current.wikiUrl),
      hasOverride: Boolean(overrideKey),
      overrideKey,
      suggestedOverrideKey,
      baseline,
      ...current,
      publishStatusEditable: current.publishStatus,
      publicStatusLabel: current.isPublic ? 'Public' : (current.effectivePublishStatus === 'review-only' ? 'Review only' : 'Hidden'),
      searchText,
    };
  }).sort((a, b) => {
    const aSource = a.sourceLabel === 'Ark' ? `0 ${a.sourceLabel}` : `1 ${a.sourceLabel}`;
    const bSource = b.sourceLabel === 'Ark' ? `0 ${b.sourceLabel}` : `1 ${b.sourceLabel}`;
    return aSource.localeCompare(bSource, undefined, { sensitivity: 'base' })
      || a.category.localeCompare(b.category, undefined, { sensitivity: 'base' })
      || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });

  return {
    page: pageConfig,
    sourceLabels,
    categories,
    entries,
    stats: {
      manifestRows: rows.length,
      publicRows: entries.filter((item) => item.isPublic).length,
      hiddenRows: entries.filter((item) => !item.isPublic).length,
      disabledByGameIniRows: entries.filter((item) => item.effectivePublishReason === 'game-ini-engram-hidden').length,
      disabledEngrams: disabledEngramData.disabled.size,
      wikiUrls: entries.filter((item) => item.wikiUrl).length,
      descriptions: entries.filter((item) => item.description !== pageConfig.unavailableDescriptionLabel).length,
      icons: entries.filter((item) => !item.iconFallback).length,
      manualOverrides: Object.keys(manualOverrides).length,
    },
  };
}

function thumbOnDisk(curseId) {
  if (!existsSync(PATHS.thumbDir)) return null;
  const match = readdirSync(PATHS.thumbDir).find((file) => file.startsWith(`${curseId}.`));
  return match ? `assets/mod-thumbnails/${match}` : null;
}

function modEntries(modDoc) {
  const cache = loadJsonFile(PATHS.fetchedMetadata, {}).mods || {};
  const site = modDoc.site || {};
  return (modDoc.mods || []).map((mod) => {
    const id = String(mod.curseId || '');
    const thumbnail = thumbOnDisk(mod.curseId) || mod.thumbnail || cache[mod.curseId]?.thumbnail || '';
    const link = mod.curseforgeUrl || cache[mod.curseId]?.websiteUrl || '';
    const searchText = [
      mod.displayName,
      mod.sourceName,
      mod.primaryCategory,
      ...(mod.additionalCategories || []),
      ...(mod.tags || []),
      mod.description,
      ...(mod.tips || []),
    ].filter(Boolean).join(' ').toLowerCase();
    return {
      id,
      ...mod,
      thumbnail,
      curseforgeUrl: link,
      showAdditionalCategoryPills: site.showAdditionalCategoryPills !== false,
      searchText,
    };
  });
}

function creatureEntries(creatureDoc) {
  return (creatureDoc.creatures || []).map((creature) => ({
    id: creature.id || '',
    ...creature,
    searchText: [
      creature.id,
      creature.displayName,
      creature.sourceMod,
      creature.category,
      creature.description,
      creature.tamingMethod,
      creature.spawnContext,
      creature.utility,
      creature.saddleOrUnlock,
      ...(creature.tips || []),
      ...(creature.tags || []),
    ].filter(Boolean).join(' ').toLowerCase(),
  }));
}

export function loadEditorState() {
  const modDoc = loadYamlFile(PATHS.modYaml);
  const itemDoc = loadYamlFile(PATHS.itemYaml);
  const creatureDoc = loadYamlFile(PATHS.creatureYaml);
  const items = normalizeItems(itemDoc);
  const modCategories = modDoc.categories || [];
  const creatureCategories = creatureDoc.categories || [];
  const site = modDoc.site || {};

  return {
    generatedAt: new Date().toISOString(),
    files: {
      modYaml: fileMeta(PATHS.modYaml),
      itemYaml: fileMeta(PATHS.itemYaml),
      creatureYaml: fileMeta(PATHS.creatureYaml),
      itemManifest: fileMeta(PATHS.itemManifest),
      itemIconManifest: fileMeta(PATHS.itemIconManifest),
    },
    site: {
      entry: {
        id: 'site',
        displayName: 'Site Settings',
        searchText: Object.values(site).flat().filter(Boolean).join(' ').toLowerCase(),
        ...site,
      },
      categories: modCategories,
    },
    mods: {
      categories: modCategories,
      entries: modEntries(modDoc),
      stats: {
        entries: (modDoc.mods || []).length,
        categories: modCategories.length,
      },
    },
    items,
    creatures: {
      categories: creatureCategories,
      entries: creatureEntries(creatureDoc),
      stats: {
        entries: (creatureDoc.creatures || []).length,
        categories: creatureCategories.length,
      },
    },
    options: {
      modCategories: modCategories.map((category) => category.label),
      itemCategories: items.categories.map((category) => category.label),
      itemPublishStatuses: ['', 'publish', 'review-only', 'exclude'],
      creatureCategories: creatureCategories.map((category) => category.label),
    },
  };
}

export function findItemEntry(state, id) {
  return state.items.entries.find((item) =>
    item.id === id || item.className === id || item.itemKey === id || item.overrideKey === id);
}

export function findModEntry(state, id) {
  return state.mods.entries.find((mod) => String(mod.curseId) === String(id));
}

export function findCreatureEntry(state, id) {
  return state.creatures.entries.find((creature) => creature.id === id);
}
