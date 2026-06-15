# ARK Ascended Mod Quick Reference Site

A self-contained, static HTML quick-reference page for the **Lost Colony**
ARK: Survival Ascended mod list. The generated `index.html` opens directly in a
browser and works with no server, no build step at view time, and no runtime
network calls.

```
mod-reference-site/
  index.html                 <- BUILD OUTPUT (do not hand-edit)
  package.json
  data/
    mod-reference.yaml        <- SOURCE OF TRUTH (edit this)
    fetched-metadata.json     <- cache from `npm run fetch` (optional)
  scripts/
    seed-from-csv.mjs         <- bootstrap YAML from the CSV
    fetch-curseforge-metadata.mjs
    build-site.mjs            <- renders index.html from the YAML
    lib/mini-yaml.mjs         <- tiny YAML reader/writer (no dependencies)
  assets/
    mod-thumbnails/           <- <CurseID>.<ext> logos (from fetch)
    category-icons/           <- per-category fallback icons (SVG)
    backgrounds/              <- optional page background image
```

Plain Node.js only — no frameworks, no npm dependencies. Requires Node 18+
(tested on Node 22).

## Quick start

```bash
cd docs/servers/mod-reference-site
npm run build          # regenerate index.html from data/mod-reference.yaml
# then open index.html in a browser
```

## Editing the page

Everything the page shows is controlled by **`data/mod-reference.yaml`**.

- **Site text / theme** — under `site:` you can change `serverName`,
  `pageTitle`, `subtitle`, `introText`, `accentColor`, `backgroundImage`,
  `footerText`, `showThumbnails`, `showAdditionalCategoryPills`, and
  `categoryOrder` (controls the order of the filter buttons).
- **Categories** — under `categories:` each entry has `id`, `label`, `color`
  and `icon`. A mod's `primaryCategory` / `additionalCategories` reference a
  category by its **label**.
- **Mods** — under `mods:` each entry has:
  - `curseId`, `sourceName`, `displayName`, `curseforgeUrl`, `thumbnail`
  - `primaryCategory` — exactly one; sets the pill color and fallback icon
  - `additionalCategories` — extra categories for search/filter (mod still
    appears only once)
  - `description` — *what it does* (left column)
  - `tips` — *why it matters* / practical notes (right column)
  - `tags` — extra keywords for search
  - `needsReview: true` — flags entries whose purpose wasn't confirmed; they get
    a "Needs review" pill and conservative placeholder text. **Verify these on
    CurseForge and update the text, then set `needsReview: false`.**

After any edit, run `npm run build` and reload `index.html`.

### YAML formatting note

A small built-in YAML reader (`scripts/lib/mini-yaml.mjs`) is used instead of an
external dependency. Keep to the file's existing style: 2-space indentation, one
value per line, and quote any list item (tip/tag/category) that begins with
`word:` (e.g. `- "Note: ..."`). Mod names containing `:` are already quoted.

## Fetching CurseForge metadata (optional)

The page does **not** require CurseForge at view time. Fetching only enriches
the local cache and downloads mod logo thumbnails.

```bash
# With an official CurseForge API key (recommended):
export CURSEFORGE_API_KEY=xxxxxxxx
# PowerShell: $env:CURSEFORGE_API_KEY = 'paste-key-here'
npm run fetch                          # caches name/summary/logo/url per CurseID
npm run build

# Or in one step:
npm run rebuild                        # fetch + build
```

PowerShell note: use **single quotes** when setting `CURSEFORGE_API_KEY`.
CurseForge keys can contain `$`, and double quotes cause PowerShell to expand
parts of the key as variables.

- **With a key:** queries `https://api.curseforge.com/v1/mods/<CurseID>`, caches
  results in `data/fetched-metadata.json`, and downloads each logo to
  `assets/mod-thumbnails/<CurseID>.<ext>`. The build then prefers those
  thumbnails automatically.
- **Without a key:** runs in best-effort mode — it records the public CurseForge
  URLs from the YAML into the cache and skips API calls. No thumbnails are
  downloaded, so the build uses the per-category fallback icons.

Fetching never fails the pipeline; a network/API error just leaves the cache as-is.

## Thumbnails & fallback icons

- If `assets/mod-thumbnails/<CurseID>.<ext>` exists, the build uses it.
- Otherwise it uses the cached `logoUrl`-derived thumbnail if present.
- Otherwise it falls back to the mod's primary-category icon
  (`assets/category-icons/*.svg`), tinted with the category color.

Set `site.showThumbnails: false` to force category icons everywhere.

## Re-seeding from the CSV

If the source list (`../Current_Mod_List_Astraeos_Josh.md.csv`) gains new mods:

```bash
npm run seed
```

To protect curated content, if `data/mod-reference.yaml` already exists the seed
is written to `data/mod-reference.seed.yaml` instead — diff it and copy any new
mod blocks into the curated file by hand.

## How search & filtering work

`index.html` ships pre-rendered mod rows plus a small vanilla-JS block that
toggles row visibility — fully client-side, no backend.

- **Search** matches display name, source name, primary + additional
  categories, tags, description, and tips.
- **Category buttons** filter by primary *or* additional category.
- **All** resets the filter (search box clears with the field's native control).

## Deploying to Vercel

The site is pure static files; no framework or build server is needed.

**Option A — point Vercel at this folder (recommended):**

1. In the Vercel project settings set the **Root Directory** to
   `docs/servers/mod-reference-site`.
2. **Framework Preset:** Other. **Build Command:** `npm run build`
   (or leave empty and commit the generated `index.html`).
   **Output Directory:** `.` (the folder itself — `index.html` is at its root).
3. Deploy. `index.html` and `assets/` are served as-is.

**Option B — drag & drop / CLI:**

```bash
npm run build
npx vercel --prod        # from inside docs/servers/mod-reference-site
```

Because there are no runtime API calls, no environment variables are required on
Vercel. `CURSEFORGE_API_KEY` is only ever used locally during `npm run fetch`.
