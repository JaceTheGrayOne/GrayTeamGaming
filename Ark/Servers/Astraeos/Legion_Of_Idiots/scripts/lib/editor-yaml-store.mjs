import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseDocument } from 'yaml';
import { dumpYaml, parseYaml } from './mini-yaml.mjs';
import {
  findItemEntry,
  loadEditorState,
  PATHS,
  relativeSitePath,
  siteRoot,
} from './editor-data.mjs';
import { validateEditorChange } from './editor-validation.mjs';

const ITEM_OVERRIDE_FIELDS = [
  'displayName',
  'category',
  'sourceLabel',
  'description',
  'craftingStation',
  'notes',
  'wikiUrl',
  'publishStatus',
  'publishReason',
];

function splitText(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalized = text.replace(/\r\n/g, '\n');
  const hasFinalNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return { lines, eol, hasFinalNewline };
}

function joinText(lines, eol, hasFinalNewline = true) {
  return lines.join(eol) + (hasFinalNewline ? eol : '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function semanticEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function mergePatch(existing, patch) {
  const next = { ...(existing || {}) };
  let changed = false;
  for (const [key, value] of Object.entries(patch || {})) {
    if (!semanticEqual(next[key], value)) {
      next[key] = value;
      changed = true;
    }
  }
  return { next, changed };
}

function readSource(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(text) || {};
  return { text, parsed };
}

function sourceFromText(text) {
  return { text, parsed: parseYaml(text) || {} };
}

function topLevelRange(lines, key) {
  const start = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}:\\s*(?:#.*)?$`).test(line));
  if (start === -1) throw new Error(`Could not find top-level "${key}" block.`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[^\s#][^:]*:\s*/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function sequenceItemObject(seqKey, blockLines) {
  const parsed = parseYaml(`${seqKey}:\n${blockLines.join('\n')}\n`) || {};
  return parsed[seqKey]?.[0] || {};
}

function sequenceItemRange(lines, seqKey, matchKey, matchValue) {
  const parent = topLevelRange(lines, seqKey);
  for (let i = parent.start + 1; i < parent.end; i++) {
    if (!/^  -(?:\s|$)/.test(lines[i])) continue;
    const start = i;
    let end = parent.end;
    for (let j = i + 1; j < parent.end; j++) {
      if (/^  -(?:\s|$)/.test(lines[j])) {
        end = j;
        break;
      }
    }
    const obj = sequenceItemObject(seqKey, lines.slice(start, end));
    if (String(obj[matchKey] ?? '') === String(matchValue)) return { start, end };
    i = end - 1;
  }
  throw new Error(`Could not find ${seqKey} entry where ${matchKey} is "${matchValue}".`);
}

function mapEntryRange(lines, parentKey, entryKey) {
  const parent = topLevelRange(lines, parentKey);
  const entryPattern = new RegExp(`^  ${escapeRegExp(entryKey)}:\\s*(?:#.*)?$`);
  const start = lines.findIndex((line, index) =>
    index > parent.start && index < parent.end && entryPattern.test(line));
  if (start === -1) return null;
  let end = parent.end;
  for (let i = start + 1; i < parent.end; i++) {
    if (/^  [^\s#][^:]*:\s*/.test(lines[i])) {
      end = i;
      break;
    }
  }
  while (end > start + 1 && /^\s*(?:#.*)?$/.test(lines[end - 1])) end--;
  return { start, end, parent };
}

function dumpSequenceItem(value) {
  const lines = dumpYaml(value).trimEnd().split('\n');
  return lines.map((line, index) => `  ${index === 0 ? '- ' : '  '}${line}`).join('\n');
}

function dumpTopMap(key, value) {
  return dumpYaml({ [key]: value }).trimEnd();
}

function dumpNestedMapEntry(key, value) {
  return dumpYaml({ [key]: value })
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function replaceLines(text, range, replacement) {
  const { lines, eol, hasFinalNewline } = splitText(text);
  const replacementLines = replacement ? replacement.split('\n') : [];
  lines.splice(range.start, range.end - range.start, ...replacementLines);
  return joinText(lines, eol, hasFinalNewline);
}

function insertManualOverride(text, entryKey, value) {
  const { lines, eol, hasFinalNewline } = splitText(text);
  let parent = topLevelRange(lines, 'manualOverrides');
  const parentLine = lines[parent.start];
  const replacement = dumpNestedMapEntry(entryKey, value).split('\n');

  if (/^manualOverrides:\s*\{\}\s*$/.test(parentLine)) {
    lines.splice(parent.start, 1, 'manualOverrides:', ...replacement);
    return joinText(lines, eol, hasFinalNewline);
  }

  lines.splice(parent.end, 0, ...replacement);
  return joinText(lines, eol, hasFinalNewline);
}

function replaceManualOverride(text, entryKey, value) {
  const { lines } = splitText(text);
  const range = mapEntryRange(lines, 'manualOverrides', entryKey);
  if (!range) return insertManualOverride(text, entryKey, value);
  return replaceLines(text, range, dumpNestedMapEntry(entryKey, value));
}

function deleteManualOverride(text, entryKey) {
  const { lines } = splitText(text);
  const range = mapEntryRange(lines, 'manualOverrides', entryKey);
  if (!range) return text;
  return replaceLines(text, range, '');
}

function changedTextForSequenceSource(source, seqKey, matchKey, matchValue, patch) {
  const { text, parsed } = source;
  const entries = parsed[seqKey] || [];
  const existing = entries.find((entry) => String(entry?.[matchKey] ?? '') === String(matchValue));
  if (!existing) throw new Error(`Could not find ${seqKey} entry where ${matchKey} is "${matchValue}".`);
  const { next, changed } = mergePatch(existing, patch);
  if (!changed) return { text, updatedText: text };

  const { lines } = splitText(text);
  const range = sequenceItemRange(lines, seqKey, matchKey, matchValue);
  return { text, updatedText: replaceLines(text, range, dumpSequenceItem(next)) };
}

function changedTextForSequence(filePath, seqKey, matchKey, matchValue, patch) {
  return changedTextForSequenceSource(readSource(filePath), seqKey, matchKey, matchValue, patch);
}

function changedTextForTopMapSource(source, key, patch) {
  const { text, parsed } = source;
  const { next, changed } = mergePatch(parsed[key] || {}, patch);
  if (!changed) return { text, updatedText: text };

  const { lines } = splitText(text);
  const range = topLevelRange(lines, key);
  return { text, updatedText: replaceLines(text, range, dumpTopMap(key, next)) };
}

function changedTextForTopMap(filePath, key, patch) {
  return changedTextForTopMapSource(readSource(filePath), key, patch);
}

function itemOverridePatch(existing, item, patch) {
  const next = { ...(existing || {}) };
  let changed = false;

  for (const field of ITEM_OVERRIDE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field];
    const baseline = item.baseline?.[field];
    const shouldDelete = String(value ?? '') === '';
    const matchesBaseline = semanticEqual(value, baseline);

    if (shouldDelete || matchesBaseline) {
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        delete next[field];
        changed = true;
      }
    } else if (!semanticEqual(next[field], value)) {
      next[field] = value;
      changed = true;
    }
  }

  return { next, changed };
}

function changedTextForItemSource(source, id, patch, state, removeOverride) {
  const { text, parsed } = source;
  const item = findItemEntry(state, id);
  if (!item) throw new Error(`Could not find item "${id}".`);
  const manualOverrides = parsed.manualOverrides || {};
  const overrideKey = item.overrideKey || item.suggestedOverrideKey;
  if (!overrideKey) throw new Error(`Item "${id}" does not have a usable override key.`);

  if (removeOverride) {
    if (!Object.prototype.hasOwnProperty.call(manualOverrides, overrideKey)) return { text, updatedText: text };
    return { text, updatedText: deleteManualOverride(text, overrideKey) };
  }

  const existing = manualOverrides[overrideKey] || {};
  const { next, changed } = itemOverridePatch(existing, item, patch);
  if (!changed) return { text, updatedText: text };

  if (Object.keys(next).length === 0) {
    return { text, updatedText: deleteManualOverride(text, overrideKey) };
  }
  return { text, updatedText: replaceManualOverride(text, overrideKey, next) };
}

function changedTextForItem(filePath, id, patch, state, removeOverride) {
  return changedTextForItemSource(readSource(filePath), id, patch, state, removeOverride);
}

function fileForSection(section) {
  if (section === 'mods' || section === 'site') return PATHS.modYaml;
  if (section === 'items') return PATHS.itemYaml;
  if (section === 'creatures') return PATHS.creatureYaml;
  throw new Error(`Unsupported editor section "${section}".`);
}

function changedTextForRequest(section, id, patch, state, removeOverride) {
  if (section === 'mods') return changedTextForSequence(PATHS.modYaml, 'mods', 'curseId', id, patch);
  if (section === 'items') return changedTextForItem(PATHS.itemYaml, id, patch, state, removeOverride);
  if (section === 'creatures') return changedTextForSequence(PATHS.creatureYaml, 'creatures', 'id', id, patch);
  if (section === 'site') return changedTextForTopMap(PATHS.modYaml, 'site', patch);
  throw new Error(`Unsupported editor section "${section}".`);
}

function changedTextForRequestSource(source, section, id, patch, state, removeOverride) {
  if (section === 'mods') return changedTextForSequenceSource(source, 'mods', 'curseId', id, patch);
  if (section === 'items') return changedTextForItemSource(source, id, patch, state, removeOverride);
  if (section === 'creatures') return changedTextForSequenceSource(source, 'creatures', 'id', id, patch);
  if (section === 'site') return changedTextForTopMapSource(source, 'site', patch);
  throw new Error(`Unsupported editor section "${section}".`);
}

function timestamp() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function createBackup(filePath) {
  const backupDir = join(siteRoot, '_local', 'backups', 'editor', timestamp());
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, basename(filePath));
  copyFileSync(filePath, backupPath);
  return relativeSitePath(backupPath);
}

function verifyYaml(text, filePath) {
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors?.length) {
    throw new Error(`Updated ${relativeSitePath(filePath)} would not parse: ${doc.errors[0].message}`);
  }
  parseYaml(text);
}

function writeAtomic(filePath, text) {
  verifyYaml(text, filePath);
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tempPath, text, 'utf8');
  renameSync(tempPath, filePath);
}

function compactDiff(filePath, before, after, context = 4) {
  if (before === after) return 'No changes.';

  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix + prefix < a.length
    && suffix + prefix < b.length
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const startA = Math.max(0, prefix - context);
  const startB = Math.max(0, prefix - context);
  const endA = Math.min(a.length, a.length - suffix + context);
  const endB = Math.min(b.length, b.length - suffix + context);
  const removed = a.slice(startA, endA);
  const added = b.slice(startB, endB);
  const sharedPrefix = Math.max(0, prefix - startA);
  const sharedSuffix = Math.max(0, endA - Math.max(startA, a.length - suffix));
  const changedRemoved = removed.slice(sharedPrefix, removed.length - sharedSuffix);
  const changedAdded = added.slice(sharedPrefix, added.length - sharedSuffix);
  const leadingContext = removed.slice(0, sharedPrefix);
  const trailingContext = removed.slice(removed.length - sharedSuffix);

  const rel = relativeSitePath(filePath);
  return [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -${startA + 1},${Math.max(1, endA - startA)} +${startB + 1},${Math.max(1, endB - startB)} @@`,
    ...leadingContext.map((line) => ` ${line}`),
    ...changedRemoved.map((line) => `-${line}`),
    ...changedAdded.map((line) => `+${line}`),
    ...trailingContext.map((line) => ` ${line}`),
  ].join('\n');
}

export function createEditorChange({ section, id, patch = {}, removeOverride = false }) {
  const state = loadEditorState();
  const validation = validateEditorChange(section, id, patch, state, { removeOverride });
  if (!validation.ok) return { ok: false, errors: validation.errors, patch: validation.patch };

  const filePath = fileForSection(section);
  const { text, updatedText } = changedTextForRequest(
    section,
    id,
    validation.patch,
    state,
    validation.removeOverride,
  );
  verifyYaml(updatedText, filePath);

  return {
    ok: true,
    errors: [],
    section,
    id,
    filePath,
    relativePath: relativeSitePath(filePath),
    patch: validation.patch,
    removeOverride: validation.removeOverride,
    changed: text !== updatedText,
    before: text,
    after: updatedText,
    diff: compactDiff(filePath, text, updatedText),
  };
}

export function createEditorChanges({ changes = [] }) {
  const state = loadEditorState();
  const originals = new Map();
  const texts = new Map();
  const results = [];
  const errors = [];

  for (const rawChange of changes || []) {
    const section = rawChange?.section;
    const id = rawChange?.id;
    const patch = rawChange?.patch || {};
    const removeOverride = Boolean(rawChange?.removeOverride);
    const validation = validateEditorChange(section, id, patch, state, { removeOverride });
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${section || 'unknown'}/${id || 'unknown'}: ${error}`));
      results.push({ ok: false, section, id, errors: validation.errors, patch: validation.patch });
      continue;
    }

    let filePath;
    try {
      filePath = fileForSection(section);
      if (!texts.has(filePath)) {
        const text = readFileSync(filePath, 'utf8');
        originals.set(filePath, text);
        texts.set(filePath, text);
      }

      const source = sourceFromText(texts.get(filePath));
      const { updatedText } = changedTextForRequestSource(
        source,
        section,
        id,
        validation.patch,
        state,
        validation.removeOverride,
      );
      verifyYaml(updatedText, filePath);
      const changed = texts.get(filePath) !== updatedText;
      if (changed) texts.set(filePath, updatedText);
      results.push({
        ok: true,
        section,
        id,
        changed,
        relativePath: relativeSitePath(filePath),
        patch: validation.patch,
        removeOverride: validation.removeOverride,
      });
    } catch (error) {
      errors.push(`${section || 'unknown'}/${id || 'unknown'}: ${error.message}`);
      results.push({ ok: false, section, id, errors: [error.message], patch: validation.patch });
    }
  }

  const changedFiles = [...texts.entries()]
    .filter(([filePath, text]) => originals.get(filePath) !== text)
    .map(([filePath, text]) => ({
      filePath,
      relativePath: relativeSitePath(filePath),
      before: originals.get(filePath),
      after: text,
      diff: compactDiff(filePath, originals.get(filePath), text),
    }));

  return {
    ok: errors.length === 0,
    errors,
    results,
    changed: changedFiles.length > 0,
    changedFiles,
    diff: changedFiles.length ? changedFiles.map((file) => file.diff).join('\n\n') : 'No changes.',
  };
}

export function saveEditorChange(changeRequest) {
  const change = createEditorChange(changeRequest);
  if (!change.ok) return change;
  if (!change.changed) return { ...change, saved: false, backupPath: '' };

  const backupPath = createBackup(change.filePath);
  writeAtomic(change.filePath, change.after);
  return {
    ...change,
    before: undefined,
    after: undefined,
    saved: true,
    backupPath,
  };
}

export function saveEditorChanges(changeRequest) {
  const change = createEditorChanges(changeRequest);
  if (!change.ok) return change;
  if (!change.changed) return { ...change, saved: false, backupPaths: [] };

  const backupPaths = [];
  for (const file of change.changedFiles) {
    backupPaths.push(createBackup(file.filePath));
    writeAtomic(file.filePath, file.after);
  }

  return {
    ...change,
    changedFiles: change.changedFiles.map((file) => ({
      relativePath: file.relativePath,
      diff: file.diff,
    })),
    saved: true,
    backupPaths,
  };
}
