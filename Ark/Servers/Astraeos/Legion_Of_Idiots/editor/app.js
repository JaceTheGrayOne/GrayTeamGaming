(function () {
  var state = null;
  var currentSection = 'mods';
  var selectedId = '';
  var initialDraft = {};
  var dirty = false;
  var diffTimer = null;
  var activeTab = 'preview';
  var pendingChanges = {};

  var fields = {
    mods: [
      { name: 'displayName', label: 'Display name', type: 'text' },
      { name: 'sourceName', label: 'Source name', type: 'text' },
      { name: 'curseforgeUrl', label: 'CurseForge URL', type: 'text', wide: true },
      { name: 'thumbnail', label: 'Thumbnail', type: 'text', wide: true },
      { name: 'primaryCategory', label: 'Primary category', type: 'select', options: 'modCategories' },
      { name: 'additionalCategories', label: 'Additional categories', type: 'lines', wide: true },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
      { name: 'tips', label: 'Tips', type: 'lines', wide: true },
      { name: 'tags', label: 'Tags', type: 'lines', wide: true },
    ],
    items: [
      { name: 'displayName', label: 'Display name', type: 'text' },
      { name: 'category', label: 'Category', type: 'select', options: 'itemCategories' },
      { name: 'sourceLabel', label: 'Source label', type: 'text' },
      { name: 'publishStatus', label: 'Publication status', type: 'select', options: 'itemPublishStatuses', emptyLabel: 'Default' },
      { name: 'publishReason', label: 'Publication reason', type: 'text', wide: true },
      { name: 'wikiUrl', label: 'Wiki URL', type: 'text', wide: true },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
      { name: 'craftingStation', label: 'Crafting station', type: 'text', wide: true },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    creatures: [
      { name: 'id', label: 'ID', type: 'text' },
      { name: 'displayName', label: 'Display name', type: 'text' },
      { name: 'sourceMod', label: 'Source mod', type: 'text' },
      { name: 'category', label: 'Category', type: 'select', options: 'creatureCategories' },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
      { name: 'tamingMethod', label: 'Taming method', type: 'text', wide: true },
      { name: 'spawnContext', label: 'Spawn context', type: 'text', wide: true },
      { name: 'utility', label: 'Utility', type: 'textarea', wide: true },
      { name: 'saddleOrUnlock', label: 'Saddle / unlock', type: 'text', wide: true },
      { name: 'tips', label: 'Tips', type: 'lines', wide: true },
      { name: 'tags', label: 'Tags', type: 'lines', wide: true },
      { name: 'fakeData', label: 'Fake data', type: 'checkbox' },
    ],
    site: [
      { name: 'serverName', label: 'Server name', type: 'text' },
      { name: 'pageTitle', label: 'Page title', type: 'text' },
      { name: 'subtitle', label: 'Subtitle', type: 'text' },
      { name: 'introText', label: 'Intro text', type: 'textarea', wide: true },
      { name: 'accentColor', label: 'Accent color', type: 'text' },
      { name: 'logoImage', label: 'Logo image', type: 'text', wide: true },
      { name: 'fontStylesheet', label: 'Font stylesheet', type: 'text', wide: true },
      { name: 'backgroundImage', label: 'Background image', type: 'text', wide: true },
      { name: 'footerText', label: 'Footer text', type: 'text', wide: true },
      { name: 'categoryOrder', label: 'Category order', type: 'lines', wide: true },
      { name: 'showThumbnails', label: 'Show thumbnails', type: 'checkbox' },
      { name: 'showAdditionalCategoryPills', label: 'Show additional category pills', type: 'checkbox' },
    ],
  };

  var els = {
    statusLine: document.getElementById('status-line'),
    refreshBtn: document.getElementById('refresh-btn'),
    saveBtn: document.getElementById('save-btn'),
    buildBtn: document.getElementById('build-btn'),
    openBtn: document.getElementById('open-btn'),
    hiddenItemsControl: document.getElementById('hidden-items-control'),
    showHiddenItems: document.getElementById('show-hidden-items'),
    search: document.getElementById('search'),
    entryCount: document.getElementById('entry-count'),
    entryList: document.getElementById('entry-list'),
    sectionLabel: document.getElementById('section-label'),
    formTitle: document.getElementById('form-title'),
    formMeta: document.getElementById('form-meta'),
    dirtyPill: document.getElementById('dirty-pill'),
    messages: document.getElementById('messages'),
    form: document.getElementById('edit-form'),
    previewPanel: document.getElementById('preview-panel'),
    diffPanel: document.getElementById('diff-panel'),
    buildPanel: document.getElementById('build-panel'),
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function splitDelimited(value) {
    return String(value || '')
      .split(';')
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
  }

  function wikiUrlForTitle(title) {
    return 'https://ark.wiki.gg/wiki/' + encodeURIComponent(String(title || '').trim().replace(/\s+/g, '_'));
  }

  function nonLinkCraftingStation(value) {
    return /^(?:not listed|unknown|unavailable|none)$/i.test(String(value || '').trim());
  }

  function craftingStationLinksHtml(value) {
    var stations = splitDelimited(value);
    if (!stations.length) return esc(value);
    return '<span class="preview-crafting">' + stations.map(function (station, index) {
      var separator = index ? '<span class="preview-separator">; </span>' : '';
      if (nonLinkCraftingStation(station)) return separator + esc(station);
      return separator + '<a href="' + esc(wikiUrlForTitle(station)) + '" target="_blank" rel="noopener noreferrer">' + esc(station) + '</a>';
    }).join('') + '</span>';
  }

  function api(path, options) {
    return fetch(path, Object.assign({
      headers: { 'content-type': 'application/json' },
    }, options || {})).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || json.ok === false) {
          var err = new Error((json.errors || ['Request failed.']).join('\n'));
          err.payload = json;
          throw err;
        }
        return json;
      });
    });
  }

  function sectionEntries() {
    if (!state) return [];
    if (currentSection === 'mods') return state.mods.entries;
    if (currentSection === 'items') return state.items.entries;
    if (currentSection === 'creatures') return state.creatures.entries;
    return [state.site.entry];
  }

  function itemEntryVisible(entry) {
    if (currentSection !== 'items') return true;
    return Boolean(entry && (entry.isPublic || els.showHiddenItems.checked));
  }

  function visibleSectionEntries() {
    return sectionEntries().filter(itemEntryVisible);
  }

  function selectedEntry() {
    return sectionEntries().find(function (entry) { return entry.id === selectedId; }) || sectionEntries()[0] || null;
  }

  function fieldList() {
    return fields[currentSection] || [];
  }

  function draftFromEntry(entry) {
    var draft = {};
    fieldList().forEach(function (field) {
      var value = entry && Object.prototype.hasOwnProperty.call(entry, field.name) ? entry[field.name] : '';
      if (field.type === 'lines') draft[field.name] = Array.isArray(value) ? value.slice() : String(value || '').split(/\r?\n/).filter(Boolean);
      else if (field.type === 'checkbox') draft[field.name] = Boolean(value);
      else draft[field.name] = value == null ? '' : value;
    });
    return draft;
  }

  function sameDraft(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function pendingKey(section, id) {
    return section + '\u0001' + id;
  }

  function pendingFor(section, id) {
    return pendingChanges[pendingKey(section, id)] || null;
  }

  function pendingList() {
    return Object.keys(pendingChanges).map(function (key) { return pendingChanges[key]; });
  }

  function pendingCount() {
    return pendingList().length;
  }

  function draftFromBaseline(entry) {
    var draft = {};
    fieldList().forEach(function (field) {
      var source = currentSection === 'items' && entry && entry.baseline ? entry.baseline : entry;
      var value = source && Object.prototype.hasOwnProperty.call(source, field.name) ? source[field.name] : '';
      if (field.type === 'lines') draft[field.name] = Array.isArray(value) ? value.slice() : String(value || '').split(/\r?\n/).filter(Boolean);
      else if (field.type === 'checkbox') draft[field.name] = Boolean(value);
      else draft[field.name] = value == null ? '' : value;
    });
    return draft;
  }

  function draftForEntry(entry) {
    var base = draftFromEntry(entry);
    var pending = entry ? pendingFor(currentSection, entry.id) : null;
    if (!pending) return base;
    if (pending.removeOverride) return draftFromBaseline(entry);
    return Object.assign({}, base, pending.patch || {});
  }

  function patchFromDraft(draft, base) {
    var patch = {};
    fieldList().forEach(function (field) {
      if (!sameDraft(draft[field.name], base[field.name])) patch[field.name] = draft[field.name];
    });
    return patch;
  }

  function optionsFor(field, value) {
    var values = (state.options && state.options[field.options]) || [];
    if (value && values.indexOf(value) === -1) values = values.concat([value]);
    return values;
  }

  function linesValue(value) {
    return Array.isArray(value) ? value.join('\n') : String(value || '');
  }

  function collectDraft() {
    var draft = {};
    fieldList().forEach(function (field) {
      var control = els.form.querySelector('[data-field="' + field.name + '"]');
      if (!control) return;
      if (field.type === 'checkbox') draft[field.name] = control.checked;
      else if (field.type === 'lines') {
        draft[field.name] = control.value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
      } else {
        draft[field.name] = control.value.trim();
      }
    });
    return draft;
  }

  function changedPatch() {
    return patchFromDraft(collectDraft(), initialDraft);
  }

  function storeCurrentDraft() {
    var entry = selectedEntry();
    if (!entry || !els.form.children.length) return;

    var key = pendingKey(currentSection, selectedId);
    var patch = changedPatch();
    if (Object.keys(patch).length) {
      pendingChanges[key] = {
        section: currentSection,
        id: selectedId,
        patch: patch,
      };
    } else if (pendingChanges[key] && !pendingChanges[key].removeOverride) {
      delete pendingChanges[key];
    }
    setDirty();
  }

  function setDirty() {
    var count = pendingCount();
    dirty = count > 0;
    els.saveBtn.disabled = !dirty;
    els.saveBtn.textContent = count ? 'Save ' + count + ' Change' + (count === 1 ? '' : 's') : 'Save YAML';
    els.dirtyPill.textContent = count ? count + ' pending' : 'Saved';
    els.dirtyPill.classList.toggle('dirty', dirty);
  }

  function showMessage(type, text) {
    if (!text) {
      els.messages.innerHTML = '';
      return;
    }
    els.messages.innerHTML = '<div class="message ' + esc(type) + '">' + esc(text) + '</div>';
  }

  function sectionLabel() {
    if (currentSection === 'mods') return 'Mods';
    if (currentSection === 'items') return 'Items';
    if (currentSection === 'creatures') return 'Creatures';
    return 'Site Settings';
  }

  function renderStatus() {
    if (!state) return;
    var git = state.git || {};
    var gitText = git.available
      ? (git.clean ? 'Git clean' : 'Uncommitted changes: ' + git.lines.length)
      : 'Git status unavailable';
    els.statusLine.textContent = 'Local only - commits are manual - ' + gitText;
  }

  function entryBadges(entry) {
    if (currentSection === 'mods') {
      return [
        '<span class="badge" style="--c:' + esc(categoryColor(state.mods.categories, entry.primaryCategory)) + '">' + esc(entry.primaryCategory || 'Uncategorized') + '</span>',
        pendingFor(currentSection, entry.id) ? '<span class="badge pending">Pending</span>' : '',
      ].join('');
    }
    if (currentSection === 'items') {
      return [
        '<span class="badge">' + esc(entry.sourceLabel || 'Unknown') + '</span>',
        '<span class="badge" style="--c:' + esc(categoryColor(state.items.categories, entry.category)) + '">' + esc(entry.category || 'Unknown') + '</span>',
        publicationBadge(entry),
        pendingFor(currentSection, entry.id) ? '<span class="badge pending">Pending</span>' : '',
        entry.hasOverride ? '<span class="badge warn">Override</span>' : '',
      ].join('');
    }
    if (currentSection === 'creatures') {
      return [
        '<span class="badge" style="--c:' + esc(categoryColor(state.creatures.categories, entry.category)) + '">' + esc(entry.category || 'Uncategorized') + '</span>',
        pendingFor(currentSection, entry.id) ? '<span class="badge pending">Pending</span>' : '',
        entry.fakeData ? '<span class="badge warn">Fake data</span>' : '',
      ].join('');
    }
    return '<span class="badge">Config</span>';
  }

  function publicationBadge(entry) {
    var status = entry.effectivePublishStatus || entry.publishStatus || 'publish';
    if (status === 'publish') return '<span class="badge good">Public</span>';
    if (status === 'review-only') return '<span class="badge warn">Review only</span>';
    return '<span class="badge danger">Hidden</span>';
  }

  function categoryColor(categories, label) {
    var match = (categories || []).find(function (category) { return category.label === label; });
    return (match && match.color) || '#00e5ff';
  }

  function renderEntries() {
    var q = els.search.value.trim().toLowerCase();
    var entries = sectionEntries();
    var visible = entries.filter(itemEntryVisible);
    var filtered = visible.filter(function (entry) {
      var text = [
        entry.searchText,
        entry.displayName,
        entry.sourceName,
        entry.sourceLabel,
        entry.category,
        entry.primaryCategory,
        entry.publishStatus,
        entry.publishReason,
        entry.effectivePublishStatus,
        entry.effectivePublishReason,
        entry.id,
        entry.className,
        entry.itemKey,
      ].filter(Boolean).join(' ').toLowerCase();
      return !q || text.indexOf(q) !== -1;
    });

    var suffix = '';
    if (currentSection === 'items' && state.items.stats) {
      suffix = ' - ' + state.items.stats.publicRows + ' public, ' + state.items.stats.hiddenRows + ' hidden';
    }
    els.entryCount.textContent = filtered.length + ' of ' + visible.length + ' shown' + suffix;
    if (!filtered.length) {
      els.entryList.innerHTML = '<div class="empty-state">No entries match.</div>';
      return;
    }

    els.entryList.innerHTML = filtered.map(function (entry) {
      var title = entry.displayName || entry.pageTitle || entry.serverName || entry.id || 'Untitled';
      var subtitle = currentSection === 'items'
        ? (entry.className || entry.itemKey || '')
        : currentSection === 'mods'
          ? ('Curse ID ' + entry.curseId)
          : currentSection === 'creatures'
            ? entry.sourceMod || entry.id
            : 'data/mod-reference.yaml';
      return [
        '<button class="entry-row' + (entry.id === selectedId ? ' active' : '') + '" type="button" data-id="' + esc(entry.id) + '">',
        '<span class="entry-title">' + esc(title) + '</span>',
        '<span class="entry-subtitle">' + esc(subtitle) + '</span>',
        '<span class="badge-line">' + entryBadges(entry) + '</span>',
        '</button>',
      ].join('');
    }).join('');
  }

  function renderForm() {
    var entry = selectedEntry();
    if (!entry) {
      els.formTitle.textContent = 'Select an entry';
      els.formMeta.textContent = '';
      els.form.innerHTML = '';
      els.previewPanel.innerHTML = '<div class="empty-state">No entry selected.</div>';
      return;
    }

    initialDraft = draftFromEntry(entry);
    var currentDraft = draftForEntry(entry);
    setDirty();
    els.sectionLabel.textContent = sectionLabel();
    els.formTitle.textContent = entry.displayName || entry.pageTitle || entry.serverName || 'Site Settings';
    els.formMeta.textContent = formMeta(entry);
    els.form.innerHTML = fieldList().map(function (field) {
      return renderField(field, currentDraft[field.name], entry);
    }).join('') + renderExtraActions(entry);
    bindFormEvents();
    renderPreview();
    updateDiff();
  }

  function formMeta(entry) {
    if (currentSection === 'mods') return 'data/mod-reference.yaml - curseId ' + entry.curseId;
    if (currentSection === 'items') {
      return 'data/item-reference.yaml - manualOverrides.' + (entry.overrideKey || entry.suggestedOverrideKey);
    }
    if (currentSection === 'creatures') return 'data/creature-reference.yaml - ' + entry.id;
    return 'data/mod-reference.yaml - site';
  }

  function renderField(field, value, entry) {
    var wide = field.wide || field.type === 'textarea' || field.type === 'lines';
    var classes = 'field' + (wide ? ' wide' : '') + (field.type === 'checkbox' ? ' checkbox' : '');
    var hint = currentSection === 'items' && entry.baseline && Object.prototype.hasOwnProperty.call(entry.baseline, field.name)
      ? '<span class="field-hint">Baseline: ' + esc(entry.baseline[field.name]) + '</span>'
      : '';

    if (field.type === 'checkbox') {
      return '<label class="' + classes + '"><input data-field="' + esc(field.name) + '" type="checkbox"' + (value ? ' checked' : '') + '><span>' + esc(field.label) + '</span></label>';
    }

    if (field.type === 'select') {
      var options = optionsFor(field, value).map(function (option) {
        var label = option === '' && field.emptyLabel ? field.emptyLabel : option;
        return '<option value="' + esc(option) + '"' + (option === value ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      return '<label class="' + classes + '"><span class="field-label">' + esc(field.label) + '</span><select data-field="' + esc(field.name) + '">' + options + '</select>' + hint + '</label>';
    }

    if (field.type === 'textarea' || field.type === 'lines') {
      return '<label class="' + classes + '"><span class="field-label">' + esc(field.label) + '</span><textarea data-field="' + esc(field.name) + '">' + esc(field.type === 'lines' ? linesValue(value) : value) + '</textarea>' + hint + '</label>';
    }

    return '<label class="' + classes + '"><span class="field-label">' + esc(field.label) + '</span><input data-field="' + esc(field.name) + '" type="text" value="' + esc(value) + '">' + hint + '</label>';
  }

  function renderExtraActions(entry) {
    if (currentSection !== 'items') return '';
    var pending = pendingFor(currentSection, entry.id);
    var disabled = entry.hasOverride && !(pending && pending.removeOverride) ? '' : ' disabled';
    var label = pending && pending.removeOverride ? 'Override removal queued' : 'Queue override removal';
    return '<div class="field wide"><button id="remove-override-btn" class="danger-action" type="button"' + disabled + '>' + esc(label) + '</button></div>';
  }

  function bindFormEvents() {
    els.form.querySelectorAll('[data-field]').forEach(function (control) {
      control.addEventListener('input', onFormInput);
      control.addEventListener('change', onFormInput);
    });
    var remove = document.getElementById('remove-override-btn');
    if (remove) remove.addEventListener('click', removeOverride);
  }

  function onFormInput() {
    storeCurrentDraft();
    renderPreview();
    scheduleDiff();
  }

  function bulkPayload() {
    storeCurrentDraft();
    return { changes: pendingList() };
  }

  function scheduleDiff() {
    window.clearTimeout(diffTimer);
    diffTimer = window.setTimeout(updateDiff, 250);
  }

  function updateDiff() {
    if (!selectedEntry()) return;
    var changes = pendingList();
    if (!changes.length) {
      els.diffPanel.textContent = 'No pending changes.';
      showMessage('', '');
      return;
    }
    api('/api/editor/diff-bulk', {
      method: 'POST',
      body: JSON.stringify({ changes: changes }),
    }).then(function (json) {
      els.diffPanel.textContent = json.diff || 'No changes.';
      showMessage('', '');
    }).catch(function (error) {
      els.diffPanel.textContent = '';
      showMessage('error', error.message);
    });
  }

  function renderPreview() {
    var entry = selectedEntry();
    if (!entry) return;
    var draft = els.form.children.length ? collectDraft() : initialDraft;
    if (currentSection === 'mods') {
      els.previewPanel.innerHTML = previewCard(
        draft.displayName,
        [
          badge(draft.primaryCategory, categoryColor(state.mods.categories, draft.primaryCategory)),
        ],
        draft.description,
        [
          ['Source', draft.sourceName],
          ['Tips', linesValue(draft.tips)],
          ['Tags', linesValue(draft.tags)],
        ]
      );
      return;
    }
    if (currentSection === 'items') {
      els.previewPanel.innerHTML = previewCard(
        draft.displayName,
        [
          badge(draft.sourceLabel || entry.sourceLabel, '#00e5ff'),
          badge(draft.category, categoryColor(state.items.categories, draft.category)),
          badge(publicationLabel(draft.publishStatus || entry.effectivePublishStatus), publicationColor(draft.publishStatus || entry.effectivePublishStatus)),
          entry.hasOverride ? badge('Override', '#ffd166') : '',
        ],
        draft.description,
        [
          ['Crafting', { html: craftingStationLinksHtml(draft.craftingStation) }],
          ['Spawn', entry.spawnCode],
          ['Publication', (draft.publishStatus || 'default') + ' / ' + (draft.publishReason || entry.effectivePublishReason || '')],
          ['Effective', (entry.effectivePublishStatus || '') + ' / ' + (entry.effectivePublishReason || '')],
          ['Notes', draft.notes],
        ]
      );
      return;
    }
    if (currentSection === 'creatures') {
      els.previewPanel.innerHTML = previewCard(
        draft.displayName,
        [
          badge(draft.category, categoryColor(state.creatures.categories, draft.category)),
          draft.fakeData ? badge('Fake data', '#ffd166') : '',
        ],
        draft.description,
        [
          ['Source mod', draft.sourceMod],
          ['Taming', draft.tamingMethod],
          ['Spawn', draft.spawnContext],
          ['Utility', draft.utility],
        ]
      );
      return;
    }
    els.previewPanel.innerHTML = previewCard(
      draft.serverName || 'Site Settings',
      [badge('Config', '#00e5ff')],
      draft.introText,
      [
        ['Title', draft.pageTitle],
        ['Subtitle', draft.subtitle],
        ['Accent', draft.accentColor],
        ['Category order', linesValue(draft.categoryOrder)],
      ]
    );
  }

  function badge(text, color) {
    if (!text) return '';
    return '<span class="badge" style="--c:' + esc(color || '#00e5ff') + '">' + esc(text) + '</span>';
  }

  function publicationLabel(status) {
    if (status === 'review-only') return 'Review only';
    if (status === 'exclude') return 'Hidden';
    return 'Public';
  }

  function publicationColor(status) {
    if (status === 'review-only') return '#ffd166';
    if (status === 'exclude') return '#ff6b6b';
    return '#83e668';
  }

  function previewCard(title, badges, body, facts) {
    return [
      '<article class="preview-card">',
      '<div class="preview-title">' + esc(title || 'Untitled') + '</div>',
      '<div class="badge-line">' + badges.join('') + '</div>',
      '<p>' + esc(body || '') + '</p>',
      '<div class="preview-grid">',
      facts.map(function (fact) {
        var value = fact[1];
        var content = value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'html')
          ? value.html
          : esc(value || '');
        return '<div class="preview-fact"><b>' + esc(fact[0]) + '</b><span>' + content + '</span></div>';
      }).join(''),
      '</div>',
      '</article>',
    ].join('');
  }

  function selectEntry(id) {
    storeCurrentDraft();
    selectedId = id;
    renderEntries();
    renderForm();
  }

  function switchSection(section) {
    if (section === currentSection) return;
    storeCurrentDraft();
    currentSection = section;
    selectedId = '';
    els.search.value = '';
    document.querySelectorAll('.section-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.section === section);
    });
    updateSectionControls();
    var first = visibleSectionEntries()[0] || sectionEntries()[0];
    if (first) selectedId = first.id;
    renderEntries();
    renderForm();
  }

  function saveCurrent() {
    var payload = bulkPayload();
    if (!payload.changes.length) {
      showMessage('', '');
      setDirty();
      return;
    }
    els.saveBtn.disabled = true;
    api('/api/editor/save-bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then(function (json) {
      var currentDraft = collectDraft();
      state = json.state;
      if (currentSection === 'creatures') selectedId = currentDraft.id || selectedId;
      pendingChanges = {};
      showMessage('success', json.saved ? 'Saved ' + json.results.filter(function (result) { return result.changed; }).length + ' queued change(s).' : 'No YAML changes were needed.');
      renderStatus();
      renderEntries();
      renderForm();
      els.diffPanel.textContent = json.diff || 'No changes.';
    }).catch(function (error) {
      showMessage('error', error.message);
      els.saveBtn.disabled = false;
    });
  }

  function removeOverride() {
    var entry = selectedEntry();
    if (!entry || !entry.hasOverride) return;
    if (!window.confirm('Queue removal of this item override?')) return;
    pendingChanges[pendingKey(currentSection, selectedId)] = {
      section: currentSection,
      id: selectedId,
      patch: {},
      removeOverride: true,
    };
    showMessage('success', 'Override removal queued. Save pending changes to write it.');
    renderEntries();
    renderForm();
    scheduleDiff();
  }

  function previewBuild() {
    els.buildBtn.disabled = true;
    els.buildPanel.textContent = 'Running npm run build...';
    setUtilityTab('build');
    api('/api/editor/build', {
      method: 'POST',
      body: JSON.stringify({}),
    }).then(function (json) {
      els.buildPanel.textContent = (json.stdout || '') + (json.stderr ? '\n' + json.stderr : '') + '\nExit code: ' + json.code + '\nElapsed: ' + json.elapsedMs + 'ms';
    }).catch(function (error) {
      var payload = error.payload || {};
      els.buildPanel.textContent = (payload.stdout || '') + (payload.stderr ? '\n' + payload.stderr : '') + '\n' + error.message;
    }).finally(function () {
      els.buildBtn.disabled = false;
    });
  }

  function openPage() {
    api('/api/editor/open-page', {
      method: 'POST',
      body: JSON.stringify({ section: currentSection }),
    }).catch(function (error) {
      showMessage('error', error.message);
    });
  }

  function setUtilityTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.utility-tab').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
    els.previewPanel.hidden = tab !== 'preview';
    els.diffPanel.hidden = tab !== 'diff';
    els.buildPanel.hidden = tab !== 'build';
  }

  function refresh() {
    return api('/api/editor/state').then(function (json) {
      state = json.state;
      if (!selectedId) {
        updateSectionControls();
        var first = visibleSectionEntries()[0] || sectionEntries()[0];
        selectedId = first ? first.id : '';
      } else {
        updateSectionControls();
      }
      renderStatus();
      renderEntries();
      renderForm();
    }).catch(function (error) {
      showMessage('error', error.message);
    });
  }

  function bindGlobalEvents() {
    document.querySelectorAll('.section-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchSection(tab.dataset.section); });
    });
    document.querySelectorAll('.utility-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setUtilityTab(tab.dataset.tab); });
    });
    els.entryList.addEventListener('click', function (event) {
      var row = event.target.closest('.entry-row');
      if (row) selectEntry(row.dataset.id);
    });
    els.search.addEventListener('input', renderEntries);
    els.showHiddenItems.addEventListener('change', renderEntries);
    els.refreshBtn.addEventListener('click', function () {
      storeCurrentDraft();
      if (dirty && !window.confirm('Discard pending session changes and refresh from disk?')) return;
      pendingChanges = {};
      refresh();
    });
    els.saveBtn.addEventListener('click', saveCurrent);
    els.buildBtn.addEventListener('click', previewBuild);
    els.openBtn.addEventListener('click', openPage);
    window.addEventListener('beforeunload', function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function updateSectionControls() {
    els.hiddenItemsControl.hidden = currentSection !== 'items';
  }

  bindGlobalEvents();
  refresh();
})();
