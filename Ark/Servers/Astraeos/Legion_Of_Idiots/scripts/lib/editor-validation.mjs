import { isAbsolute, normalize } from 'node:path';
import { findCreatureEntry, findItemEntry, findModEntry } from './editor-data.mjs';

const MOD_FIELDS = new Set([
  'displayName',
  'sourceName',
  'curseforgeUrl',
  'thumbnail',
  'primaryCategory',
  'additionalCategories',
  'description',
  'tips',
  'tags',
]);

const ITEM_FIELDS = new Set([
  'displayName',
  'category',
  'sourceLabel',
  'description',
  'craftingStation',
  'notes',
  'wikiUrl',
  'publishStatus',
  'publishReason',
]);

const CREATURE_FIELDS = new Set([
  'id',
  'displayName',
  'sourceMod',
  'category',
  'description',
  'tamingMethod',
  'spawnContext',
  'utility',
  'saddleOrUnlock',
  'tips',
  'tags',
  'fakeData',
]);

const SITE_FIELDS = new Set([
  'serverName',
  'pageTitle',
  'subtitle',
  'introText',
  'accentColor',
  'logoImage',
  'fontStylesheet',
  'backgroundImage',
  'showThumbnails',
  'showAdditionalCategoryPills',
  'footerText',
  'categoryOrder',
]);

const ARRAY_FIELDS = new Set(['additionalCategories', 'tips', 'tags', 'categoryOrder']);
const BOOLEAN_FIELDS = new Set(['fakeData', 'showThumbnails', 'showAdditionalCategoryPills']);
const ITEM_PUBLISH_STATUSES = new Set(['', 'publish', 'review-only', 'exclude']);

function trimString(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(trimString).filter(Boolean);
  return String(value ?? '')
    .split(/\r?\n/)
    .map(trimString)
    .filter(Boolean);
}

function asBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function cleanPatch(patch, allowedFields) {
  const out = {};
  for (const [field, value] of Object.entries(patch || {})) {
    if (!allowedFields.has(field)) continue;
    if (ARRAY_FIELDS.has(field)) {
      out[field] = asArray(value);
    } else if (BOOLEAN_FIELDS.has(field)) {
      out[field] = asBoolean(value);
    } else {
      out[field] = trimString(value);
    }
  }
  return out;
}

function categoryLabels(categories) {
  return new Set((categories || []).map((category) => category.label).filter(Boolean));
}

function validUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validRelativeAsset(value) {
  if (!value) return true;
  if (/^[a-z]+:/i.test(value)) return false;
  if (isAbsolute(value)) return false;
  const normalized = normalize(value).replace(/\\/g, '/');
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}

function validHexColor(value) {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value);
}

function addUnknownCategoryErrors(errors, values, known, fieldLabel) {
  for (const value of values) {
    if (!known.has(value)) errors.push(`${fieldLabel} "${value}" is not a known category.`);
  }
}

function validateMod(id, patch, state) {
  const errors = [];
  const mod = findModEntry(state, id);
  if (!mod) errors.push(`No mod entry exists for curseId "${id}".`);

  const known = categoryLabels(state.mods.categories);
  const primary = patch.primaryCategory;
  if ('displayName' in patch && !patch.displayName) errors.push('Display name is required.');
  if ('primaryCategory' in patch) {
    if (!primary) errors.push('Primary category is required.');
    if (primary && !known.has(primary)) errors.push(`Primary category "${primary}" is not a known mod category.`);
  }
  if ('additionalCategories' in patch) {
    addUnknownCategoryErrors(errors, patch.additionalCategories, known, 'Additional category');
  }
  if ('curseforgeUrl' in patch && !validUrl(patch.curseforgeUrl)) errors.push('CurseForge URL must be blank or a valid http(s) URL.');
  if ('thumbnail' in patch && !validRelativeAsset(patch.thumbnail)) errors.push('Thumbnail must be a relative site asset path.');

  return errors;
}

function validateItem(id, patch, state, removeOverride) {
  const errors = [];
  const item = findItemEntry(state, id);
  if (!item) errors.push(`No item entry exists for "${id}".`);
  if (removeOverride) return errors;

  const known = categoryLabels(state.items.categories);
  if ('category' in patch && patch.category && !known.has(patch.category)) {
    errors.push(`Category "${patch.category}" is not a known item category.`);
  }
  if ('wikiUrl' in patch && !validUrl(patch.wikiUrl)) errors.push('Wiki URL must be blank or a valid http(s) URL.');
  if ('publishStatus' in patch && !ITEM_PUBLISH_STATUSES.has(patch.publishStatus)) {
    errors.push(`Publication status "${patch.publishStatus}" is not supported.`);
  }

  return errors;
}

function validateCreature(id, patch, state) {
  const errors = [];
  const creature = findCreatureEntry(state, id);
  if (!creature) errors.push(`No creature entry exists for id "${id}".`);

  const known = categoryLabels(state.creatures.categories);
  if ('id' in patch) {
    if (!patch.id) errors.push('Creature ID is required.');
    const duplicate = state.creatures.entries.find((entry) => entry.id === patch.id && entry.id !== id);
    if (duplicate) errors.push(`Creature ID "${patch.id}" is already used.`);
  }
  if ('displayName' in patch && !patch.displayName) errors.push('Display name is required.');
  if ('category' in patch) {
    if (!patch.category) errors.push('Category is required.');
    if (patch.category && !known.has(patch.category)) errors.push(`Category "${patch.category}" is not a known creature category.`);
  }

  return errors;
}

function validateSite(patch, state) {
  const errors = [];
  const known = categoryLabels(state.mods.categories);
  if ('accentColor' in patch && patch.accentColor && !validHexColor(patch.accentColor)) {
    errors.push('Accent color must be a hex color like #00e5ff.');
  }
  for (const field of ['logoImage', 'fontStylesheet', 'backgroundImage']) {
    if (field in patch && !validRelativeAsset(patch[field])) {
      errors.push(`${field} must be a relative site asset path.`);
    }
  }
  if ('categoryOrder' in patch) addUnknownCategoryErrors(errors, patch.categoryOrder, known, 'Category order entry');
  return errors;
}

export function validateEditorChange(section, id, rawPatch, state, options = {}) {
  const removeOverride = Boolean(options.removeOverride);
  let allowedFields;
  if (section === 'mods') allowedFields = MOD_FIELDS;
  if (section === 'items') allowedFields = ITEM_FIELDS;
  if (section === 'creatures') allowedFields = CREATURE_FIELDS;
  if (section === 'site') allowedFields = SITE_FIELDS;

  if (!allowedFields) {
    return { ok: false, errors: [`Unsupported editor section "${section}".`], patch: {} };
  }

  const patch = cleanPatch(rawPatch, allowedFields);
  let errors = [];
  if (section === 'mods') errors = validateMod(id, patch, state);
  if (section === 'items') errors = validateItem(id, patch, state, removeOverride);
  if (section === 'creatures') errors = validateCreature(id, patch, state);
  if (section === 'site') errors = validateSite(patch, state);

  return {
    ok: errors.length === 0,
    errors,
    patch,
    removeOverride,
  };
}

export const EDITABLE_FIELDS = {
  mods: [...MOD_FIELDS],
  items: [...ITEM_FIELDS],
  creatures: [...CREATURE_FIELDS],
  site: [...SITE_FIELDS],
};
