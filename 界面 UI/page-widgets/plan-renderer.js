// Shared plan-page renderer (was app-plan.js). Used by every
// contents/docs/<app>.html page that loads three YAML files
// (structure/entries/dev) and presents them as a numbered, editable plan —
// the same plan model as site-map.html.
//
// Per-page wiring: each plan HTML sets `window.APP_PLAN_ID = "<app-id>"`
// before this script runs. APP_PLAN_ID drives:
//   - the yaml filenames fetched from ./plans/
//   - the project key looked up in built-pages.json for the stats line
//   - the download filenames produced by saveFile()
// Everything else (DOM ids, render flow, edit-mode behaviour) is identical
// across plan pages.

(function () {
  const APP_PLAN_ID = window.APP_PLAN_ID;
  if (!APP_PLAN_ID) {
    console.error('plan-renderer.js: window.APP_PLAN_ID must be set before loading this script');
    return;
  }
  // Ordering + numbering come from the shared plan-order engine (loaded as a
  // <script> just before this one), so the page and the launchpad plan manager
  // stay in lockstep. Hard dependency, like js-yaml.
  const PlanOrder = window.PlanOrder;
  if (!PlanOrder) {
    console.error('plan-renderer.js: window.PlanOrder must be loaded first (引擎 Engines/plan-order/plan-order.js)');
    return;
  }

  // Mnemonic section letters keyed by section id, in the SAME order as the
  // launchpad (dev section first, then structure) so the two index identically.
  function secLetterMap() {
    const taken = [];
    const m = { dev: PlanOrder.sectionLetter('App Development', taken) };
    ((structureData && structureData.sections) || []).forEach(sec => {
      m[sec.id] = PlanOrder.sectionLetter(sec.title || sec.id, taken);
    });
    return m;
  }

  // ---- Global state ----
  // Three sources, mirroring site-map.html's split:
  //   structureData — sections + pages tree. Either AUTO-EMITTED by build.py
  //     from the app's manifest.json (single source of truth) or hand-edited
  //     until the app has one. Not editable from this page.
  //   entriesData    — hand-edited tasks keyed by app page id.
  //   devData        — hand-edited non-page work groups, rendered first.
  let structureData = null;
  let entriesData = null;
  let devData = null;
  let manifestMeta = { project_lines: null, project_words: null, project_chars: null };

  // Roadmap version axis. The canonical order + the legend (token→title) come
  // from plans/plan-versions.json (build-emitted from site-roadmap.yaml — the
  // single source); `_versionOrder` drives tag colours, the filter bar and the
  // edit-cycle. If that JSON is absent (e.g. a console page), fall back to the
  // versions present in the data. Sorting always uses PlanOrder.compareVersion.
  let _versionOrder = [];
  let _legend = null;   // [{token, title}] from plan-versions.json, or null

  // ── AUTHORED FIELD NAMES (fixed 2026-07-27) ────────────────────────────────
  // Every leaf in every plans/*.yaml — 35 entries files and 301 dev entries — is
  // authored as { stage, summary_en, summary_zh }. This module was reading and
  // writing { status, text, zh }, which matches NOTHING in the data. Nothing was
  // being dropped: each leaf rendered as an <li> with a drag handle and an EMPTY
  // text span, so 399 entries across 7 plan pages displayed as blank bullets and
  // the version legend collected zero tokens.
  // ⚠️ It was also a DATA-LOSS trap. extractItemsFromUl harvested the blank spans
  // back as { text: "" } and the push guard (item.text !== undefined) accepted
  // them, so pressing Save on any plan page would have overwritten every entry
  // with an empty string. Read and write are therefore BOTH corrected here — a
  // read-only fix would still have rewritten the whole file into the wrong
  // vocabulary on first save.
  // Legacy status/text/zh is still accepted on read so any file already using it
  // keeps working; WRITES always emit the authored names.
  const leafStatus = (it) => it.stage      || it.status;
  const leafText   = (it) => it.summary_en || it.text;
  const leafZh     = (it) => it.summary_zh || it.zh;

  function _collectStatuses(set) {
    ((devData && devData.sections) || []).forEach(s =>
      (s.entries || []).forEach(it => { if (it && leafStatus(it)) set.add(leafStatus(it)); }));
    Object.keys(entriesData || {}).forEach(k => {
      const items = entriesData[k];
      if (!Array.isArray(items)) return;
      items.forEach(it => {
        if (it && it.entries && it.title) {
          (it.entries || []).forEach(sub => { if (sub && leafStatus(sub)) set.add(leafStatus(sub)); });
        } else if (it && leafStatus(it)) {
          set.add(leafStatus(it));
        }
      });
    });
  }

  function computeVersionOrder() {
    const set = new Set();
    _collectStatuses(set);
    return Array.from(set).filter(s => PlanOrder.parseVersion(s)).sort(PlanOrder.compareVersion);
  }

  // token → 'hsl(…)' from the shared two-series palette (PlanOrder.versionColors:
  // grouped by major, hue-stepped within each series), recomputed each render.
  let _versionColors = {};

  // Apply a version's hue as an inline background to a tag / legend chip / filter
  // button. A non-version status (or unset) gets the neutral 'unset' chrome.
  function styleVersionEl(el, baseClass, token) {
    const c = _versionColors[token];
    if (c) { el.className = baseClass + ' planv'; el.style.background = c; }
    else { el.className = baseClass + ' unset'; el.style.background = ''; }
  }

  // ---- Loading ----
  async function fetchYamlFiles() {
    const [structRes, entriesRes, devRes, builtRes, pvRes] = await Promise.all([
      fetch(`plans/${APP_PLAN_ID}-structure.yaml`),
      fetch(`plans/${APP_PLAN_ID}-entries.yaml`),
      fetch(`plans/${APP_PLAN_ID}-dev.yaml`),
      fetch('plans/built-pages.json').catch(() => null),
      fetch('plans/plan-versions.json').catch(() => null),
    ]);
    if (!structRes.ok || !entriesRes.ok || !devRes.ok) {
      throw new Error(`Failed to load ${APP_PLAN_ID} YAML files from plans/`);
    }
    let manifest = null;
    if (builtRes && builtRes.ok) {
      try { manifest = await builtRes.json(); } catch (_) { /* keep null */ }
    }
    let versions = null;
    if (pvRes && pvRes.ok) {
      try { versions = (await pvRes.json()).versions || null; } catch (_) { /* keep null */ }
    }
    return {
      structure: jsyaml.load(await structRes.text()),
      entries: jsyaml.load(await entriesRes.text()) || {},
      dev: jsyaml.load(await devRes.text()) || { sections: [] },
      manifest: manifest,
      versions: versions,
    };
  }

  async function loadData() {
    try {
      const data = await fetchYamlFiles();
      structureData = data.structure;
      entriesData = data.entries;
      devData = data.dev;
      manifestMeta = data.manifest || manifestMeta;
      _legend = data.versions || null;
      render();
    } catch (e) {
      document.getElementById('loading-msg').textContent =
        `Error: could not load ${APP_PLAN_ID} YAML files. Are you serving the page?`;
      console.error(e);
    }
  }

  // Project-specific stats line — lines/words/字 for this app only. Formatting
  // and the site-stats link live in the shared StatusLine helper (status-line.js).
  function renderStatsLine() {
    const el = document.getElementById('project-stats');
    if (!el || !manifestMeta) return;
    const lines = (manifestMeta.project_lines || {})[APP_PLAN_ID];
    const words = (manifestMeta.project_words || {})[APP_PLAN_ID];
    const chars = (manifestMeta.project_chars || {})[APP_PLAN_ID];
    const a = StatusLine.link([StatusLine.head(lines, words, chars)]);
    if (!a) return;
    el.innerHTML = '';
    el.appendChild(a);
  }

  // ---- Rendering ----
  function render() {
    document.getElementById('loading-msg').style.display = 'none';
    document.getElementById('toc-search').style.display = '';
    document.getElementById('toc-container').style.display = '';
    _versionOrder = _legend ? _legend.map(v => v.token) : computeVersionOrder();
    _versionColors = PlanOrder.versionColors(_versionOrder);
    buildLegend();
    document.getElementById('filter-bar').style.display = '';
    buildFilterBar();
    renderToc();
    renderStatsLine();
    renderDevSection();
    renderSections();
    document.querySelectorAll('section li').forEach(li => {
      addHandle(li); addControls(li); wrapLiText(li);
    });
    document.querySelectorAll('section ul').forEach(sortList);
    addSectionControls();
    renumberLis();
    updateZhBreaks();
  }

  // ---- TOC ----
  function renderToc() {
    const ol = document.getElementById('toc-list');
    ol.innerHTML = '';
    const SL = secLetterMap();

    // Dev sections — h2 always renders (even when empty), so this gets the
    // leading section letter regardless of whether the user has filled in any
    // dev sub-sections yet.
    {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#dev';
      a.textContent = SL.dev + '. 🔧 App Development';
      const subs = (devData && devData.sections) || [];
      if (subs.length) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.appendChild(a);
        details.appendChild(summary);
        const subOl = document.createElement('ol');
        subOl.style.marginTop = '0.3rem';
        let subIdx = 0;
        subs.forEach(sub => {
          subIdx++;
          const subLi = document.createElement('li');
          const subA = document.createElement('a');
          subA.href = '#' + sub.id;
          subA.textContent = SL.dev + '.' + subIdx + '. ' + sub.title;
          subLi.appendChild(subA);
          subOl.appendChild(subLi);
        });
        details.appendChild(subOl);
        li.appendChild(details);
      } else {
        li.appendChild(a);
      }
      ol.appendChild(li);
    }

    // Structure sections from the app's manifest (or hand-edited stub).
    if (structureData && structureData.sections) {
      structureData.sections.forEach(sec => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + sec.id;
        a.textContent = SL[sec.id] + '. ' + sec.title;
        const subOl = buildTocOl(sec.pages, SL[sec.id] + '.', sec.id);
        if (subOl) {
          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.appendChild(a);
          details.appendChild(summary);
          details.appendChild(subOl);
          li.appendChild(details);
        } else {
          li.appendChild(a);
        }
        ol.appendChild(li);
      });
    }
  }

  function buildTocOl(pages, prefix, parentPageId) {
    // Append both real sub-pages (manifest sub-pages) and entries.yaml-defined
    // sub-groups (titled entry clusters under a page). Pages get linked anchors;
    // sub-groups get inline anchors when they declare an id.
    const subGroupsForParent = parentEntriesGroups(parentPageId);
    if ((!pages || !pages.length) && !subGroupsForParent.length) return null;
    const ol = document.createElement('ol');
    ol.style.marginTop = '0.3rem';
    let idx = 0;
    (pages || []).forEach(p => {
      idx++;
      const num = prefix + idx;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + p.id;
      a.textContent = num + '. ' + p.title;
      const subOl = buildTocOl(p.pages, num + '.', p.id);
      if (subOl) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.appendChild(a);
        details.appendChild(summary);
        details.appendChild(subOl);
        li.appendChild(details);
      } else {
        li.appendChild(a);
      }
      ol.appendChild(li);
    });
    subGroupsForParent.forEach(g => {
      idx++;
      const num = prefix + idx;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + (g.id || (parentPageId + '-' + slugify(g.title)));
      a.textContent = num + '. ' + g.title;
      li.appendChild(a);
      ol.appendChild(li);
    });
    return ol;
  }

  function parentEntriesGroups(pageId) {
    const items = (entriesData || {})[pageId];
    if (!Array.isArray(items) || !items.length) return [];
    return items.filter(it => it && typeof it === 'object' && it.entries && it.title);
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // ---- Dev section render (always renders the h2 so section #1 exists even
  // before the user fills in any dev sub-sections) ----
  function renderDevSection() {
    const container = document.getElementById('dev-container');
    container.innerHTML = '';
    const subs = (devData && devData.sections) || [];

    const section = document.createElement('section');
    section.id = 'dev';
    section.style.setProperty('--sl', '"' + secLetterMap().dev + '"');

    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.innerHTML = '🔧 App Development<span class="page-status meta">non-page</span>';
    section.appendChild(h2);

    const details = document.createElement('details');
    details.className = 'section-collapse';
    details.open = true;
    const summary = document.createElement('summary');
    details.appendChild(summary);

    subs.forEach(sub => {
      const h3 = document.createElement('h3');
      h3.id = sub.id;
      h3.className = 'page-h3';
      h3.style.marginTop = '1.5rem';
      h3.style.marginBottom = '0.8rem';
      h3.textContent = sub.title;
      details.appendChild(h3);

      if (sub.description) {
        const p = document.createElement('p');
        p.style.color = 'var(--muted)';
        p.style.fontSize = '0.88rem';
        p.style.marginBottom = '0.5rem';
        let descHtml = escHtml(sub.description);
        if (sub.description_zh) {
          descHtml += ' <span class="zh">' + escHtml(sub.description_zh) + '</span>';
        }
        p.innerHTML = descHtml;
        details.appendChild(p);
      }

      const ul = document.createElement('ul');
      (sub.entries || []).forEach(item => renderLeafItem(ul, item));
      details.appendChild(ul);
      appendAddRow(details, ul);
    });

    section.appendChild(details);
    container.appendChild(section);
  }

  // ---- Structure section render ----
  function renderSections() {
    const container = document.getElementById('sections-container');
    container.innerHTML = '';
    if (!structureData || !structureData.sections) return;

    const SL = secLetterMap();
    structureData.sections.forEach(sec => {
      const section = document.createElement('section');
      section.id = sec.id;
      section.style.setProperty('--sl', '"' + (SL[sec.id] || '') + '"');

      const h2 = document.createElement('h2');
      h2.className = 'section-title';
      h2.innerHTML = escHtml(sec.title);
      section.appendChild(h2);

      const details = document.createElement('details');
      details.className = 'section-collapse';
      details.open = true;
      const summary = document.createElement('summary');
      details.appendChild(summary);

      // Section-level entries (rare — most go on individual pages).
      renderEntriesFor(details, sec.id, 3);

      (sec.pages || []).forEach(page => renderPage(details, page, 3));

      section.appendChild(details);
      container.appendChild(section);
    });
  }

  function renderPage(parent, page, level) {
    const lvl = Math.max(3, Math.min(level, 6));
    const heading = document.createElement('h' + lvl);
    heading.id = page.id;
    heading.className = 'page-h' + lvl;
    heading.style.marginTop = '1.5rem';
    heading.style.marginBottom = '0.8rem';
    heading.textContent = PlanOrder.displayName(page);
    parent.appendChild(heading);

    if (page.description) {
      const p = document.createElement('p');
      p.style.color = 'var(--muted)';
      p.style.fontSize = '0.88rem';
      p.style.marginBottom = '0.5rem';
      let descHtml = escHtml(page.description);
      if (page.description_zh) {
        descHtml += ' <span class="zh">' + escHtml(page.description_zh) + '</span>';
      }
      p.innerHTML = descHtml;
      parent.appendChild(p);
    }

    renderEntriesFor(parent, page.id, lvl + 1);

    (page.pages || []).forEach(child => renderPage(parent, child, lvl + 1));
  }

  // Render a page's entries.yaml content. Items are either leaf entries
  // (rendered into a single <ul>) or sub-groups (each renders as a heading +
  // its own <ul>). Leaves and sub-groups don't mix within one page.
  function renderEntriesFor(parent, pageId, subHeadingLevel) {
    const items = (entriesData || {})[pageId];
    if (!Array.isArray(items)) {
      const ul = document.createElement('ul');
      parent.appendChild(ul);
      appendAddRow(parent, ul);
      return;
    }
    const subGroups = items.filter(it => it && typeof it === 'object' && it.entries && it.title);
    if (subGroups.length === items.length && subGroups.length > 0) {
      const pageUl = document.createElement('ul');
      parent.appendChild(pageUl);
      appendAddRow(parent, pageUl);
      subGroups.forEach(g => renderSubGroup(parent, g, pageId, subHeadingLevel));
      return;
    }
    const ul = document.createElement('ul');
    items.forEach(item => renderLeafItem(ul, item));
    parent.appendChild(ul);
    appendAddRow(parent, ul);
  }

  function renderSubGroup(parent, group, parentPageId, level) {
    const lvl = Math.max(3, Math.min(level, 6));
    const id = group.id || (parentPageId + '-' + slugify(group.title));
    const heading = document.createElement('h' + lvl);
    heading.id = id;
    heading.className = 'page-h' + lvl;
    heading.dataset.entryGroup = '1';
    heading.dataset.parentPage = parentPageId;
    heading.style.marginTop = '1.2rem';
    heading.style.marginBottom = '0.6rem';
    heading.textContent = group.title;
    parent.appendChild(heading);

    if (group.description) {
      const p = document.createElement('p');
      p.style.color = 'var(--muted)';
      p.style.fontSize = '0.88rem';
      p.style.marginBottom = '0.5rem';
      let descHtml = escHtml(group.description);
      if (group.description_zh) {
        descHtml += ' <span class="zh">' + escHtml(group.description_zh) + '</span>';
      }
      p.innerHTML = descHtml;
      parent.appendChild(p);
    }

    const ul = document.createElement('ul');
    (group.entries || []).forEach(item => renderLeafItem(ul, item));
    parent.appendChild(ul);
    appendAddRow(parent, ul);
  }

  function renderLeafItem(ul, item) {
    const li = document.createElement('li');
    const status = leafStatus(item), text = leafText(item), zh = leafZh(item);
    if (status) li.dataset.status = status;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠇';
    li.appendChild(handle);

    if (status) {
      const tag = document.createElement('span');
      styleVersionEl(tag, 'tag', status);
      tag.setAttribute('contenteditable', 'false');
      tag.textContent = status;
      tag.addEventListener('click', (e) => toggleStatus(tag, e));
      li.appendChild(tag);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'li-text';
    appendLinkedText(textSpan, ' ' + (text || ''));
    if (zh) {
      const zhSpan = document.createElement('span');
      zhSpan.className = 'zh';
      appendLinkedText(zhSpan, zh);
      textSpan.appendChild(document.createTextNode(' '));
      textSpan.appendChild(zhSpan);
    }
    li.appendChild(textSpan);

    const ctrl = document.createElement('span');
    ctrl.className = 'li-controls';
    ctrl.setAttribute('contenteditable', 'false');
    li.appendChild(ctrl);

    ul.appendChild(li);
  }

  function appendAddRow(parent, ul) {
    const row = document.createElement('div');
    row.className = 'add-item-row';
    const btn = document.createElement('button');
    btn.className = 'add-item-btn';
    btn.textContent = '+ Add item';
    btn.onclick = () => addItemToSection(ul);
    row.appendChild(btn);
    parent.appendChild(row);
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const URL_RE = /https?:\/\/[^\s<>"'()（）【】《》]+[^\s<>"'().,;:!?（）【】《》，。、；：！？]/g;
  function appendLinkedText(parent, text) {
    let last = 0;
    text.replace(URL_RE, (url, offset) => {
      if (offset > last) parent.appendChild(document.createTextNode(text.slice(last, offset)));
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.appendChild(a);
      last = offset + url.length;
      return url;
    });
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // ---- Numbering (computed against the rendered DOM so dnd reorders work) ----
  // The counter scheme lives in the shared engine (PlanOrder.numberSection); here
  // we only walk the DOM into the {h}/{u} step sequence it expects, then stamp the
  // numbers it returns back onto the <li>s — so the page and the launchpad number
  // identically.
  function renumberLis() {
    const SL = secLetterMap();
    const sectionEls = [
      ...document.querySelectorAll('#dev-container > section'),
      ...document.querySelectorAll('#sections-container > section'),
    ];
    sectionEls.forEach((sec, sIdx) => {
      const seq = [];
      const uls = [];
      (function walk(el) {
        for (const c of el.children) {
          const m = /^H([3-6])$/.exec(c.tagName);
          if (m) {
            seq.push({ h: parseInt(m[1]) });
          } else if (c.tagName === 'UL') {
            const lis = [...c.children].filter(x => x.tagName === 'LI');
            seq.push({ u: lis.length });
            uls.push(lis);
          } else if (c.children.length) {
            walk(c);
          }
        }
      })(sec);
      let ui = 0;
      PlanOrder.numberSection(SL[sec.id] || (sIdx + 1), seq).forEach(step => {
        if (step.u == null) return;
        const lis = uls[ui++];
        step.numbers.forEach((num, j) => setLiNum(lis[j], num));
      });
    });
  }

  function setLiNum(li, num) {
    let span = li.querySelector(':scope > .num');
    if (!span) {
      span = document.createElement('span');
      span.className = 'num';
      span.setAttribute('contenteditable', 'false');
      const text = li.querySelector(':scope > .li-text');
      if (text) li.insertBefore(span, text);
      else li.appendChild(span);
    }
    span.textContent = num;
  }

  // ---- Editing helpers ----
  function isEditing() { return document.querySelector('.container').classList.contains('editing'); }

  function sortList(ul) {
    if (!ul) return;
    const items = Array.from(ul.children).filter(el => el.tagName === 'LI');
    items.sort((a, b) => PlanOrder.compareVersion(a.dataset.status, b.dataset.status));
    items.forEach(li => ul.appendChild(li));
  }

  // Click-cycle through [unset, …versions present]. Editing is view-only here
  // (Save downloads YAML); the terminal manager is the real editor, so the cycle
  // only needs to reach versions already in the data.
  function toggleStatus(tag, e) {
    if (!isEditing()) return;
    const li = tag.closest('li');
    if (!li) return;
    const ring = ['unset'].concat(_versionOrder);
    let i = ring.indexOf(li.dataset.status || 'unset');
    if (i < 0) i = 0;
    const step = (e && e.shiftKey) ? -1 : 1;
    const next = ring[(i + step + ring.length) % ring.length];
    li.dataset.status = next;
    styleVersionEl(tag, 'tag', next);
    tag.textContent = next === 'unset' ? 'Unset' : next;
  }

  // Roadmap legend (token → meaning) so a compact tag like "p0.3" is decodable.
  // Inserted above the filter bar; styled by .plan-legend in the shared docs.css.
  // Only shown when the build supplied plan-versions.json (the legend source);
  // a page without it (e.g. a console plan) simply has no legend.
  function buildLegend() {
    const bar = document.getElementById('filter-bar');
    let el = document.getElementById('plan-legend');
    if (!_legend || !_legend.length || !bar) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'plan-legend';
      el.className = 'plan-legend';
      bar.parentNode.insertBefore(el, bar);
    }
    el.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'plan-legend-label';
    label.textContent = 'Roadmap:';
    el.appendChild(label);
    _legend.forEach((v) => {
      const item = document.createElement('span');
      item.className = 'plan-legend-item';
      const chip = document.createElement('span');
      styleVersionEl(chip, 'tag', v.token);
      chip.textContent = v.token;
      const title = document.createElement('span');
      title.className = 'plan-legend-title';
      title.textContent = v.title || '';
      item.appendChild(chip);
      item.appendChild(title);
      el.appendChild(item);
    });
  }

  // Filter bar built from the canonical version order: All, one button per
  // version (positional colour class), Unset. Replaces any static buttons in the
  // page shell so the controls always match the roadmap.
  function buildFilterBar() {
    const bar = document.getElementById('filter-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = 'Filter:';
    bar.appendChild(label);
    const mk = (filter, text, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-btn' + (cls ? ' ' + cls : '');
      b.dataset.filter = filter;
      b.textContent = text;
      b.addEventListener('click', () => filterItems(filter));
      bar.appendChild(b);
      return b;
    };
    mk('all', 'All', '').classList.toggle('active', _activeFilter === 'all');
    _versionOrder.forEach(token => {
      const b = mk(token, token, '');
      styleVersionEl(b, 'filter-btn', token);   // overwrites className → set state after
      b.dataset.filter = token;
      if (token === _activeFilter) b.classList.add('active');
    });
    mk('unset', 'Unset', 'unset').classList.toggle('active', _activeFilter === 'unset');
  }

  let _activeFilter = 'all';
  function filterItems(status) {
    if (status !== 'all' && status === _activeFilter) status = 'all';
    _activeFilter = status;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === status));
    document.querySelectorAll('li[data-status]').forEach(li => {
      li.classList.toggle('hidden', status !== 'all' && li.dataset.status !== status);
    });
  }

  // ---- Drag and drop (before/after only) ----
  let dragSrc = null;
  let _dragging = false;
  let _ghost = null;

  function liAtPoint(x, y) {
    for (const li of document.querySelectorAll('section li')) {
      if (li === dragSrc) continue;
      const r = li.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return li;
    }
    return null;
  }

  function firstLiAbovePoint(x, y) {
    for (const ul of document.querySelectorAll('section ul')) {
      const firstLi = ul.querySelector(':scope > li');
      if (!firstLi || firstLi === dragSrc) continue;
      const ur = ul.getBoundingClientRect();
      const lr = firstLi.getBoundingClientRect();
      if (x >= ur.left && x <= ur.right && y >= ur.top && y < lr.top) return firstLi;
    }
    return null;
  }

  function emptyUlAtPoint(x, y) {
    for (const ul of document.querySelectorAll('section ul')) {
      if (ul.querySelector('li')) continue;
      const r = ul.getBoundingClientRect();
      if (r.height < 2) {
        const prev = ul.previousElementSibling;
        if (!prev) continue;
        const pr = prev.getBoundingClientRect();
        if (x >= pr.left && x <= pr.right && y >= pr.bottom && y <= pr.bottom + 40) return ul;
      } else if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return ul;
      }
    }
    return null;
  }

  function onDragMove(e) {
    if (!dragSrc) return;
    if (!_dragging) {
      _dragging = true;
      dragSrc.classList.add('dragging');
      _ghost = dragSrc.cloneNode(true);
      _ghost.className = 'drag-ghost';
      document.body.appendChild(_ghost);
    }
    _ghost.style.left = (e.clientX + 14) + 'px';
    _ghost.style.top  = (e.clientY - 10) + 'px';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    const target = liAtPoint(e.clientX, e.clientY) || firstLiAbovePoint(e.clientX, e.clientY);
    if (target) { showIndicator(target, e.clientY); }
    else {
      clearIndicators();
      const ul = emptyUlAtPoint(e.clientX, e.clientY);
      if (ul) ul.classList.add('drop-child');
    }
  }

  function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (_ghost) { _ghost.remove(); _ghost = null; }
    if (dragSrc) dragSrc.classList.remove('dragging');
    if (_dragging) {
      const target = liAtPoint(e.clientX, e.clientY) || firstLiAbovePoint(e.clientX, e.clientY);
      if (target) doMove(target, e.clientY);
      else {
        const ul = emptyUlAtPoint(e.clientX, e.clientY);
        if (ul) {
          ul.appendChild(dragSrc);
          document.querySelectorAll('section li').forEach(li => { addHandle(li); addControls(li); wrapLiText(li); });
          renumberLis();
          applyEditables();
        }
      }
    }
    dragSrc = null;
    _dragging = false;
    clearIndicators();
    if (isEditing()) applyEditables();
  }

  function addHandle(li) {
    const old = li.querySelector(':scope > .drag-handle');
    if (old) old.remove();
    const h = document.createElement('span');
    h.className = 'drag-handle';
    h.textContent = '⠇';
    h.addEventListener('mousedown', e => {
      if (!isEditing()) return;
      e.preventDefault();
      dragSrc = li;
      _dragging = false;
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    });
    li.prepend(h);
  }

  function dropZone(target, clientY) {
    const rect = target.getBoundingClientRect();
    const rel = (clientY - rect.top) / rect.height;
    return rel < 0.5 ? 'before' : 'after';
  }

  function showIndicator(target, clientY) {
    if (!dragSrc || dragSrc === target) return;
    clearIndicators();
    const zone = dropZone(target, clientY);
    target.classList.add(zone === 'before' ? 'drop-before' : 'drop-after');
  }

  function doMove(target, clientY) {
    if (!dragSrc || dragSrc === target) return;
    const zone = dropZone(target, clientY);
    if (zone === 'before') {
      target.parentNode.insertBefore(dragSrc, target);
    } else {
      target.parentNode.insertBefore(dragSrc, target.nextSibling);
    }
    clearIndicators();
    document.querySelectorAll('section li').forEach(li => { addHandle(li); addControls(li); wrapLiText(li); });
    renumberLis();
    applyEditables();
  }

  function clearIndicators() {
    document.querySelectorAll('.drop-before, .drop-after, .drop-child').forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-child'));
  }

  // ---- Item controls ----
  function addControls(li) {
    const old = li.querySelector(':scope > .li-controls');
    if (old) old.remove();
    const ctrl = document.createElement('span');
    ctrl.className = 'li-controls';
    ctrl.setAttribute('contenteditable', 'false');
    ctrl.innerHTML =
      '<button class="li-btn" title="Move up" onclick="window._appPlan.moveLi(this,-1)">↑</button>' +
      '<button class="li-btn" title="Move down" onclick="window._appPlan.moveLi(this,1)">↓</button>' +
      '<button class="li-btn" title="Add below" onclick="window._appPlan.addBelow(this)">＋</button>' +
      '<button class="li-btn del" title="Delete" onclick="window._appPlan.deleteLi(this)">✕</button>';
    li.appendChild(ctrl);
  }

  function moveLi(btn, dir) {
    const li = btn.closest('li');
    const sib = dir === -1 ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    dir === -1 ? li.parentNode.insertBefore(li, sib) : li.parentNode.insertBefore(sib, li);
    renumberLis();
  }

  function addBelow(btn) {
    const li = btn.closest('li');
    const newLi = document.createElement('li');
    newLi.dataset.status = 'unset';
    li.parentNode.insertBefore(newLi, li.nextSibling);
    addHandle(newLi);
    const tag = document.createElement('span');
    tag.className = 'tag unset';
    tag.textContent = 'Unset';
    tag.addEventListener('click', (e) => toggleStatus(tag, e));
    newLi.querySelector('.drag-handle').after(tag);
    const textSpan = document.createElement('span');
    textSpan.className = 'li-text';
    if (isEditing()) textSpan.setAttribute('contenteditable', 'true');
    textSpan.appendChild(document.createTextNode(' '));
    newLi.appendChild(textSpan);
    addControls(newLi);
    renumberLis();
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(textSpan.firstChild, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    newLi.focus();
  }

  function deleteLi(btn) {
    const li = btn.closest('li');
    if (!confirm('Delete this item?')) return;
    li.remove();
    renumberLis();
  }

  function addItemToSection(ul) {
    const newLi = document.createElement('li');
    newLi.dataset.status = 'unset';
    ul.appendChild(newLi);
    addHandle(newLi);
    const tag = document.createElement('span');
    tag.className = 'tag unset';
    tag.textContent = 'Unset';
    tag.addEventListener('click', (e) => toggleStatus(tag, e));
    newLi.querySelector('.drag-handle').after(tag);
    const textSpan = document.createElement('span');
    textSpan.className = 'li-text';
    if (isEditing()) textSpan.setAttribute('contenteditable', 'true');
    textSpan.appendChild(document.createTextNode(' '));
    newLi.appendChild(textSpan);
    addControls(newLi);
    renumberLis();
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(textSpan.firstChild, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function addSectionControls() {
    document.querySelectorAll('.add-item-row').forEach(el => el.remove());
    document.querySelectorAll('section ul').forEach(ul => {
      const row = document.createElement('div');
      row.className = 'add-item-row';
      const btn = document.createElement('button');
      btn.className = 'add-item-btn';
      btn.textContent = '+ Add item';
      btn.onclick = () => addItemToSection(ul);
      row.appendChild(btn);
      ul.after(row);
    });
  }

  function wrapLiText(li) {
    if (li.querySelector(':scope > .li-text')) return;
    const skip = new Set([
      ...li.querySelectorAll(':scope > .drag-handle, :scope > .tag, :scope > .li-controls, :scope > .num')
    ]);
    const nodes = [...li.childNodes].filter(n => !skip.has(n));
    if (!nodes.length) return;
    const span = document.createElement('span');
    span.className = 'li-text';
    li.insertBefore(span, nodes[0]);
    nodes.forEach(n => span.appendChild(n));
  }

  // ---- Edit mode ----
  function applyEditables() {
    document.querySelectorAll('section .li-text, section h3, section h4, section h5, section h6')
      .forEach(el => el.setAttribute('contenteditable', 'true'));
  }
  function removeEditables() {
    document.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
  }

  function toggleEdit() {
    const c = document.querySelector('.container');
    const btn = document.getElementById('edit-btn');
    const saveBtn = document.getElementById('save-btn');
    const editing = c.classList.contains('editing');
    c.classList.toggle('editing', !editing);
    editing ? removeEditables() : applyEditables();
    btn.textContent = editing ? '✏ Edit' : '✏ Editing…';
    btn.classList.toggle('active', !editing);
    saveBtn.style.display = editing ? 'none' : 'inline-block';
  }

  // ---- Extract data from DOM ----
  function extractEntries() {
    const result = {};
    document.querySelectorAll('#sections-container section').forEach(sec => {
      walkSectionForEntries(sec, result);
    });
    return result;
  }

  function walkSectionForEntries(sec, result) {
    const collapse = sec.querySelector(':scope > .section-collapse');
    if (!collapse) return;

    const els = Array.from(collapse.children).filter(
      el => el.tagName === 'UL' || /^H[3-6]$/.test(el.tagName)
    );

    let firstHeadingIdx = els.findIndex(el => /^H[3-6]$/.test(el.tagName));
    if (firstHeadingIdx === -1) firstHeadingIdx = els.length;

    let sectionEntries = [];
    for (let i = 0; i < firstHeadingIdx; i++) {
      if (els[i].tagName === 'UL') {
        sectionEntries = sectionEntries.concat(extractItemsFromUl(els[i]));
      }
    }
    if (sectionEntries.length) result[sec.id] = sectionEntries;

    let curHeading = null;
    let curUlItems = [];
    const flush = () => {
      if (!curHeading) return;
      if (curHeading.dataset.entryGroup === '1') {
        const parent = curHeading.dataset.parentPage;
        if (!parent) return;
        const group = {
          id: curHeading.id || undefined,
          title: curHeading.textContent.trim(),
          entries: curUlItems,
        };
        if (!result[parent]) result[parent] = [];
        result[parent].push(group);
      } else {
        if (curUlItems.length) result[curHeading.id] = (result[curHeading.id] || []).concat(curUlItems);
      }
    };

    for (let i = firstHeadingIdx; i < els.length; i++) {
      const el = els[i];
      if (/^H[3-6]$/.test(el.tagName)) {
        flush();
        curHeading = el;
        curUlItems = [];
      } else if (el.tagName === 'UL' && curHeading) {
        curUlItems = curUlItems.concat(extractItemsFromUl(el));
      }
    }
    flush();
  }

  function extractDevData() {
    const result = { sections: [] };
    const devContainer = document.getElementById('dev-container');
    const section = devContainer.querySelector('section');
    if (!section) return result;
    const collapse = section.querySelector(':scope > .section-collapse');
    if (!collapse) return result;
    const els = Array.from(collapse.children);
    let curSub = null;
    for (const el of els) {
      if (el.tagName === 'H3' && el.id) {
        const orig = ((devData && devData.sections) || []).find(s => s.id === el.id) || {};
        curSub = {
          id: el.id,
          title: el.textContent.trim(),
          entries: [],
        };
        if (orig.description) curSub.description = orig.description;
        if (orig.description_zh) curSub.description_zh = orig.description_zh;
        result.sections.push(curSub);
      } else if (el.tagName === 'UL' && curSub) {
        curSub.entries = curSub.entries.concat(extractItemsFromUl(el));
      }
    }
    return result;
  }

  function extractItemsFromUl(ul) {
    const items = [];
    ul.querySelectorAll(':scope > li').forEach(li => {
      const item = {};
      if (li.dataset.status) item.stage = li.dataset.status;
      const textEl = li.querySelector(':scope > .li-text');
      if (textEl) {
        const zhEl = textEl.querySelector('.zh');
        let text = '';
        textEl.childNodes.forEach(n => {
          if (n === zhEl) return;
          if (n.nodeType === Node.TEXT_NODE) text += n.textContent;
          else if (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('zh')) text += n.textContent;
        });
        item.summary_en = text.trim();
        if (zhEl) item.summary_zh = zhEl.textContent.trim();
      }
      if (item.summary_en !== undefined) items.push(item);
    });
    return items;
  }

  // ---- Save ----
  async function saveFile() {
    const c = document.querySelector('.container');
    const btn = document.getElementById('edit-btn');
    const saveBtn = document.getElementById('save-btn');
    document.querySelectorAll('section ul').forEach(ul => sortList(ul));
    renumberLis();
    removeEditables();
    c.classList.remove('editing');
    btn.textContent = '✏ Edit';
    btn.classList.remove('active');
    saveBtn.style.display = 'none';

    const currentEntries = extractEntries();
    const currentDev = extractDevData();
    const entriesYaml = jsyaml.dump(currentEntries, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    const devYaml = jsyaml.dump(currentDev, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    downloadFile(`${APP_PLAN_ID}-entries.yaml`, entriesYaml, 'application/x-yaml');
    setTimeout(() => downloadFile(`${APP_PLAN_ID}-dev.yaml`, devYaml, 'application/x-yaml'), 300);
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function resetData() {
    try {
      const data = await fetchYamlFiles();
      structureData = data.structure;
      entriesData = data.entries;
      devData = data.dev;
      manifestMeta = data.manifest || manifestMeta;
      render();
    } catch (e) {
      alert('Cannot reset: failed to reload YAML files from plans/. Are you serving the page?');
      console.error(e);
    }
  }

  // ---- Zh line-break logic ----
  function updateZhBreaks() {
    document.querySelectorAll('.li-text').forEach(liText => {
      const zh = liText.querySelector('.zh');
      if (!zh) return;
      zh.style.display = '';
      zh.style.marginLeft = '';
      zh.style.marginTop = '';
      zh.style.display = 'none';
      const engHeight = liText.getBoundingClientRect().height;
      zh.style.display = '';
      const lineHeight = parseFloat(getComputedStyle(liText).lineHeight) || 24;
      if (engHeight > lineHeight * 1.5) {
        zh.style.display = 'block';
        zh.style.marginLeft = '0';
        zh.style.marginTop = '0.1rem';
      }
    });
  }
  let _zhResizeTimer;
  window.addEventListener('resize', () => { clearTimeout(_zhResizeTimer); _zhResizeTimer = setTimeout(updateZhBreaks, 120); });

  // ---- TOC search + toggle ----
  function onTocSearch(query) {
    const q = (query || '').trim().toLowerCase();
    const items = document.querySelectorAll('.toc li');
    items.forEach(li => {
      if (!q) { li.classList.remove('search-hidden'); return; }
      const text = li.textContent.toLowerCase();
      li.classList.toggle('search-hidden', !text.includes(q));
    });
    if (q) {
      document.querySelectorAll('.toc details').forEach(d => {
        if (d.querySelector(':scope li:not(.search-hidden)')) d.open = true;
      });
    }
  }

  function tocToggleAll() {
    const details = document.querySelectorAll('.toc details');
    const anyClosed = Array.from(details).some(d => !d.open);
    details.forEach(d => { d.open = anyClosed; });
    const btn = document.getElementById('toc-toggle-btn');
    if (btn) btn.textContent = anyClosed ? 'Collapse all' : 'Expand all';
  }

  // ---- Public surface for inline onclick handlers in HTML + li controls ----
  window._appPlan = { moveLi, addBelow, deleteLi };
  window.toggleEdit = toggleEdit;
  window.saveFile = saveFile;
  window.resetData = resetData;
  window.filterItems = filterItems;
  window.onTocSearch = onTocSearch;
  window.tocToggleAll = tocToggleAll;

  // ---- Init ----
  loadData();
})();
