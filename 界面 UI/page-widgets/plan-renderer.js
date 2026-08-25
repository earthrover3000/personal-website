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
  // The shared DOM layer lives on the shelf (page-widgets/plan-chrome.js) —
  // tags, legend, filter bar, numbering, drag, the edit controls, the detail
  // disclosure, Save's download. Bound here by name so every call site below
  // reads exactly as it did when these were local functions.
  const PC = window.PlanChrome;
  if (!PC) {
    console.error('plan-renderer.js: page-widgets/plan-chrome.js must load first');
    return;
  }
  const {
    styleVersionEl, buildTocOl, slugify, appendAddRow, escHtml,
    appendLinkedText, renumberLis, setLiNum, isEditing, sortList,
    toggleStatus, legendRows, buildLegend, buildFilterBar,
    filterItems, liAtPoint, firstLiAbovePoint, emptyUlAtPoint, onDragMove,
    onDragEnd, addHandle, dropZone, showIndicator, doMove, clearIndicators,
    addControls, moveLi, addBelow, deleteLi, addItemToSection,
    addSectionControls, wrapLiText, applyEditables, removeEditables,
    toggleEdit, extractItemsFromUl, downloadFile, updateZhBreaks,
    onTocSearch, tocToggleAll
  } = PC;

  // The two questions the chrome cannot answer for itself, because only this
  // page's documents know: which letter each section carries, and which
  // sub-groups hang off a page.
  PC.configure({
    sectionLetters: () => secLetterMap(),
    entriesGroupsFor: (pageId) => parentEntriesGroups(pageId),
    // These pages set zh inline after the English and stack it only when it
    // will not fit, so the break has to be measured — see updateZhBreaks.
    zhBreaks: true,
  });

  // Ordering + numbering come from the shared plan-order engine (loaded as a
  // <script> just before this one), so the page and the launchpad plan manager
  // stay in lockstep. Hard dependency, like js-yaml.
  const PlanOrder = window.PlanOrder;

  // What this plan calls its non-page half — the sections built from
  // <id>-dev.yaml, which always render first. Named by the PAGE because it
  // names the plan's subject: an app plans its 'App Development', the site
  // map its 'Infrastructure Development', and a plan whose subject is a set
  // of authored works plans neither. It was hardcoded, and hardcoded three
  // times over — the letter map, the TOC row and the section heading each
  // spelt it — so a page that needed a different word had to be a different
  // renderer. Set via window.PLAN_DEV_SECTION in the shell.
  const DEV_SECTION = window.PLAN_DEV_SECTION || 'App Development';
  if (!PlanOrder) {
    console.error('plan-renderer.js: window.PlanOrder must be loaded first (引擎 Engines/plan-order/plan-order.js)');
    return;
  }

  // Mnemonic section letters keyed by section id, in the SAME order as the
  // launchpad (dev section first, then structure) so the two index identically.
  function secLetterMap() {
    const taken = [];
    const m = { dev: PlanOrder.sectionLetter(DEV_SECTION, taken) };
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
  // The entries doc EXACTLY as parsed, kept so the save path can carry
  // forward keys that never rendered — see PC.carryForwardUnrendered.
  let loadedEntries = null;
  let manifestMeta = { project_lines: null, project_words: null, project_chars: null };

  // Roadmap version axis. The canonical order + the legend (token→title) come
  // from plans/plan-versions.json (build-emitted from site-roadmap.yaml — the
  // single source); `_versionOrder` drives tag colours, the filter bar and the
  // edit-cycle. If that JSON is absent (e.g. a console page), fall back to the
  // versions present in the data. Sorting always uses PlanOrder.compareVersion.

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


  // ---- Loading ----
  // The two AUTHORED halves (entries + dev) may live somewhere other than the
  // plans/ dir beside the page: console pages set window.PLAN_DATA_BASE to the
  // loopback /plan-data/ mount over the one shared store, so they read exactly
  // what the terminal Planner writes (user decision 2026-08-23). Structure and
  // the generated JSON are always page-relative — they belong to the project
  // whose page this is. The website leaves the base unset: its build copies the
  // authored halves into the deployed plans/ dir, since a published site has no
  // vault to reach.
  const DATA_BASE = window.PLAN_DATA_BASE || 'plans/';

  async function fetchYamlFiles() {
    const [structRes, entriesRes, devRes, builtRes, pvRes] = await Promise.all([
      fetch(`plans/${APP_PLAN_ID}-structure.yaml`),
      fetch(`${DATA_BASE}${APP_PLAN_ID}-entries.yaml`),
      fetch(`${DATA_BASE}${APP_PLAN_ID}-dev.yaml`),
      fetch('plans/built-pages.json').catch(() => null),
      fetch('plans/plan-versions.json').catch(() => null),
    ]);
    if (!structRes.ok) {
      throw new Error(`Failed to load ${APP_PLAN_ID}-structure.yaml from plans/`);
    }
    if (!entriesRes.ok || !devRes.ok) {
      throw new Error(`Failed to load ${APP_PLAN_ID} entries/dev YAML from ${DATA_BASE}`
                      + (DATA_BASE === 'plans/' ? '' : ' — is 资料 Materials mounted?'));
    }
    let manifest = null;
    if (builtRes && builtRes.ok) {
      try { manifest = await builtRes.json(); } catch (_) { /* keep null */ }
    }
    let versions = null, legendMeta = null;
    if (pvRes && pvRes.ok) {
      try {
        const pv = await pvRes.json();
        versions = pv.versions || null;
        // Only keys the file actually carries — buildLegend distinguishes a
        // payload that named its legend from one written before it could, and
        // `{label: undefined}` would read as the former.
        legendMeta = {};
        if (pv.label !== undefined) legendMeta.label = pv.label;
        if (pv.href !== undefined) legendMeta.href = pv.href;
      } catch (_) { /* keep null */ }
    }
    return {
      structure: jsyaml.load(await structRes.text()),
      entries: jsyaml.load(await entriesRes.text()) || {},
      dev: jsyaml.load(await devRes.text()) || { sections: [] },
      manifest: manifest,
      versions: versions,
      legendMeta: legendMeta,
    };
  }

  async function loadData() {
    try {
      const data = await fetchYamlFiles();
      structureData = data.structure;
      entriesData = data.entries;
      devData = data.dev;
      loadedEntries = JSON.parse(JSON.stringify(data.entries || {}));
      manifestMeta = data.manifest || manifestMeta;
      PC.setLegend(data.versions || null, data.legendMeta || {});
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
    PC.setVersionOrder(PC.legend() ? PC.legend().map(v => v.token)
                                   : computeVersionOrder());
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
      a.textContent = SL.dev + '. 🔧 ' + DEV_SECTION;
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


  function parentEntriesGroups(pageId) {
    const items = (entriesData || {})[pageId];
    if (!Array.isArray(items) || !items.length) return [];
    return items.filter(it => it && typeof it === 'object' && it.entries && it.title);
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
    h2.innerHTML = '🔧 ' + escHtml(DEV_SECTION) +
                   '<span class="page-status meta">non-page</span>';
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

  function renderPage(parent, page, level, parentPageId, pageDepth) {
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

    // Entries key resolved by the shared PlanOrder.entriesKeyFor — subviews
    // (third-level nodes) key `<parentPageId>.<id>`, levels 1-2 bare — so
    // this renderer and the launchpad tree read/write the same lists.
    renderEntriesFor(parent,
      PlanOrder.entriesKeyFor(entriesData, page.id, parentPageId || null, pageDepth || 1),
      lvl + 1);

    (page.pages || []).forEach(child => renderPage(parent, child, lvl + 1, page.id, (pageDepth || 1) + 1));
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
    // A stage-less entry is tagged `unset` rather than left bare (2026-08-25).
    // It had been rendering as an untagged line, which cost it two things: the
    // 'unset' filter button matched nothing, because the button filters on
    // li.dataset.status and there was none to match; and there was no chip to
    // click, so the one status you could not reach by cycling was the one every
    // new entry starts in. The chip is the TOKEN in every case — `now`, `p0.4`,
    // `unset` alike — and the legend is what decodes it (PlanOrder.UNSET.title,
    // 'No stage'). Authored files still say it by OMITTING `stage:`; see
    // extractItemsFromUl, which writes the absence back as an absence.
    const text = leafText(item), zh = leafZh(item);
    const status = leafStatus(item) || PlanOrder.UNSET.token;
    li.dataset.status = status;

    // The shared card look (styles/planner-cards.css) — the same `.plan-mini`
    // the website's site map uses, so a plan entry and a site-map entry are
    // one thing wearing one design rather than two that happen to rhyme. The
    // left edge carries the stage's colour: a computed hue for a version
    // token, and for a rung of the named ladder the palette docs.css maps off
    // the class below.
    li.classList.add('plan-mini');
    const stageCls = PlanOrder.stageClass(status);
    if (stageCls) li.classList.add(stageCls);
    const hue = PC.versionColor(status);
    if (hue) li.style.setProperty('--stage-color', hue);

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠇';
    li.appendChild(handle);

    const tag = document.createElement('span');
    styleVersionEl(tag, 'tag', status);
    tag.setAttribute('contenteditable', 'false');
    tag.textContent = PlanOrder.tokenLabel(status);
    tag.addEventListener('click', (e) => toggleStatus(tag, e));
    li.appendChild(tag);

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

    // Optional long-form body (detail_en/detail_zh) behind a disclosure — the
    // leaf stays a one-liner until opened. View-only in the browser (edit via
    // the YAML / terminal editor); the rendered divs are ALSO the save-path
    // source (see extractItemsFromUl), so the DOM stays the one copy.
    // Opened by clicking the entry LINE, which also selects it — see
    if (item.detail_en || item.detail_zh) {
      const det = document.createElement('details');
      det.className = 'li-detail';
      det.setAttribute('contenteditable', 'false');
      // The li is a flex row with ordered children (docs.css: num 0 → tag 4);
      // order 5 + full basis drops the disclosure onto its own full-width row
      // BELOW the entry line instead of defaulting into slot 0 before the title.
      det.style.order = '5';
      det.style.flexBasis = '100%';
      det.style.whiteSpace = 'pre-wrap';
      det.style.color = 'var(--muted)';
      det.style.fontSize = '0.88rem';
      det.style.margin = '0.15rem 0 0.3rem';
      // The <summary> exists but shows nothing: a <details> WITHOUT one gets
      // the UA's own 'Details' marker, so it cannot simply be dropped. Hidden
      // by docs.css, which leaves <details>'s open/closed machinery — and the
      // browser's find-in-page reveal — intact while the entry line becomes
      // the only control (user decision 2026-08-25).
      const sum = document.createElement('summary');
      det.appendChild(sum);
      [['detail-en', item.detail_en], ['detail-zh', item.detail_zh]].forEach(([cls, val]) => {
        if (!val) return;
        const div = document.createElement('div');
        div.className = cls;
        appendLinkedText(div, String(val).replace(/\s+$/, ''));
        det.appendChild(div);
      });
      // Marks the row as carrying a body. The click that opens it is handled
      // by plan-chrome's ONE delegated listener, not a listener per row.
      li.classList.add('has-detail');
      li.appendChild(det);
    }

    ul.appendChild(li);
  }










  // What a legend meant before it named itself: the website's roadmap, linked
  // deployed-relative from /contents/docs/<id>/index.html — the same convention
  // as the breadcrumb hrefs (site_facade/render.py DOC_BREADCRUMBS). Only ever
  // reached by a payload predating both keys; see buildLegend.





  // ---- Drag and drop (before/after only) ----




















  // ---- Extract data from DOM ----
  function extractEntries() {
    const result = {};
    document.querySelectorAll('#sections-container section').forEach(sec => {
      walkSectionForEntries(sec, result);
    });
    return PC.carryForwardUnrendered(result, loadedEntries);
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

    PC.beginExtract();
    const currentEntries = extractEntries();
    const currentDev = extractDevData();
    reportEmptyEntries();
    const entriesYaml = jsyaml.dump(currentEntries, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    const devYaml = jsyaml.dump(currentDev, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    downloadFile(`${APP_PLAN_ID}-entries.yaml`, entriesYaml, 'application/x-yaml');
    setTimeout(() => downloadFile(`${APP_PLAN_ID}-dev.yaml`, devYaml, 'application/x-yaml'), 300);
  }


  // An entry whose text was cleared is KEPT in the file and named here (user
  // decision 2026-08-25) — silently dropping it is the worse failure, and this
  // path has form for exactly that. Console rather than a modal: the save has
  // already happened by now, so this is a record, not a question.
  function reportEmptyEntries() {
    const empties = PC.extractWarnings();
    if (!empties.length) return;
    console.warn('plan: saved ' + empties.length + ' entr' +
                 (empties.length === 1 ? 'y' : 'ies') + ' with no text — ' +
                 empties.join(', ') + '. Use the ✕ button to delete instead.');
  }

  async function resetData() {
    try {
      const data = await fetchYamlFiles();
      structureData = data.structure;
      entriesData = data.entries;
      devData = data.dev;
      loadedEntries = JSON.parse(JSON.stringify(data.entries || {}));
      manifestMeta = data.manifest || manifestMeta;
      render();
    } catch (e) {
      alert('Cannot reset: failed to reload the plan YAML. Are you serving the page?');
      console.error(e);
    }
  }




  // ---- Public surface for inline onclick handlers in HTML + li controls ----
  // toggleEdit, filterItems, onTocSearch, tocToggleAll and _appPlan are
  // attached by plan-chrome.js, which owns them.
  window.saveFile = saveFile;
  window.resetData = resetData;

  // ---- Init ----
  loadData();
})();
