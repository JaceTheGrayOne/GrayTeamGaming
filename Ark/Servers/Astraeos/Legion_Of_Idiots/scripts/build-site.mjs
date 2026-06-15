// Build index.html from data/mod-reference.yaml (+ optional fetched cache).
//
// Fully static output: rows are server-rendered, and a small vanilla-JS block
// handles client-side search + category filtering by toggling row visibility.
// No runtime network calls, no framework.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseYaml } from './lib/mini-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const YAML_PATH = join(root, 'data', 'mod-reference.yaml');
const CACHE_PATH = join(root, 'data', 'fetched-metadata.json');
const THUMB_DIR = join(root, 'assets', 'mod-thumbnails');
const OUT_PATH = join(root, 'index.html');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

function main() {
  const doc = parseYaml(readFileSync(YAML_PATH, 'utf8'));
  const site = doc.site || {};
  const categories = doc.categories || [];
  const cache = loadCache();
  const mods = doc.mods || [];

  const catByLabel = new Map(categories.map((c) => [c.label, c]));
  const accent = site.accentColor || '#00e5ff';
  const logoImage = site.logoImage || '';
  const fontStylesheet = site.fontStylesheet || '';
  const categoryColor = (label) => catByLabel.get(label)?.color || accent;
  const categoryTextColor = (label) => catByLabel.get(label)?.textColor || categoryColor(label);

  // Build ordered category filter list. Honour site.categoryOrder first.
  const order = site.categoryOrder && site.categoryOrder.length
    ? site.categoryOrder
    : categories.map((c) => c.label);
  const orderedCats = [];
  for (const label of order) {
    const c = catByLabel.get(label);
    if (c) orderedCats.push(c);
  }
  for (const c of categories) if (!orderedCats.includes(c)) orderedCats.push(c);

  const resolveThumb = (m) => {
    if (!site.showThumbnails) return null;
    const onDisk = thumbOnDisk(m.curseId);
    if (onDisk) return onDisk;
    const cached = cache[m.curseId]?.thumbnail;
    if (cached) return cached;
    return null; // fall back to category icon
  };

  const reviewCount = mods.filter((m) => m.needsReview).length;

  const rows = mods.map((m) => {
    const cat = catByLabel.get(m.primaryCategory);
    const color = cat?.color || accent;
    const titleColor = categoryTextColor(m.primaryCategory);
    const icon = cat?.icon || 'assets/category-icons/default.svg';
    const thumb = resolveThumb(m);
    const allCats = [m.primaryCategory, ...(m.additionalCategories || [])].filter(Boolean);
    const tips = m.tips || [];
    const tags = m.tags || [];
    const link = m.curseforgeUrl || cache[m.curseId]?.websiteUrl || '';

    const searchText = [
      m.displayName, m.sourceName, m.primaryCategory,
      ...(m.additionalCategories || []), ...tags, m.description, ...tips,
    ].filter(Boolean).join(' ').toLowerCase();

    const pills = [
      `<span class="category-badge" style="--c:${esc(color)}">${esc(m.primaryCategory)}</span>`,
      ...(site.showAdditionalCategoryPills
        ? (m.additionalCategories || []).map((c) => `<span class="category-badge" style="--c:${esc(categoryColor(c))}">${esc(c)}</span>`)
        : []),
      ...(m.needsReview ? ['<span class="category-badge pill-review">Needs review</span>'] : []),
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

  const filterButtons = [
    `<button class="filter category-badge active" data-filter="all" style="--c:${esc(accent)}">All</button>`,
    ...orderedCats.map((c) =>
      `<button class="filter category-badge" data-filter="${esc(c.label.toLowerCase())}" style="--c:${esc(c.color)}">${esc(c.label)}</button>`),
  ].join('\n        ');

  const bg = site.backgroundImage
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

  const footer = site.footerText
    ? esc(site.footerText)
    : `${esc(site.serverName || '')} &middot; ${mods.length} mods${reviewCount ? ` &middot; ${reviewCount} flagged for review` : ''}`;

  const logoHtml = logoImage
    ? `<div class="brand-mark"><img src="${esc(logoImage)}" alt="ARK logo"></div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.pageTitle || 'ARK Mods')}${site.serverName ? ` — ${esc(site.serverName)}` : ''}</title>
<meta name="description" content="${esc(site.introText || '')}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2305141f'/%3E%3Cpath d='M32 8 54 56H44l-4-9H24l-4 9H10L32 8Zm0 17-6 14h12L32 25Z' fill='%2300e5ff'/%3E%3C/svg%3E">
${fontStylesheet ? `<link rel="stylesheet" href="${esc(fontStylesheet)}">` : ''}
<style>
  :root {
    --accent: ${esc(accent)};
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
    --page-overlay-opacity: ${site.backgroundImage ? '.58' : '.92'};
  }
  * { box-sizing: border-box; }
  html { height: 100%; overflow: hidden; }
  body {
    min-height: 100vh; min-height: 100dvh;
    margin: 0; padding: 12px 18px;
    font: 15px/1.5 var(--font-body);
    color: var(--text); background: var(--bg);
    overflow: hidden;
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
  .wrap {
    width: min(100%, 1440px); height: calc(100vh - 24px); height: calc(100dvh - 24px);
    margin: 0 auto; min-height: 0;
  }
  .panel {
    height: 100%; min-height: 0; display: flex; flex-direction: column;
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
  .hero h1 .accent { color: var(--accent); }
  .hero .subtitle { margin: 6px 0 0; color: var(--accent); font-family: var(--font-body); font-size: 21px; font-weight: 700; letter-spacing: 0; }
  .hero .intro { margin: 2px 0 0; color: #e1e7ec; max-width: 920px; font-size: 16px; overflow-wrap: anywhere; }
  .controls {
    display: flex; align-items: flex-start; gap: 18px;
    padding: 10px 14px 12px; border-bottom: 1px solid rgba(0, 238, 255, .46);
    background: linear-gradient(180deg, rgba(0,4,9,.2), rgba(0,8,14,.38));
  }
  .searchbox { position: relative; flex: 0 0 360px; width: 360px; max-width: 100%; }
  .searchbox svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); }
  #search {
    width: 100%; padding: 12px 14px 12px 42px;
    background: rgba(2,10,17,.78); border: 1px solid rgba(83, 137, 165, .58);
    border-radius: 8px; color: var(--text); font-size: 15px;
    box-shadow: inset 0 0 16px rgba(0,0,0,.58), 0 0 0 1px rgba(0,0,0,.26);
  }
  #search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,229,255,.15); }
  .filters {
    display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 10px 12px; align-items: center;
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
  .meta-line { flex: 0 0 auto; padding: 9px 14px 0; color: var(--muted); font-size: 13px; }
  .list {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 8px 12px 10px; scrollbar-color: rgba(0,229,255,.72) rgba(1,9,14,.66); scrollbar-width: thin;
  }
  .list::-webkit-scrollbar { width: 12px; }
  .list::-webkit-scrollbar-track { background: rgba(1,9,14,.66); border-left: 1px solid rgba(0,229,255,.14); }
  .list::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(0,229,255,.72), rgba(24,95,115,.72));
    border: 3px solid rgba(1,9,14,.66); border-radius: 999px;
  }
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
  footer { flex: 0 0 auto; padding: 12px 30px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; text-align: center; }
  @media (max-width: 1120px) {
    body { padding: 10px 8px; }
    .wrap { height: calc(100vh - 20px); height: calc(100dvh - 20px); }
    .panel { border-radius: 14px; }
    .controls { flex-direction: column; align-items: stretch; gap: 10px; }
    .searchbox { flex: 0 0 auto; width: 100%; }
    .filters { width: 100%; }
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
  }
  @media (max-width: 760px) {
    body { padding: 0; }
    .wrap { width: 100%; height: 100vh; height: 100dvh; }
    .panel { border-left: 0; border-right: 0; border-radius: 0; }
    header.hero { padding: 14px 14px 12px; }
    .hero-brand { align-items: flex-start; gap: 14px; min-height: 0; }
    .brand-mark { width: 92px; height: 82px; }
    .brand-mark img { width: 108px; max-height: 78px; }
    .hero h1 { font-size: clamp(30px, 7vw, 40px); }
    .hero .subtitle { font-size: 18px; }
    .hero .intro { font-size: 14px; }
    .controls { padding: 10px 12px; }
    .list { padding: 8px 8px 10px; }
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
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <header class="hero">
        <div class="hero-brand">
          ${logoHtml}
          <div class="hero-copy${logoImage ? '' : ' no-logo'}">
            <h1>${esc(site.pageTitle || 'ARK Ascended Mods')}</h1>
            <p class="subtitle">${esc(site.subtitle || '')}</p>
            <p class="intro">${esc(site.introText || '')}</p>
          </div>
        </div>
      </header>
      <div class="controls">
        <div class="searchbox">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="search" type="search" placeholder="Search mods, categories, items, tags…" autocomplete="off">
        </div>
        <div class="filters">
        ${filterButtons}
        </div>
      </div>
      <div class="meta-line"><span id="count">${mods.length}</span> mods shown</div>
      <div class="list" id="list">
${rows}
        <div class="empty" id="empty">No mods match your search.</div>
      </div>
      <footer>${footer}</footer>
    </div>
  </div>
<script>
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
</script>
</body>
</html>
`;

  writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`Built ${OUT_PATH}`);
  console.log(`  ${mods.length} mods, ${categories.length} categories, ${reviewCount} flagged needsReview`);
}

main();
