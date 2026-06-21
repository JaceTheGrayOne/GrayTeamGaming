// Build the static Lost Colony mini-wiki from the data/*-reference.yaml files.
//
// Fully static output: rows are server-rendered, and small vanilla-JS blocks
// handle client-side interactions such as mod search and category filtering.
// No runtime network calls, no framework.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseYaml } from './lib/mini-yaml.mjs';
import { readCsv } from './lib/csv.mjs';
import { itemEngramClassCandidates } from './lib/item-engram-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const MOD_YAML_PATH = join(root, 'data', 'mod-reference.yaml');
const ITEM_YAML_PATH = join(root, 'data', 'item-reference.yaml');
const CREATURE_YAML_PATH = join(root, 'data', 'creature-reference.yaml');
const CACHE_PATH = join(root, 'data', 'fetched-metadata.json');
const ITEM_WIKI_CACHE_PATH = join(root, 'data', 'item-wiki-cache.json');
const ITEM_MANIFEST_PATH = join(root, 'assets', 'items', 'ASA_LegionOfIdiots_Item_Manifest.csv');
const ITEM_ICON_MANIFEST_PATH = join(root, 'assets', 'items', 'ASA_LegionOfIdiots_Item_Manifest_With_Icons.csv');
const ITEM_PUBLICATION_REPORT_PATH = join(root, '_local', 'docs', 'Data_Collection', 'Item_Publication_Filter_Report.md');
const ITEM_CATEGORY_REPORT_PATH = join(root, '_local', 'docs', 'Data_Collection', 'Item_Category_Normalization_Report.md');
const ITEM_DESCRIPTION_REPORT_PATH = join(root, '_local', 'docs', 'Data_Collection', 'Item_Description_Sanitization_Report.md');
const THUMB_DIR = join(root, 'assets', 'mod-thumbnails');

const OUTPUTS = {
  home: join(root, 'index.html'),
  mods: join(root, 'mods.html'),
  items: join(root, 'items.html'),
  creatures: join(root, 'creatures.html'),
};

const NAV_ITEMS = [
  { id: 'home', label: 'Home', href: 'index.html' },
  { id: 'mods', label: 'Mods', href: 'mods.html' },
  { id: 'items', label: 'Items', href: 'items.html' },
  { id: 'creatures', label: 'Creatures', href: 'creatures.html' },
];

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ITEM_CATEGORY_DEFAULTS = [
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

function loadYamlFile(path) {
  if (!existsSync(path)) return {};
  return parseYaml(readFileSync(path, 'utf8')) || {};
}

function loadJsonFile(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
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

function loadCache() {
  if (existsSync(CACHE_PATH)) {
    try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')).mods || {}; } catch { /* ignore */ }
  }
  return {};
}

// Existing thumbnail file for a curseId, regardless of extension.
function thumbOnDisk(curseId) {
  if (!existsSync(THUMB_DIR)) return null;
  const match = readdirSync(THUMB_DIR).find((f) => f.startsWith(`${curseId}.`));
  return match ? `assets/mod-thumbnails/${match}` : null;
}

function boolish(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
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

function wikiUrlForTitle(title) {
  return `https://ark.wiki.gg/wiki/${encodeURIComponent(String(title || '').trim().replace(/\s+/g, '_'))}`;
}

function nonLinkCraftingStation(value) {
  return /^(?:not listed|unknown|unavailable|none)$/i.test(String(value || '').trim());
}

function craftingStationLinksHtml(value) {
  const stations = splitDelimited(value);
  if (!stations.length) return esc(value);
  return stations.map((station, index) => {
    const separator = index ? '<span class="crafting-separator">; </span>' : '';
    if (nonLinkCraftingStation(station)) return `${separator}${esc(station)}`;
    return `${separator}<a class="crafting-link" href="${esc(wikiUrlForTitle(station))}" target="_blank" rel="noopener noreferrer">${esc(station)}</a>`;
  }).join('');
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

function isBlockedWikiTitle(title) {
  return BLOCKED_WIKI_TITLE_PATTERNS.some((pattern) => pattern.test(String(title || '').trim()));
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

function normalizedItemCategory(row, override) {
  if (override.category) return { category: override.category, reason: 'manual-override' };
  const hard = hardCategoryForClass(
    row.className || '',
    row.assetPath || row.blueprintPath || '',
    row.displayName || '',
    row.category || ''
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

function evidenceTierFor(row, override) {
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

function filterKey(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
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

function normalizeAssetPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function assetExists(assetPath) {
  if (!assetPath) return false;
  return existsSync(join(root, ...normalizeAssetPath(assetPath).split('/')));
}

function categoryMap(categories) {
  const byLabel = new Map();
  for (const category of ITEM_CATEGORY_DEFAULTS) byLabel.set(category.label, category);
  for (const category of categories || []) byLabel.set(category.label, category);
  return byLabel;
}

function loadIconAssociations() {
  if (!existsSync(ITEM_ICON_MANIFEST_PATH)) return { byKey: new Map(), byClass: new Map() };
  const rows = readCsv(ITEM_ICON_MANIFEST_PATH).rows;
  const byKey = new Map();
  const byClass = new Map();
  for (const row of rows) {
    if (row.itemKey) byKey.set(row.itemKey, row);
    if (row.className) byClass.set(row.className.toLowerCase(), row);
  }
  return { byKey, byClass };
}

function itemCacheEntries() {
  const cache = loadJsonFile(ITEM_WIKI_CACHE_PATH, {});
  return cache.items || cache.pages || {};
}

function cacheForItem(row, cacheItems) {
  return cacheItems[row.itemKey]
    || cacheItems[row.className]
    || cacheItems[String(row.className || '').toLowerCase()]
    || cacheItems[row.displayName]
    || {};
}

function overrideForItem(row, manualOverrides) {
  return manualOverrides?.[row.itemKey]
    || manualOverrides?.[row.className]
    || manualOverrides?.[row.displayName]
    || {};
}

function sourceLabelFor(row, sourceLabels, override) {
  if (override.sourceLabel) return override.sourceLabel;
  if (row.sourceType === 'mod') return row.sourceModName || (row.sourceModId ? `Mod ${row.sourceModId}` : 'Mod');
  return sourceLabels[row.sourceType] || row.sourceType || 'Unknown';
}

function itemIconFor(row, icon, category, pageConfig) {
  const local = normalizeAssetPath(icon.iconLocalPath);
  const resolvedPath = icon.iconStatus === 'resolved' && local ? `assets/items/${local}` : '';
  if (resolvedPath && assetExists(resolvedPath)) {
    return {
      path: resolvedPath,
      fallback: false,
      status: icon.iconStatus,
    };
  }

  return {
    path: category?.icon || pageConfig.defaultIcon || 'assets/category-icons/equipment-items.svg',
    fallback: true,
    status: icon.iconStatus || 'missing',
  };
}

function spawnDisplayFor(row) {
  if (row.gfiCode) {
    return {
      label: 'Spawn Code',
      code: `cheat gfi ${row.gfiCode} 1 0 0`,
    };
  }
  if (row.spawnCommand) {
    return {
      label: 'Spawn Command',
      code: row.spawnCommand,
    };
  }
  return {
    label: 'Spawn Code',
    code: 'Unavailable',
  };
}

function displayNotes(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ');
  return String(value || '').trim();
}

function markdownCountList(entries) {
  if (!entries.length) return '- None';
  return entries.map(([key, count]) => `- ${key || '(blank)'}: ${count}`).join('\n');
}

function countBy(values, selector) {
  const counts = new Map();
  for (const value of values) {
    const key = selector(value) || '(blank)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function reportRows(rows, formatter, limit = 50) {
  if (!rows.length) return '- None';
  const shown = rows.slice(0, limit).map(formatter);
  if (rows.length > limit) shown.push(`- ... ${rows.length - limit} more`);
  return shown.join('\n');
}

function writeItemPublicationReport({ manifestRows, publicItems, hiddenItems, rejectedDescriptions, categoryAdjustments, disabledEngramData }) {
  mkdirSync(dirname(ITEM_PUBLICATION_REPORT_PATH), { recursive: true });
  const now = new Date().toISOString();
  const disabledHidden = hiddenItems.filter((row) => row.publishReason === 'game-ini-engram-hidden');
  const report = `# Item Publication Filter Report

Run date/time: ${now}

## Summary

- Manifest rows read: ${manifestRows.length}
- Public rows rendered: ${publicItems.length}
- Rows hidden from public page: ${hiddenItems.length}
- Game.ini disabled engrams loaded: ${disabledEngramData?.disabled?.size || 0}
- Rows hidden by Game.ini disabled engram: ${disabledHidden.length}
- Rejected descriptions: ${rejectedDescriptions.length}
- Category adjustments: ${categoryAdjustments.length}

## Game.ini Disabled Engram Source

- Path: \`${disabledEngramData?.path || 'Not configured'}\`

## Hidden Rows By Status

${markdownCountList(countBy(hiddenItems, (row) => row.publishStatus))}

## Hidden Rows By Reason

${markdownCountList(countBy(hiddenItems, (row) => row.publishReason))}

## Hidden Rows By Evidence Tier

${markdownCountList(countBy(hiddenItems, (row) => row.evidenceTier))}

## Hidden Row Samples

${reportRows(hiddenItems, (row) => `- ${row.displayName || row.className || row.itemKey}: ${row.publishStatus} / ${row.publishReason} / ${row.evidenceTier}${row.disabledEngram ? ` / ${row.disabledEngram} line ${row.disabledLine}` : ''}`)}

## Game.ini Disabled Row Samples

${reportRows(disabledHidden, (row) => `- ${row.displayName || row.className || row.itemKey}: ${row.disabledEngram} line ${row.disabledLine}`)}

## Rejected Description Samples

${reportRows(rejectedDescriptions, (row) => `- ${row.displayName || row.className || row.itemKey}: ${row.reason}`)}

## Category Adjustment Samples

${reportRows(categoryAdjustments, (row) => `- ${row.displayName || row.className || row.itemKey}: ${row.from || '(blank)'} -> ${row.to} (${row.reason})`)}
`;
  writeFileSync(ITEM_PUBLICATION_REPORT_PATH, report, 'utf8');

  const descriptionReport = `# Item Description Sanitization Report

Run date/time: ${now}

## Summary

- Manifest rows read: ${manifestRows.length}
- Rejected descriptions: ${rejectedDescriptions.length}

## Rejected Description Samples

${reportRows(rejectedDescriptions, (row) => `- ${row.displayName || row.className || row.itemKey}: ${row.reason}`, 200)}
`;
  writeFileSync(ITEM_DESCRIPTION_REPORT_PATH, descriptionReport, 'utf8');

  const categoryReport = `# Item Category Normalization Report

Run date/time: ${now}

## Summary

- Manifest rows read: ${manifestRows.length}
- Category adjustments: ${categoryAdjustments.length}

## Adjustments By Reason

${markdownCountList(countBy(categoryAdjustments, (row) => row.reason))}

## Category Adjustment Samples

${reportRows(categoryAdjustments, (row) => `- ${row.displayName || row.className || row.itemKey}: ${row.from || '(blank)'} -> ${row.to} (${row.reason})`, 200)}
`;
  writeFileSync(ITEM_CATEGORY_REPORT_PATH, categoryReport, 'utf8');
}

function normalizeItemRows(itemDoc) {
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
  const cacheItems = itemCacheEntries();
  const iconAssociations = loadIconAssociations();
  const disabledEngramData = loadDisabledEngrams(itemDoc);
  const itemCategories = itemDoc.categories?.length ? itemDoc.categories : ITEM_CATEGORY_DEFAULTS;
  const catByLabel = categoryMap(itemCategories);
  const fallbackCategory = catByLabel.get('Unknown') || ITEM_CATEGORY_DEFAULTS.at(-1);

  if (!existsSync(ITEM_MANIFEST_PATH)) {
    return {
      pageConfig,
      categories: itemCategories,
      catByLabel,
      items: [],
      stats: {
        manifestRows: 0,
        publicRows: 0,
        hiddenRows: 0,
        excludedRows: 0,
        reviewOnlyRows: 0,
        disabledByGameIniRows: 0,
        disabledEngrams: disabledEngramData.disabled.size,
        rejectedDescriptions: 0,
        categoryAdjustments: 0,
        wikiUrls: 0,
        descriptions: 0,
        icons: 0,
      },
    };
  }

  const manifestRows = readCsv(ITEM_MANIFEST_PATH).rows;
  const hiddenItems = [];
  const rejectedDescriptions = [];
  const categoryAdjustments = [];
  const items = [];

  for (const row of manifestRows) {
    const icon = iconAssociations.byKey.get(row.itemKey)
      || iconAssociations.byClass.get(String(row.className || '').toLowerCase())
      || {};
    const cache = cacheForItem(row, cacheItems);
    const override = overrideForItem(row, manualOverrides);
    const categoryInfo = normalizedItemCategory(row, override);
    const categoryLabel = categoryInfo.category;
    if ((row.category || 'Unknown') !== categoryLabel) {
      categoryAdjustments.push({
        itemKey: row.itemKey,
        displayName: override.displayName || row.displayName || row.className || row.itemKey,
        from: row.category || 'Unknown',
        to: categoryLabel,
        reason: categoryInfo.reason,
      });
    }
    const category = catByLabel.get(categoryLabel) || fallbackCategory;
    const sourceLabel = sourceLabelFor(row, sourceLabels, override);
    const wikiUrl = override.wikiUrl || cache.wikiUrl || firstWikiUrl(row.enrichmentSources);
    const rawDescription = override.description || cache.description || '';
    const cleanDescription = usableDescription(rawDescription);
    const descriptionWasRejected = Boolean(rawDescription && !cleanDescription);
    if (descriptionWasRejected) {
      rejectedDescriptions.push({
        itemKey: row.itemKey,
        displayName: override.displayName || row.displayName || row.className || row.itemKey,
        reason: 'description-failed-sanitizer',
      });
    }
    const publication = itemPublication(row, cache, override, descriptionWasRejected, disabledEngramData.disabled);
    if (publication.publishStatus !== 'publish') {
      hiddenItems.push({
        itemKey: row.itemKey,
        displayName: override.displayName || row.displayName || row.className || row.itemKey,
        publishStatus: publication.publishStatus,
        publishReason: publication.publishReason,
        evidenceTier: publication.evidenceTier,
        platformScope: publication.platformScope,
        disabledEngram: publication.disabledEngram?.className || '',
        disabledLine: publication.disabledEngram?.lineNumber || '',
      });
      continue;
    }
    const description = cleanDescription || pageConfig.unavailableDescriptionLabel;
    const craftingStation = override.craftingStation || cache.craftingStation || row.craftingStation || pageConfig.unknownCraftingStationLabel;
    const notes = displayNotes(override.notes || cache.notes || row.notes) || 'No notes listed.';
    const spawn = spawnDisplayFor(row);
    const itemIcon = itemIconFor(row, icon, category, pageConfig);
    const displayName = override.displayName || row.displayName || row.className || row.itemKey;
    const sourceFilter = filterKey(sourceLabel);

    const searchText = [
      displayName,
      sourceLabel,
      row.sourceType,
      row.sourceModName,
      row.sourceModId,
      categoryLabel,
      craftingStation,
      row.gfiCode,
      spawn.code,
      row.className,
      row.blueprintPath,
      description,
      notes,
      row.enrichmentSources,
      row.notes,
    ].filter(Boolean).join(' ').toLowerCase();

    const item = {
      itemKey: row.itemKey,
      displayName,
      className: row.className,
      category: categoryLabel,
      categoryColor: category.color || fallbackCategory.color,
      categoryTextColor: category.textColor || category.color || fallbackCategory.color,
      categoryIcon: category.icon || fallbackCategory.icon,
      sourceLabel,
      sourceType: row.sourceType,
      sourceModName: row.sourceModName,
      sourceModId: row.sourceModId,
      sourceFilter,
      craftingStation,
      description,
      wikiUrl,
      wikiTitle: wikiTitleFromUrl(wikiUrl),
      gfiCode: row.gfiCode,
      spawnLabel: spawn.label,
      spawnCode: spawn.code,
      notes,
      iconPath: itemIcon.path,
      iconFallback: itemIcon.fallback,
      iconStatus: itemIcon.status,
      searchText,
    };
    items.push(item);
  }

  items.sort((a, b) => {
    const aSource = a.sourceLabel === 'Ark' ? `0 ${a.sourceLabel}` : `1 ${a.sourceLabel}`;
    const bSource = b.sourceLabel === 'Ark' ? `0 ${b.sourceLabel}` : `1 ${b.sourceLabel}`;
    return aSource.localeCompare(bSource, undefined, { sensitivity: 'base' })
      || a.category.localeCompare(b.category, undefined, { sensitivity: 'base' })
      || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });

  writeItemPublicationReport({
    manifestRows,
    publicItems: items,
    hiddenItems,
    rejectedDescriptions,
    categoryAdjustments,
    disabledEngramData,
  });

  return {
    pageConfig,
    categories: itemCategories,
    catByLabel,
    items,
    stats: {
      manifestRows: manifestRows.length,
      publicRows: items.length,
      hiddenRows: hiddenItems.length,
      excludedRows: hiddenItems.filter((item) => item.publishStatus === 'exclude').length,
      reviewOnlyRows: hiddenItems.filter((item) => item.publishStatus === 'review-only').length,
      disabledByGameIniRows: hiddenItems.filter((item) => item.publishReason === 'game-ini-engram-hidden').length,
      disabledEngrams: disabledEngramData.disabled.size,
      rejectedDescriptions: rejectedDescriptions.length,
      categoryAdjustments: categoryAdjustments.length,
      wikiUrls: items.filter((item) => item.wikiUrl).length,
      descriptions: items.filter((item) => item.description !== pageConfig.unavailableDescriptionLabel).length,
      icons: items.filter((item) => !item.iconFallback).length,
    },
  };
}

function buildContext() {
  const modDoc = loadYamlFile(MOD_YAML_PATH);
  const itemDoc = loadYamlFile(ITEM_YAML_PATH);
  const creatureDoc = loadYamlFile(CREATURE_YAML_PATH);
  const itemData = normalizeItemRows(itemDoc);
  const site = modDoc.site || {};
  const categories = modDoc.categories || [];
  const cache = loadCache();
  const mods = modDoc.mods || [];
  const catByLabel = new Map(categories.map((c) => [c.label, c]));
  const accent = site.accentColor || '#00e5ff';

  return {
    site,
    categories,
    cache,
    mods,
    itemPage: itemData.pageConfig,
    itemCategories: itemData.categories,
    itemCatByLabel: itemData.catByLabel,
    items: itemData.items,
    itemStats: itemData.stats,
    creatureCategories: creatureDoc.categories || [],
    creatures: creatureDoc.creatures || [],
    catByLabel,
    accent,
    logoImage: site.logoImage || '',
    fontStylesheet: site.fontStylesheet || '',
  };
}

function categoryColor(ctx, label) {
  return ctx.catByLabel.get(label)?.color || ctx.accent;
}

function categoryTextColor(ctx, label) {
  return ctx.catByLabel.get(label)?.textColor || categoryColor(ctx, label);
}

function orderedCategories(ctx) {
  const order = ctx.site.categoryOrder && ctx.site.categoryOrder.length
    ? ctx.site.categoryOrder
    : ctx.categories.map((c) => c.label);
  const ordered = [];
  for (const label of order) {
    const c = ctx.catByLabel.get(label);
    if (c) ordered.push(c);
  }
  for (const c of ctx.categories) if (!ordered.includes(c)) ordered.push(c);
  return ordered;
}

function resolveThumb(ctx, mod) {
  if (!ctx.site.showThumbnails) return null;
  const onDisk = thumbOnDisk(mod.curseId);
  if (onDisk) return onDisk;
  const cached = ctx.cache[mod.curseId]?.thumbnail;
  if (cached) return cached;
  return null;
}

function pageBackground(site) {
  return site.backgroundImage
    ? `background-image:
      radial-gradient(circle at 79% 22%, rgba(0, 229, 255, .16), transparent 34%),
      linear-gradient(90deg, rgba(0, 2, 6, .58), rgba(0, 8, 14, .38) 38%, rgba(0, 4, 8, .18) 68%, rgba(0, 0, 0, .48)),
      linear-gradient(180deg, rgba(0, 0, 0, .08), rgba(0, 0, 0, .74)),
      url('${esc(site.backgroundImage)}');
    background-size: cover;
    background-attachment: fixed;
    background-position: center center;
    background-repeat: no-repeat;`
    : '';
}

function commonStyles(ctx) {
  const bg = pageBackground(ctx.site);

  return `
  :root {
    --accent: ${esc(ctx.accent)};
    --font-display: "Segoe UI", "Arial", system-ui, sans-serif;
    --font-body: "Segoe UI", system-ui, -apple-system, sans-serif;
    --bg: #01060a;
    --panel: rgba(0, 9, 15, .91);
    --panel-solid: #020d14;
    --row: linear-gradient(90deg, rgba(7, 37, 52, .9), rgba(5, 29, 42, .8) 36%, rgba(2, 18, 28, .84));
    --row-hover: linear-gradient(90deg, rgba(9, 53, 70, .98), rgba(6, 38, 54, .92) 38%, rgba(3, 25, 38, .94));
    --border: rgba(0, 238, 255, .72);
    --border-soft: rgba(65, 185, 215, .28);
    --text: #f1f7fb;
    --muted: #b2c0ca;
    --pill-bg: rgba(255,255,255,.07);
    --gold: #ffc45f;
    --danger: #ff315d;
    --page-overlay-opacity: ${ctx.site.backgroundImage ? '.58' : '.92'};
  }
  * { box-sizing: border-box; }
  html { overflow-x: hidden; }
  body {
    margin: 0; padding: 12px 18px 42px;
    font: 15px/1.5 var(--font-body);
    color: var(--text); background: var(--bg);
    ${bg}
  }
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1;
    background:
      radial-gradient(circle at 12% 14%, rgba(0, 209, 255, .12), transparent 30%),
      linear-gradient(115deg, rgba(0, 5, 9, .2), rgba(0, 0, 0, .86)),
      repeating-linear-gradient(90deg, rgba(0,229,255,.024) 0 1px, transparent 1px 86px),
      repeating-linear-gradient(0deg, rgba(0,229,255,.014) 0 1px, transparent 1px 86px);
    opacity: var(--page-overlay-opacity);
  }
  a { color: var(--accent); }
  .wrap { width: min(100%, 1440px); margin: 0 auto; }
  .panel {
    background:
      linear-gradient(180deg, rgba(3, 21, 31, .8), rgba(0, 9, 15, .92) 18%, rgba(0, 8, 14, .94)),
      var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px; overflow: hidden;
    box-shadow:
      0 0 0 1px rgba(0,0,0,.55),
      0 0 30px rgba(0, 229, 255, .18),
      0 28px 80px rgba(0,0,0,.62);
    backdrop-filter: blur(6px);
  }
  header.hero {
    padding: 16px 20px 10px;
    border-bottom: 1px solid var(--border);
    background:
      radial-gradient(circle at 8% 18%, rgba(0, 229, 255, .09), transparent 24%),
      linear-gradient(90deg, rgba(0,229,255,.035), transparent 48%),
      linear-gradient(180deg, rgba(255,255,255,.025), transparent);
  }
  .hero-brand {
    display: flex; align-items: center; gap: 22px; min-height: 108px; min-width: 0;
  }
  .brand-mark {
    flex: 0 0 auto; width: 150px; height: 108px;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .brand-mark::before { content: none; }
  .brand-mark img {
    position: relative; z-index: 1; width: 166px; max-height: 96px;
    object-fit: contain;
    filter: drop-shadow(0 0 10px rgba(0,229,255,.38)) drop-shadow(0 8px 12px rgba(0,0,0,.66));
  }
  .hero-copy { min-width: 0; overflow-wrap: anywhere; }
  .hero-copy.no-logo { padding-top: 8px; }
  .hero h1 {
    margin: 0; font-family: var(--font-display); font-size: 40px; line-height: 1; letter-spacing: 0; font-weight: 800;
    text-transform: none; color: #fff;
    text-shadow: 0 0 16px rgba(0,229,255,.25), 0 2px 0 rgba(0,0,0,.5);
  }
  .hero .subtitle { margin: 6px 0 0; color: var(--accent); font-family: var(--font-body); font-size: 21px; font-weight: 700; letter-spacing: 0; }
  .hero .intro { margin: 2px 0 0; color: #e1e7ec; max-width: 920px; font-size: 16px; overflow-wrap: anywhere; }
  .site-nav {
    display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(0, 238, 255, .46);
    background: linear-gradient(180deg, rgba(0,4,9,.28), rgba(0,8,14,.5));
  }
  .site-nav a {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 38px; padding: 8px 14px;
    border-radius: 7px; border: 1px solid rgba(83, 137, 165, .58);
    color: var(--text); text-decoration: none; font-weight: 700;
    background: rgba(2,10,17,.68);
  }
  .site-nav a:hover,
  .site-nav a.active {
    border-color: var(--accent); color: #06131a;
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 84%, #fff), var(--accent));
    box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .controls {
    display: flex; flex-direction: column; align-items: stretch; gap: 10px;
    padding: 10px 14px 12px; border-bottom: 1px solid rgba(0, 238, 255, .46);
    background: linear-gradient(180deg, rgba(0,4,9,.2), rgba(0,8,14,.38));
  }
  .searchbox { position: relative; flex: 0 0 auto; align-self: center; width: min(520px, 100%); max-width: 100%; }
  .searchbox svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); }
  #search {
    width: 100%; padding: 12px 14px 12px 42px;
    background: rgba(2,10,17,.78); border: 1px solid rgba(83, 137, 165, .58);
    border-radius: 8px; color: var(--text); font-size: 15px;
    box-shadow: inset 0 0 16px rgba(0,0,0,.58), 0 0 0 1px rgba(0,0,0,.26);
  }
  #search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,229,255,.15); }
  .filters {
    display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 10px 12px; align-items: center; justify-content: center;
    min-width: 0; overflow: visible; padding: 2px 2px 0;
  }
  .filter {
    flex: 0 0 auto; min-width: 82px; cursor: pointer;
  }
  .filter:hover { border-color: color-mix(in srgb, var(--c) 86%, #fff); color: color-mix(in srgb, var(--c) 86%, #fff); box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 15px color-mix(in srgb, var(--c) 28%, transparent); }
  .filter.active {
    border-color: color-mix(in srgb, var(--c) 92%, #fff);
    color: color-mix(in srgb, var(--c) 92%, #fff);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--c) 34%, rgba(8,20,31,.95)), color-mix(in srgb, var(--c) 18%, rgba(2,8,14,.95)));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 0 18px color-mix(in srgb, var(--c) 34%, transparent);
  }
  .meta-line { padding: 9px 14px 0; color: var(--muted); font-size: 13px; }
  .list { padding: 8px 12px 10px; }
  .mod {
    display: grid; grid-template-columns: 104px minmax(310px, .8fr) minmax(360px, 1.4fr) 58px;
    gap: 14px; align-items: stretch;
    padding: 9px 10px; border: 1px solid rgba(0, 210, 235, .44); border-radius: 9px;
    background: var(--row);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.055), inset 0 0 26px rgba(0,229,255,.036), 0 1px 0 rgba(0,0,0,.28);
  }
  .mod + .mod { margin-top: 8px; }
  .mod:hover { background: var(--row-hover); border-color: rgba(0,238,255,.62); }
  .mod-thumb { width: 104px; height: 104px; }
  .thumb {
    width: 104px; height: 104px; border-radius: 8px; object-fit: cover;
    border: 1px solid rgba(0,229,255,.22); background: #0a1018; display: block;
    box-shadow: 0 0 18px rgba(0,0,0,.42);
  }
  .thumb-fallback {
    display: flex; align-items: center; justify-content: center;
    border-color: color-mix(in srgb, var(--c) 48%, var(--border));
    background:
      linear-gradient(140deg, color-mix(in srgb, var(--c) 18%, #120b0b), #06111b 74%);
  }
  .thumb-fallback img { width: 46px; height: 46px; opacity: .92;
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c) 60%, transparent)); }
  .mod-main { display: contents; }
  .mod-head {
    min-width: 0; padding: 4px 14px 4px 2px;
    border-right: 1px solid var(--border-soft);
  }
  .mod-name {
    margin: 0 0 9px; font-family: var(--font-display); font-size: 20px; line-height: 1.18; font-weight: 800;
    color: color-mix(in srgb, var(--title-c, #fff) 82%, #fff);
    text-shadow:
      0 0 12px color-mix(in srgb, var(--title-c, var(--accent)) 34%, transparent),
      0 1px 0 rgba(0,0,0,.62);
  }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .category-badge {
    --c: var(--accent);
    display: inline-flex; align-items: center; justify-content: center;
    font: 600 14px/1.1 var(--font-body); padding: 5px 11px; border-radius: 5px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--c) 22%, rgba(6,17,27,.94)), color-mix(in srgb, var(--c) 10%, rgba(2,8,14,.92)));
    color: color-mix(in srgb, var(--c) 72%, #fff);
    border: 1px solid color-mix(in srgb, var(--c) 66%, rgba(0,0,0,.25));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 10px color-mix(in srgb, var(--c) 18%, transparent);
    text-transform: none; letter-spacing: 0;
    white-space: nowrap;
  }
  .pill-review {
    --c: var(--gold);
    color: #140d00;
    border-color: rgba(255,196,95,.86);
    background: linear-gradient(180deg, #ffd76d, #b57511);
  }
  .mod-cols {
    display: grid; grid-template-columns: minmax(260px, .95fr) minmax(320px, 1.05fr);
    gap: 0; min-width: 0;
  }
  .col { padding: 4px 28px; min-width: 0; display: flex; align-items: center; }
  .col + .col { border-left: 1px solid var(--border-soft); }
  .col p { margin: 0; color: var(--text); }
  .col .empty-field { min-height: 1.5em; color: transparent; }
  .col ul { margin: 0; padding-left: 16px; color: var(--text); }
  .col li { margin: 1px 0; }
  .muted { color: var(--muted); }
  .mod-action {
    display: flex; justify-content: center; align-items: center;
    border-left: 1px solid var(--border-soft);
  }
  .cf-link {
    display: flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 8px; color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent); transition: .15s;
  }
  .cf-link:hover { background: var(--accent); color: #04121a; }
  .empty { padding: 40px; text-align: center; color: var(--muted); display: none; }
  .page-body { padding: 14px; }
  .home-grid {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;
  }
  .nav-card,
  .reference-card,
  .sample-banner {
    border: 1px solid rgba(0, 210, 235, .44); border-radius: 9px;
    background: var(--row);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.055), inset 0 0 26px rgba(0,229,255,.036), 0 1px 0 rgba(0,0,0,.28);
  }
  .nav-card {
    min-height: 220px; display: flex; flex-direction: column; gap: 12px;
    padding: 16px; color: var(--text); text-decoration: none;
  }
  .nav-card:hover { background: var(--row-hover); border-color: rgba(0,238,255,.62); }
  .nav-card-icon {
    width: 58px; height: 58px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
    border: 1px solid color-mix(in srgb, var(--c) 56%, var(--border));
    background: linear-gradient(140deg, color-mix(in srgb, var(--c) 20%, #120b0b), #06111b 74%);
  }
  .nav-card-icon img { width: 32px; height: 32px; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c) 60%, transparent)); }
  .nav-card h2,
  .reference-card h2 {
    margin: 0; font-family: var(--font-display); font-size: 24px; line-height: 1.1; color: color-mix(in srgb, var(--c, var(--accent)) 80%, #fff);
  }
  .nav-card p { margin: 0; color: #e1e7ec; }
  .nav-card .status { margin-top: auto; color: var(--muted); font-size: 13px; }
  .sample-banner {
    margin-bottom: 12px; padding: 12px 14px; color: #ffe9b5;
    border-color: rgba(255,196,95,.74);
    background: linear-gradient(90deg, rgba(92, 54, 0, .58), rgba(4, 18, 26, .88));
  }
  .reference-list { display: grid; gap: 10px; }
  .reference-card {
    --c: var(--accent);
    display: grid; grid-template-columns: 104px minmax(240px, .7fr) minmax(360px, 1.3fr);
    gap: 14px; align-items: stretch; padding: 10px;
  }
  .reference-icon { width: 104px; height: 104px; }
  .reference-main { min-width: 0; padding: 4px 14px 4px 2px; border-right: 1px solid var(--border-soft); }
  .reference-main p { margin: 8px 0 0; color: #e1e7ec; }
  .detail-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
    align-content: start;
  }
  .detail {
    padding: 10px; min-width: 0; border: 1px solid var(--border-soft); border-radius: 7px;
    background: rgba(2,10,17,.48);
  }
  .detail b {
    display: block; margin-bottom: 4px; color: color-mix(in srgb, var(--c) 74%, #fff);
    font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
  }
  .detail span { color: var(--text); overflow-wrap: anywhere; }
  .item-list { padding: 8px 12px 10px; }
  .item-row {
    --c: var(--accent);
    display: grid; grid-template-columns: 88px minmax(320px, 1fr) minmax(430px, .9fr) 58px;
    gap: 12px; align-items: stretch;
    padding: 9px 10px; border: 1px solid rgba(0, 210, 235, .44); border-radius: 9px;
    background: var(--row);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.055), inset 0 0 26px rgba(0,229,255,.036), 0 1px 0 rgba(0,0,0,.28);
  }
  .item-row + .item-row { margin-top: 8px; }
  .item-row:hover { background: var(--row-hover); border-color: rgba(0,238,255,.62); }
  .item-icon { width: 88px; height: 88px; }
  .item-thumb {
    width: 88px; height: 88px; border-radius: 8px; object-fit: contain;
    border: 1px solid rgba(0,229,255,.22); background: rgba(2,10,17,.82); display: block;
    box-shadow: 0 0 18px rgba(0,0,0,.42);
  }
  .item-thumb-fallback {
    display: flex; align-items: center; justify-content: center;
    border-color: color-mix(in srgb, var(--c) 48%, var(--border));
    background: linear-gradient(140deg, color-mix(in srgb, var(--c) 18%, #120b0b), #06111b 74%);
  }
  .item-thumb-fallback img { width: 40px; height: 40px; opacity: .92; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c) 60%, transparent)); }
  .item-main { min-width: 0; padding: 3px 14px 3px 0; border-right: 1px solid var(--border-soft); }
  .item-name {
    margin: 0 0 7px; font-family: var(--font-display); font-size: 20px; line-height: 1.16; font-weight: 800;
    color: color-mix(in srgb, var(--c) 78%, #fff);
    text-shadow: 0 0 12px color-mix(in srgb, var(--c) 30%, transparent), 0 1px 0 rgba(0,0,0,.62);
  }
  .item-row .category-badge { max-width: 100%; white-space: normal; text-align: center; overflow-wrap: anywhere; }
  .item-source-badge { --c: var(--accent); }
  .item-description {
    margin: 8px 0 0; color: #e1e7ec; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .item-details {
    display: grid; grid-template-columns: minmax(170px, .42fr) minmax(230px, .58fr);
    gap: 10px; min-width: 0; padding: 2px 12px 2px 0;
    align-items: stretch;
    border-right: 1px solid var(--border-soft);
  }
  .item-detail-stack {
    display: flex; flex-direction: column; min-width: 0; min-height: 100%;
  }
  .item-facts {
    display: grid; grid-template-columns: 1fr; gap: 8px; align-content: start; min-width: 0;
    padding: 0;
  }
  .item-fact,
  .item-notes {
    min-width: 0; padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
    background: rgba(2,10,17,.48);
  }
  .item-notes { flex: 1 1 auto; }
  .item-fact b,
  .item-notes b {
    display: block; margin-bottom: 4px; color: var(--accent);
    font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
  }
  .item-fact span,
  .item-notes span { color: var(--text); overflow-wrap: anywhere; }
  .crafting-stations { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 3px; }
  .crafting-link { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 42%, transparent); }
  .crafting-link:hover { color: #f4feff; border-bottom-color: currentColor; }
  .crafting-separator { color: var(--muted); }
  .item-spawn-detail {
    display: flex; align-items: baseline; gap: 8px;
    margin-top: 10px;
  }
  .item-spawn-detail b { margin-bottom: 0; flex: 0 0 auto; }
  .item-spawn-detail code {
    min-width: 0; color: #f7fbff; font: 12px/1.35 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    overflow-wrap: anywhere;
  }
  .item-action {
    display: flex; justify-content: center; align-items: center;
  }
  .wiki-link { color: var(--accent); }
  .item-empty { padding: 40px; text-align: center; color: var(--muted); display: none; }
  footer { padding: 18px 30px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; text-align: center; }
  @media (max-width: 1120px) {
    body { padding: 10px 8px 34px; }
    .panel { border-radius: 14px; }
    .controls { flex-direction: column; align-items: stretch; gap: 10px; }
    .searchbox { flex: 0 0 auto; width: 100%; }
    .filters { width: 100%; }
    .home-grid { grid-template-columns: 1fr; }
    .mod {
      grid-template-columns: 104px minmax(260px, .85fr) 54px;
      grid-template-areas:
        "thumb head action"
        "thumb cols action";
      row-gap: 8px;
    }
    .mod-thumb { grid-area: thumb; }
    .mod-head { grid-area: head; border-right: 0; padding-right: 6px; }
    .mod-cols { grid-area: cols; border-top: 1px solid var(--border-soft); padding-top: 8px; }
    .mod-action { grid-area: action; }
    .reference-card {
      grid-template-columns: 104px 1fr;
      grid-template-areas:
        "reficon refmain"
        "details details";
    }
    .reference-icon { grid-area: reficon; }
    .reference-main { grid-area: refmain; border-right: 0; }
    .detail-grid { grid-area: details; border-top: 1px solid var(--border-soft); padding-top: 10px; }
    .item-row {
      grid-template-columns: 88px minmax(260px, 1fr) 54px;
      grid-template-areas:
        "itemicon itemmain itemaction"
        "itemicon itemdetails itemaction";
      row-gap: 8px;
    }
    .item-icon { grid-area: itemicon; }
    .item-main { grid-area: itemmain; border-right: 0; padding-right: 6px; }
    .item-details { grid-area: itemdetails; grid-template-columns: minmax(220px, .55fr) minmax(240px, .45fr); border-right: 0; border-top: 1px solid var(--border-soft); padding: 8px 0 0; }
    .item-action { grid-area: itemaction; }
  }
  @media (max-width: 760px) {
    body { padding: 0; }
    .wrap { width: 100%; }
    .panel { border-left: 0; border-right: 0; border-radius: 0; }
    header.hero { padding: 14px 14px 12px; }
    .hero-brand { align-items: flex-start; gap: 14px; min-height: 0; }
    .brand-mark { width: 92px; height: 82px; }
    .brand-mark img { width: 108px; max-height: 78px; }
    .hero h1 { font-size: clamp(30px, 7vw, 40px); }
    .hero .subtitle { font-size: 18px; }
    .hero .intro { font-size: 14px; }
    .site-nav { padding: 10px 12px; }
    .site-nav a { flex: 1 1 calc(50% - 10px); }
    .controls { padding: 10px 12px; }
    .list { padding: 8px 8px 10px; }
    .page-body { padding: 10px 8px; }
    .nav-card { min-height: 180px; }
    .mod {
      grid-template-columns: 74px 1fr 46px;
      grid-template-areas:
        "thumb head action"
        "cols cols cols";
      gap: 8px 10px;
      padding: 8px;
    }
    .mod-thumb, .thumb, .thumb-fallback { width: 74px; height: 74px; }
    .mod-name { font-size: 18px; }
    .category-badge { font-size: 13px; padding: 4px 9px; }
    .mod-cols { grid-template-columns: 1fr; gap: 0; padding-top: 8px; }
    .col { padding: 8px 4px; }
    .col + .col { border-left: 0; border-top: 1px solid var(--border-soft); }
    .mod-action { border-left: 0; }
    .cf-link { width: 40px; height: 40px; }
    .reference-card {
      grid-template-columns: 74px 1fr;
      gap: 8px 10px;
      padding: 8px;
    }
    .reference-icon, .reference-icon .thumb, .reference-icon .thumb-fallback { width: 74px; height: 74px; }
    .reference-card h2 { font-size: 18px; }
    .reference-main { padding: 4px 2px; }
    .detail-grid { grid-template-columns: 1fr; }
    .item-list { padding: 8px 8px 10px; }
    .item-row {
      grid-template-columns: 74px 1fr 46px;
      grid-template-areas:
        "itemicon itemmain itemaction"
        "itemdetails itemdetails itemdetails";
      gap: 8px 10px;
      padding: 8px;
    }
    .item-icon, .item-thumb, .item-thumb-fallback { width: 74px; height: 74px; }
    .item-thumb-fallback img { width: 32px; height: 32px; }
    .item-main { padding: 2px 0; }
    .item-name { font-size: 18px; }
    .item-description { -webkit-line-clamp: 3; }
    .item-details { grid-template-columns: 1fr; }
    .item-facts { grid-template-columns: 1fr; }
    .item-action { align-items: flex-start; }
  }`;
}

function pageNav(active) {
  return NAV_ITEMS.map((item) => {
    const activeClass = item.id === active ? ' class="active" aria-current="page"' : '';
    return `<a href="${esc(item.href)}"${activeClass}>${esc(item.label)}</a>`;
  }).join('\n        ');
}

function pageFooter(ctx, extraText = '') {
  if (extraText) return esc(extraText);
  if (ctx.site.footerText) return esc(ctx.site.footerText);
  return `${esc(ctx.site.serverName || '')} &middot; ${ctx.mods.length} mods`;
}

function pageShell(ctx, options) {
  const logoHtml = ctx.logoImage
    ? `<div class="brand-mark"><img src="${esc(ctx.logoImage)}" alt="ARK logo"></div>`
    : '';
  const pageTitle = options.pageTitle || ctx.site.pageTitle || 'ARK Reference';
  const title = `${pageTitle}${ctx.site.serverName ? ` - ${ctx.site.serverName}` : ''}`;
  const description = options.description || options.intro || ctx.site.introText || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2305141f'/%3E%3Cpath d='M32 8 54 56H44l-4-9H24l-4 9H10L32 8Zm0 17-6 14h12L32 25Z' fill='%2300e5ff'/%3E%3C/svg%3E">
${ctx.fontStylesheet ? `<link rel="stylesheet" href="${esc(ctx.fontStylesheet)}">` : ''}
<style>${commonStyles(ctx)}
</style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <header class="hero">
        <div class="hero-brand">
          ${logoHtml}
          <div class="hero-copy${ctx.logoImage ? '' : ' no-logo'}">
            <h1>${esc(options.heading || pageTitle)}</h1>
            <p class="subtitle">${esc(options.subtitle || ctx.site.subtitle || '')}</p>
            <p class="intro">${esc(options.intro || ctx.site.introText || '')}</p>
          </div>
        </div>
      </header>
      <nav class="site-nav" aria-label="Primary navigation">
        ${pageNav(options.active)}
      </nav>
${options.content}
      <footer>${pageFooter(ctx, options.footerText)}</footer>
    </div>
  </div>
${options.script || ''}
</body>
</html>
`;
}

function renderModRows(ctx) {
  return ctx.mods.map((m) => {
    const cat = ctx.catByLabel.get(m.primaryCategory);
    const color = cat?.color || ctx.accent;
    const titleColor = categoryTextColor(ctx, m.primaryCategory);
    const icon = cat?.icon || 'assets/category-icons/default.svg';
    const thumb = resolveThumb(ctx, m);
    const allCats = [m.primaryCategory, ...(m.additionalCategories || [])].filter(Boolean);
    const tips = m.tips || [];
    const tags = m.tags || [];
    const link = m.curseforgeUrl || ctx.cache[m.curseId]?.websiteUrl || '';

    const searchText = [
      m.displayName, m.sourceName, m.primaryCategory,
      ...(m.additionalCategories || []), ...tags, m.description, ...tips,
    ].filter(Boolean).join(' ').toLowerCase();

    const pills = [
      `<span class="category-badge" style="--c:${esc(color)}">${esc(m.primaryCategory)}</span>`,
      ...(ctx.site.showAdditionalCategoryPills
        ? (m.additionalCategories || []).map((c) => `<span class="category-badge" style="--c:${esc(categoryColor(ctx, c))}">${esc(c)}</span>`)
        : []),
    ].join('');

    const thumbHtml = thumb
      ? `<img class="thumb" src="${esc(thumb)}" alt="" loading="lazy">`
      : `<span class="thumb thumb-fallback" style="--c:${esc(color)}"><img src="${esc(icon)}" alt="" aria-hidden="true"></span>`;

    const tipsHtml = tips.length
      ? (tips.length === 1
        ? `<p>${esc(tips[0])}</p>`
        : `<ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)
      : '<p class="empty-field">&nbsp;</p>';

    const linkHtml = link
      ? `<a class="cf-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="Open on CurseForge" aria-label="Open ${esc(m.displayName)} on CurseForge">
           <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
         </a>`
      : '';

    return `      <article class="mod" style="--title-c:${esc(titleColor)}" data-categories="${esc(allCats.map((c) => c.toLowerCase()).join('|'))}" data-search="${esc(searchText)}">
        <div class="mod-thumb">${thumbHtml}</div>
        <div class="mod-main">
          <div class="mod-head">
            <h2 class="mod-name">${esc(m.displayName)}</h2>
            <div class="pills">${pills}</div>
          </div>
          <div class="mod-cols">
            <div class="col col-what">
              <p>${esc(m.description || '')}</p>
            </div>
            <div class="col col-why">
              ${tipsHtml}
            </div>
          </div>
        </div>
        <div class="mod-action">${linkHtml}</div>
      </article>`;
  }).join('\n');
}

function itemSourceFilters(ctx) {
  const counts = new Map();
  for (const item of ctx.items) {
    counts.set(item.sourceLabel, (counts.get(item.sourceLabel) || 0) + 1);
  }

  const maxButtons = Number(ctx.itemPage.maxSourceFilterButtons || 18);
  const sources = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
  const ark = sources.find(([label]) => label === 'Ark');
  const selected = [];
  if (ark) selected.push(ark);
  for (const source of sources) {
    if (source[0] === 'Ark') continue;
    if (selected.length >= maxButtons) break;
    selected.push(source);
  }
  return selected;
}

function renderItemRows(ctx) {
  return ctx.items.map((item) => {
    const iconHtml = item.iconFallback
      ? `<span class="item-thumb item-thumb-fallback" style="--c:${esc(item.categoryColor)}"><img src="${esc(item.iconPath)}" alt="" aria-hidden="true"></span>`
      : `<img class="item-thumb" src="${esc(item.iconPath)}" alt="" loading="lazy" decoding="async">`;

    const pills = [
      `<span class="category-badge item-source-badge" style="--c:${esc(ctx.accent)}">${esc(item.sourceLabel)}</span>`,
      `<span class="category-badge" style="--c:${esc(item.categoryColor)}">${esc(item.category)}</span>`,
    ].join('');

    const wikiHtml = item.wikiUrl
      ? `<a class="cf-link wiki-link" href="${esc(item.wikiUrl)}" target="_blank" rel="noopener noreferrer" title="Open on ARK wiki" aria-label="Open ${esc(item.displayName)} on ARK wiki">
           <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
         </a>`
      : '';

    return `      <article class="item-row" style="--c:${esc(item.categoryColor)}" data-source="${esc(item.sourceFilter)}" data-search="${esc(item.searchText)}">
        <div class="item-icon">${iconHtml}</div>
        <div class="item-main">
          <h2 class="item-name">${esc(item.displayName)}</h2>
          <div class="pills">${pills}</div>
          <p class="item-description">${esc(item.description)}</p>
          <div class="item-fact item-spawn-detail"><b>${esc(item.spawnLabel)}</b><code>${esc(item.spawnCode)}</code></div>
        </div>
        <div class="item-details">
          <div class="item-facts">
            <div class="item-fact"><b>Source</b><span>${esc(item.sourceLabel)}</span></div>
            <div class="item-fact"><b>Crafting</b><span class="crafting-stations">${craftingStationLinksHtml(item.craftingStation)}</span></div>
          </div>
          <div class="item-detail-stack">
            <div class="item-notes"><b>Notes</b><span>${esc(item.notes)}</span></div>
          </div>
        </div>
        <div class="item-action">${wikiHtml}</div>
      </article>`;
  }).join('\n');
}

function renderHomePage(ctx) {
  const cardData = [
    {
      title: 'Mods',
      href: 'mods.html',
      icon: 'assets/category-icons/core-utility.svg',
      color: '#2f67ff',
      text: 'Browse installed server mods, filter by category, and get quick notes on what each mod adds.',
      status: `${ctx.mods.length} mod entries available`,
    },
    {
      title: 'Items',
      href: 'items.html',
      icon: 'assets/category-icons/equipment-items.svg',
      color: '#ffb347',
      text: 'Look up server items, sources, icons, crafting context, spawn commands, and wiki links.',
      status: `${ctx.items.length} item ${ctx.items.length === 1 ? 'entry' : 'entries'} loaded from manifests`,
    },
    {
      title: 'Creatures',
      href: 'creatures.html',
      icon: 'assets/category-icons/creatures.svg',
      color: '#38f06f',
      text: 'Future home for modded creatures, taming notes, utility roles, and saddle or unlock context.',
      status: `${ctx.creatures.length} creature ${ctx.creatures.length === 1 ? 'entry' : 'entries'} loaded from YAML`,
    },
  ];

  const cards = cardData.map((card) => `
        <a class="nav-card" href="${esc(card.href)}" style="--c:${esc(card.color)}">
          <span class="nav-card-icon"><img src="${esc(card.icon)}" alt="" aria-hidden="true"></span>
          <h2>${esc(card.title)}</h2>
          <p>${esc(card.text)}</p>
          <span class="status">${esc(card.status)}</span>
        </a>`).join('');

  return pageShell(ctx, {
    active: 'home',
    pageTitle: 'Server Reference Home',
    heading: 'Server Reference',
    intro: 'Quick navigation for the Legion of Idiots server reference pages.',
    content: `      <main class="page-body">
        <div class="home-grid">
${cards}
        </div>
      </main>
`,
  });
}

function renderModsPage(ctx) {
  const filterButtons = [
    `<button class="filter category-badge active" data-filter="all" style="--c:${esc(ctx.accent)}">All</button>`,
    ...orderedCategories(ctx).map((c) =>
      `<button class="filter category-badge" data-filter="${esc(c.label.toLowerCase())}" style="--c:${esc(c.color)}">${esc(c.label)}</button>`),
  ].join('\n        ');

  const rows = renderModRows(ctx);

  return pageShell(ctx, {
    active: 'mods',
    pageTitle: ctx.site.pageTitle || 'Server Mod Quick Reference',
    heading: ctx.site.pageTitle || 'Server Mod Quick Reference',
    intro: ctx.site.introText || '',
    content: `      <div class="controls">
        <div class="searchbox">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="search" type="search" placeholder="Search mods, categories, items, tags..." autocomplete="off">
        </div>
        <div class="filters">
        ${filterButtons}
        </div>
      </div>
      <div class="meta-line"><span id="count">${ctx.mods.length}</span> mods shown</div>
      <div class="list" id="list">
${rows}
        <div class="empty" id="empty">No mods match your search.</div>
      </div>
`,
    script: `<script>
(function () {
  var search = document.getElementById('search');
  var list = document.getElementById('list');
  var mods = Array.prototype.slice.call(list.querySelectorAll('.mod'));
  var filters = Array.prototype.slice.call(document.querySelectorAll('.filter'));
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');
  var activeFilter = 'all';

  function apply() {
    var q = search.value.trim().toLowerCase();
    var shown = 0;
    mods.forEach(function (el) {
      var matchText = !q || el.getAttribute('data-search').indexOf(q) !== -1;
      var cats = el.getAttribute('data-categories').split('|');
      var matchCat = activeFilter === 'all' || cats.indexOf(activeFilter) !== -1;
      var visible = matchText && matchCat;
      el.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    count.textContent = shown;
    empty.style.display = shown ? 'none' : 'block';
  }

  search.addEventListener('input', apply);
  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filters.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      apply();
    });
  });
  apply();
})();
</script>`,
  });
}

function renderReferenceEntry(entry, details, options = {}) {
  const badges = [
    `<span class="category-badge" style="--c:${esc(entry.color)}">${esc(entry.category)}</span>`,
    ...(entry.fakeData ? ['<span class="category-badge pill-review">Fake test data</span>'] : []),
  ].join('');
  const tipsHtml = entry.tips?.length
    ? `<div class="detail"><b>Notes</b><span>${esc(entry.tips.join(' '))}</span></div>`
    : '';
  const detailHtml = details.filter(([, value]) => value).map(([label, value]) => `
          <div class="detail"><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('');

  const extraClass = options.className ? ` ${options.className}` : '';
  const dataAttrs = options.dataAttrs || '';

  return `        <article class="reference-card${extraClass}" style="--c:${esc(entry.color)}"${dataAttrs}>
          <div class="reference-icon">
            <span class="thumb thumb-fallback" style="--c:${esc(entry.color)}"><img src="${esc(entry.icon)}" alt="" aria-hidden="true"></span>
          </div>
          <div class="reference-main">
            <h2>${esc(entry.displayName)}</h2>
            <div class="pills">
              ${badges}
            </div>
            <p>${esc(entry.description)}</p>
          </div>
          <div class="detail-grid">
${detailHtml}
          ${tipsHtml}
          </div>
        </article>`;
}

function enrichReferenceEntry(entry, categories, fallback) {
  const category = categories.find((c) => c.label === entry.category);
  return {
    ...entry,
    category: entry.category || category?.label || 'Uncategorized',
    color: entry.color || category?.color || fallback.color,
    icon: entry.icon || category?.icon || fallback.icon,
  };
}

function renderItemsPage(ctx) {
  const filterButtons = [
    `<button class="filter category-badge active" data-filter="all" style="--c:${esc(ctx.accent)}">All</button>`,
    ...itemSourceFilters(ctx).map(([label]) =>
      `<button class="filter category-badge" data-filter="${esc(filterKey(label))}" style="--c:${esc(ctx.accent)}">${esc(label)}</button>`),
  ].join('\n        ');

  const rows = renderItemRows(ctx);

  return pageShell(ctx, {
    active: 'items',
    pageTitle: ctx.itemPage.title || 'Item Reference',
    heading: ctx.itemPage.title || 'Item Reference',
    intro: ctx.itemPage.intro || '',
    content: `      <div class="controls">
        <div class="searchbox">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="search" type="search" placeholder="Search items, sources, GFI codes, crafting stations..." autocomplete="off">
        </div>
        <div class="filters">
        ${filterButtons}
        </div>
      </div>
      <div class="meta-line"><span id="count">${ctx.items.length}</span> items shown</div>
      <div class="item-list" id="list">
${rows}
        <div class="item-empty" id="empty">No items match your search.</div>
      </div>
`,
    footerText: `${ctx.site.serverName || 'Server'} - ${ctx.items.length} public items from ${ctx.itemStats.manifestRows} manifest rows, ${ctx.itemStats.hiddenRows} hidden`,
    script: `<script>
(function () {
  var search = document.getElementById('search');
  var list = document.getElementById('list');
  var items = Array.prototype.slice.call(list.querySelectorAll('.item-row'));
  var filters = Array.prototype.slice.call(document.querySelectorAll('.filter'));
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');
  var activeFilter = 'all';
  var timer = null;

  function apply() {
    var q = search.value.trim().toLowerCase();
    var shown = 0;
    items.forEach(function (el) {
      var matchText = !q || el.getAttribute('data-search').indexOf(q) !== -1;
      var matchSource = activeFilter === 'all' || el.getAttribute('data-source') === activeFilter;
      var visible = matchText && matchSource;
      el.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    count.textContent = shown;
    empty.style.display = shown ? 'none' : 'block';
  }

  function scheduleApply() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(apply, 80);
  }

  search.addEventListener('input', scheduleApply);
  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filters.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      apply();
    });
  });
  apply();
})();
</script>`,
  });
}

function renderCreaturesPage(ctx) {
  const creatureCategories = ctx.creatureCategories.length ? ctx.creatureCategories : [{
    label: 'Creatures',
    color: '#38f06f',
  }];
  const filterButtons = [
    `<button class="filter category-badge active" data-filter="all" style="--c:${esc(ctx.accent)}">All</button>`,
    ...creatureCategories.map((category) =>
      `<button class="filter category-badge" data-filter="${esc(filterKey(category.label))}" style="--c:${esc(category.color || '#38f06f')}">${esc(category.label)}</button>`),
  ].join('\n        ');

  const entries = ctx.creatures.map((creature) => enrichReferenceEntry(creature, ctx.creatureCategories, {
    color: '#38f06f',
    icon: 'assets/category-icons/creatures.svg',
  })).map((creature) => {
    const searchText = [
      creature.displayName,
      creature.category,
      creature.sourceMod,
      creature.description,
      creature.tamingMethod,
      creature.spawnContext,
      creature.utility,
      creature.saddleOrUnlock,
      ...(creature.tips || []),
      ...(creature.tags || []),
    ].filter(Boolean).join(' ').toLowerCase();
    return renderReferenceEntry(creature, [
    ['Source mod', creature.sourceMod],
    ['Taming method', creature.tamingMethod],
    ['Spawn context', creature.spawnContext],
    ['Utility', creature.utility],
    ['Saddle / unlock', creature.saddleOrUnlock],
    ], {
      className: 'creature-row',
      dataAttrs: ` data-category="${esc(filterKey(creature.category))}" data-search="${esc(searchText)}"`,
    });
  }).join('\n');

  return pageShell(ctx, {
    active: 'creatures',
    pageTitle: 'Creature Reference',
    heading: 'Creature Reference',
    intro: 'Placeholder page for future creature reference data.',
    content: `      <div class="controls">
        <div class="searchbox">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="search" type="search" placeholder="Search creatures, sources, taming, utility..." autocomplete="off">
        </div>
        <div class="filters">
        ${filterButtons}
        </div>
      </div>
      <main class="page-body">
        <div class="sample-banner">This page currently contains fake sample data for layout testing only.</div>
        <div class="meta-line"><span id="count">${ctx.creatures.length}</span> creatures shown</div>
        <div class="reference-list" id="list">
${entries}
          <div class="empty" id="empty">No creatures match your search.</div>
        </div>
      </main>
`,
    footerText: `${ctx.site.serverName || 'Server'} - Creature page scaffold`,
    script: `<script>
(function () {
  var search = document.getElementById('search');
  var list = document.getElementById('list');
  var rows = Array.prototype.slice.call(list.querySelectorAll('.creature-row'));
  var filters = Array.prototype.slice.call(document.querySelectorAll('.filter'));
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');
  var activeFilter = 'all';

  function apply() {
    var q = search.value.trim().toLowerCase();
    var shown = 0;
    rows.forEach(function (el) {
      var matchText = !q || el.getAttribute('data-search').indexOf(q) !== -1;
      var matchCategory = activeFilter === 'all' || el.getAttribute('data-category') === activeFilter;
      var visible = matchText && matchCategory;
      el.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    count.textContent = shown;
    empty.style.display = shown ? 'none' : 'block';
  }

  search.addEventListener('input', apply);
  filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filters.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      apply();
    });
  });
  apply();
})();
</script>`,
  });
}

function main() {
  const ctx = buildContext();
  const pages = [
    ['home', OUTPUTS.home, renderHomePage(ctx)],
    ['mods', OUTPUTS.mods, renderModsPage(ctx)],
    ['items', OUTPUTS.items, renderItemsPage(ctx)],
    ['creatures', OUTPUTS.creatures, renderCreaturesPage(ctx)],
  ];

  for (const [, path, html] of pages) {
    writeFileSync(path, html, 'utf8');
    console.log(`Built ${path}`);
  }

  console.log(`  ${ctx.mods.length} mods, ${ctx.categories.length} categories`);
  console.log(`  ${ctx.items.length} public items from ${ctx.itemStats.manifestRows} item manifest rows (${ctx.itemStats.hiddenRows} hidden, ${ctx.itemStats.disabledByGameIniRows} disabled by Game.ini, ${ctx.itemStats.rejectedDescriptions} rejected descriptions)`);
  console.log(`  ${ctx.creatures.length} creatures from data/creature-reference.yaml`);
}

main();
