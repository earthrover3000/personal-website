// plan-chrome — the shared DOM layer every plan-shaped page wears.
//
// WHAT IT IS. Tags, legend, filter bar, hierarchical numbering, drag-and-drop,
// the edit-mode controls, the long-body disclosure, linked text, the TOC list
// and Save's download. Everything a plan page does TO THE DOM that does not
// depend on which data model it is showing.
//
// WHY IT EXISTS. There were two copies. `page-widgets/plan-renderer.js` drives
// the sixteen app-plan pages; `contents/docs/site-map.html` inlined its own
// near-identical duplicate to draw the website's page tree. A function-level
// diff on 2026-08-25 put numbers on it: 53 shared names, 23 byte-identical,
// and 994 of site-map's 1,507 lines sitting under a name the shelf already had.
//
// It was drifting, and not theoretically — that same week. A day's work on the
// plan pages (the 'No stage' legend row, the named-stage colours, sentence-
// cased tokens, click-the-row-to-open details, the hover highlight) reached all
// sixteen of them and none of the site map, because the site map's buildLegend
// was a byte-level twin of the version those changes had just replaced —
// comment and all.
//
// WHERE THE LINE FALLS, and why. A page's DATA MODEL is its own: the app plans
// walk a flat section->entries map, the site map walks a page tree carrying
// tiers, built-state and per-page URLs. Those renderers, their fetches and
// their extractors are not shared and should not be. The test is 'does this
// function need to know the shape of the data' — if it does, it stayed home.
//
// TWO HOOKS cross that line and are injected through `configure` rather than
// imported: hierarchical numbering needs each section's letter, and the TOC
// needs a page's sub-groups. Both answers come out of the host's own documents,
// so the host supplies them. The defaults return empty, so a page that
// configures nothing still renders — it just numbers without section letters.
//
// STATE. The chrome owns what is chrome's: the version order and the colours
// derived from it, the legend rows and their heading, the active filter, and
// the drag cursor. The host owns its documents, hands the legend in with
// `setLegend`, and hands in whatever token order its vocabulary produces with
// `setVersionOrder`.
//
// Loaded as a bare <script> AFTER plan-order.js and BEFORE whichever renderer
// uses it. Exposes window.PlanChrome, and attaches the handlers that inline
// HTML onclick/oninput attributes call (toggleEdit, filterItems, onTocSearch,
// tocToggleAll) plus window._appPlan for the per-item buttons addControls wires.

(function () {
  'use strict';

  // Pure ordering/naming logic, loaded before this file. Named here so a
  // missing <script> says so at load rather than at the first tag drawn.
  const PlanOrder = window.PlanOrder;
  if (!PlanOrder) {
    console.error('plan-chrome.js: 引擎 Engines/plan-order/plan-order.js must load first');
    return;
  }

  // ---- Chrome state (see STATE above) ----
  let _versionOrder = [];
  let _versionColors = {};
  let _legend = null;      // [{token, title}] from plan-versions.json, or null
  let _legendMeta = {};    // {label, href} — the legend's own heading
  let _activeFilter = 'all';
  let dragSrc = null;
  let _dragging = false;
  let _ghost = null;

  // ---- Host hooks (see TWO HOOKS above) ----
  let _hooks = {
    sectionLetters: () => ({}),
    entriesGroupsFor: () => [],
    // Which <ul>s a drag may drop INTO. The plan pages' sections are flat, so
    // any descendant list is a target; the site map's are a page tree, where
    // only certain levels accept a drop and a descendant selector would offer
    // nested sub-page lists it deliberately excludes. Narrower than the default
    // is the whole reason this is a hook.
    dropTargetSelector: 'section ul',
    // Does this page want Chinese line-breaks MEASURED at runtime? The plan
    // pages do: their zh sits inline after the English and stacks only when
    // it would not fit. The site map does not — its docs.css stacks zh
    // unconditionally, so measuring would fight the stylesheet and leave
    // inline styles behind. Off by default: a host opts in, never inherits.
    zhBreaks: false,
  };
  function configure(hooks) { _hooks = Object.assign({}, _hooks, hooks || {}); }

  // What a legend meant before it named itself — see buildLegend.
  const LEGACY_LEGEND = { label: 'Roadmap', href: '../../pages/public/site-roadmap/' };

  // ---- State in / out ----
  function setLegend(versions, meta) {
    _legend = versions || null;
    _legendMeta = meta || {};
  }
  function legend() { return _legend; }

  // Set the canonical token order and recompute the tag hues from it. ONE call
  // rather than two fields: the colours are a pure function of the order, and
  // letting a host set one without the other is exactly how they desync.
  function setVersionOrder(order) {
    _versionOrder = order || [];
    _versionColors = PlanOrder.versionColors(_versionOrder);
  }
  function versionOrder() { return _versionOrder; }

  // One token's hue, for a host that paints something of its own with it
  // (the site map's mini-cards take it as a CSS custom property).
  // Undefined for a token with no colour — a named stage, or no stage.
  function versionColor(token) { return _versionColors[token]; }
  function activeFilter() { return _activeFilter; }

  // Chrome for a tag / legend chip / filter button, in three kinds:
  //   version token  → 'planv' + the hue PlanOrder.versionColors computed for
  //                    it, set inline (an open series, so it is generated)
  //   ladder stage   → 'planstage stage-<token>', coloured by docs.css (a
  //                    fixed set of words, so it is authored)
  //   no stage       → 'unset', the neutral chrome
  // Before 2026-08-25 there were only the first and last, so `now` / `next` /
  // `later` all fell through to the same grey as no-stage-at-all — a priority
  // axis whose three rungs were indistinguishable at a glance.
  function styleVersionEl(el, baseClass, token) {
    const c = _versionColors[token];
    if (c) { el.className = baseClass + ' planv'; el.style.background = c; return; }
    el.style.background = '';
    const stage = PlanOrder.stageClass(token);
    el.className = baseClass + (stage ? ' planstage ' + stage : ' unset');
  }

  function buildTocOl(pages, prefix, parentPageId) {
    // Append both real sub-pages (manifest sub-pages) and entries.yaml-defined
    // sub-groups (titled entry clusters under a page). Pages get linked anchors;
    // sub-groups get inline anchors when they declare an id.
    const subGroupsForParent = _hooks.entriesGroupsFor(parentPageId);
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

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
    const SL = _hooks.sectionLetters();
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
    const ring = [PlanOrder.UNSET.token].concat(_versionOrder);
    let i = ring.indexOf(li.dataset.status || PlanOrder.UNSET.token);
    if (i < 0) i = 0;
    const step = (e && e.shiftKey) ? -1 : 1;
    const next = ring[(i + step + ring.length) % ring.length];
    li.dataset.status = next;
    styleVersionEl(tag, 'tag', next);
    tag.textContent = PlanOrder.tokenLabel(next);
  }

  // ---- Row selection + the long-body disclosure ----
  // Clicking an entry SELECTS it, and the highlight persists after the pointer
  // leaves so you keep your place while reading (user decision 2026-08-25).
  // Every entry is selectable, body or no body. If it has one, the same click
  // opens or closes it — there is no ▶ marker, by an earlier decision taken
  // knowing a row that opens looks like one that does not; selection is what
  // now gives that click an answer.
  //
  // ONE DELEGATED LISTENER, not one per <li>. Per-row listeners were attached
  // in renderLeafItem inside the `has a detail` branch, so they reached only
  // rows that existed at render AND had a long body: a row added in edit mode
  // was inert, and a row without a body could never be clicked at all. Neither
  // survives a requirement that every entry be selectable.
  //
  // Five things already claim a click inside a leaf and are handed back: the
  // status chip cycles, .li-controls are the edit buttons, the drag handle is a
  // grab target, summary text can carry links, and an OPEN body is prose you
  // may want to select without it shutting under you. Edit mode bows out
  // entirely — the text is contenteditable there and a click places the caret.
  // A click that merely ENDS a drag-selection is not a click for this either.
  let _selected = null;
  function selectedRow() { return _selected; }
  function clearSelection() {
    if (_selected) _selected.classList.remove('selected');
    _selected = null;
  }

  function _onRowClick(e) {
    if (isEditing()) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const li = t.closest('section li');
    if (!li) { clearSelection(); return; }
    if (t.closest('.tag, .li-controls, .drag-handle, a')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (li !== _selected) {
      clearSelection();
      _selected = li;
      li.classList.add('selected');
    }
    // A click inside the open body moves the caret; it must not re-close it.
    if (t.closest('.li-detail')) return;
    const det = li.querySelector(':scope > details.li-detail');
    if (det) det.open = !det.open;
  }
  document.addEventListener('click', _onRowClick);

  // The legend's rows: whatever the build supplied, then ALWAYS the 'No stage'
  // row (PlanOrder.UNSET). That last one is not part of either vocabulary — it
  // is the absence of a stage, which every plan can have — so it is appended
  // here rather than emitted into plan-versions.json by two separate builds.
  function legendRows() {
    const rows = (_legend || []).filter(v => !PlanOrder.isUnset(v.token));
    return rows.concat([PlanOrder.UNSET]);
  }

  // Legend (token → meaning) so a compact tag like "p0.3" — or a bare grey chip
  // — is decodable. Inserted above the filter bar; styled by .plan-legend in
  // the shared docs.css, which floats it against the right margin on a wide
  // viewport and drops it inline below 1200px.
  //
  // Only shown when the build supplied plan-versions.json (the legend source);
  // a page without it has no vocabulary to explain and gets no legend, since a
  // lone 'No stage' row would explain nothing.
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
    // Label and link come from the legend's OWN payload (_legendMeta), not from
    // here. The website emits 'Roadmap' + the deployed site-roadmap URL, since
    // its tokens ARE that page's stages; a console emits 'Stage' and no href,
    // because the named ladder lives in a JSON file with no page to open. This
    // was hardcoded to the website's pair, which meant every console plan page
    // would have offered a link that resolves to nothing.
    //
    // A payload carrying NEITHER key is a plan-versions.json written before
    // those keys existed, and gets the old hardcoded pair back. This matters:
    // the shared shelf reaches a deployed site the moment the vault syncs,
    // while its plans/ files only change when the site is REBUILT, so for that
    // window the website is serving new renderer + old payload. Falling back
    // on 'href missing' alone would have been wrong in the other direction —
    // a console legend legitimately has a label and no href.
    const meta = ('label' in _legendMeta || 'href' in _legendMeta)
      ? _legendMeta : LEGACY_LEGEND;
    const href = meta.href;
    const label = document.createElement(href ? 'a' : 'span');
    label.className = 'plan-legend-label';
    label.textContent = (meta.label || 'Roadmap') + ':';
    if (href) {
      label.href = href;
      label.target = '_blank';
      label.rel = 'noopener';
    }
    el.appendChild(label);
    legendRows().forEach((v) => {
      const item = document.createElement('span');
      item.className = 'plan-legend-item';
      const chip = document.createElement('span');
      styleVersionEl(chip, 'tag', v.token);
      chip.textContent = PlanOrder.tokenLabel(v.token);
      const title = document.createElement('span');
      title.className = 'plan-legend-title';
      title.textContent = v.title || '';
      item.appendChild(chip);
      item.appendChild(title);
      el.appendChild(item);
    });
  }

  // Filter bar built from the canonical version order: All, one button per
  // version (positional colour class), then unset. Replaces any static buttons
  // in the page shell so the controls always match the roadmap.
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
      const b = mk(token, PlanOrder.tokenLabel(token), '');
      styleVersionEl(b, 'filter-btn', token);   // overwrites className → set state after
      b.dataset.filter = token;
      if (token === _activeFilter) b.classList.add('active');
    });
    // Last button = the 'No stage' filter. Labelled with its TOKEN, like every
    // other button here, so the legend row above decodes both alike.
    mk(PlanOrder.UNSET.token, PlanOrder.tokenLabel(PlanOrder.UNSET.token), 'unset')
      .classList.toggle('active', _activeFilter === PlanOrder.UNSET.token);
  }

  function filterItems(status) {
    if (status !== 'all' && status === _activeFilter) status = 'all';
    _activeFilter = status;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === status));
    document.querySelectorAll('li[data-status]').forEach(li => {
      li.classList.toggle('hidden', status !== 'all' && li.dataset.status !== status);
    });
  }

  function liAtPoint(x, y) {
    for (const li of document.querySelectorAll('section li')) {
      if (li === dragSrc) continue;
      const r = li.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return li;
    }
    return null;
  }

  function firstLiAbovePoint(x, y) {
    for (const ul of document.querySelectorAll(_hooks.dropTargetSelector)) {
      const firstLi = ul.querySelector(':scope > li');
      if (!firstLi || firstLi === dragSrc) continue;
      const ur = ul.getBoundingClientRect();
      const lr = firstLi.getBoundingClientRect();
      if (x >= ur.left && x <= ur.right && y >= ur.top && y < lr.top) return firstLi;
    }
    return null;
  }

  function emptyUlAtPoint(x, y) {
    for (const ul of document.querySelectorAll(_hooks.dropTargetSelector)) {
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
    newLi.dataset.status = PlanOrder.UNSET.token;
    li.parentNode.insertBefore(newLi, li.nextSibling);
    addHandle(newLi);
    const tag = document.createElement('span');
    tag.className = 'tag unset';
    tag.textContent = PlanOrder.tokenLabel(PlanOrder.UNSET.token);
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
    newLi.dataset.status = PlanOrder.UNSET.token;
    ul.appendChild(newLi);
    addHandle(newLi);
    const tag = document.createElement('span');
    tag.className = 'tag unset';
    tag.textContent = PlanOrder.tokenLabel(PlanOrder.UNSET.token);
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

  // ---- Save-path extraction ----
  // Entries whose text was cleared in the browser. Collected here rather than
  // returned, because extraction happens per-<ul> and the report is per-save.
  let _extractWarnings = [];
  function beginExtract() { _extractWarnings = []; }

  // Entries keyed to a page the STRUCTURE does not contain never render, so
  // the DOM cannot hand them back, and a Save rebuilt from the DOM drops them
  // without a word. Found 2026-08-25 by round-tripping site-entries.yaml: 61
  // leaves went in and 60 came out. The missing one hung off `page-synesthesia`,
  // an id no section in site-structure.yaml declares — so it had been invisible
  // and one Save away from gone since whenever that page was renamed or
  // dropped. Pre-dated the extractor being shared; caught only because the
  // round-trip was checked rather than assumed.
  //
  // Carried forward verbatim rather than repaired: an orphaned key is a real
  // question (was the page renamed, or the entry stranded?) and silently
  // re-homing it would be a second guess on top of the first. `plan_data_check`
  // is where orphans get reported; this just refuses to be the thing that
  // deletes them. Pass the doc AS LOADED — before any in-place mutation the
  // page does for rendering, or the legacy keys go back into the file.
  function carryForwardUnrendered(extracted, loaded) {
    Object.keys(loaded || {}).forEach(k => {
      if (!(k in extracted)) extracted[k] = loaded[k];
    });
    return extracted;
  }
  function extractWarnings() { return _extractWarnings.slice(); }

  // An li's visible number ('C.2.') for the warning, falling back to its
  // position — the entry has no text left to name it by, which is the point.
  function _liLabel(li) {
    const num = li.querySelector(':scope > .num');
    if (num && num.textContent.trim()) return num.textContent.trim();
    const sibs = li.parentNode ? [...li.parentNode.children] : [li];
    return 'item ' + (sibs.indexOf(li) + 1);
  }

  // Text of `el`, minus the nodes in `skip` and any nested .zh / .li-title.
  function _textExcept(el, skip) {
    let text = '';
    el.childNodes.forEach(n => {
      if (skip.indexOf(n) !== -1) return;
      if (n.nodeType === Node.TEXT_NODE) { text += n.textContent; return; }
      if (n.nodeType === Node.ELEMENT_NODE &&
          !n.classList.contains('zh') && !n.classList.contains('li-title')) {
        text += n.textContent;
      }
    });
    return text.trim();
  }

  // ONE extractor for both page styles (unified 2026-08-25). Before that each
  // had its own, and each dropped what the other kept: the site map's ignored
  // detail_en/detail_zh entirely, so a Save there would have silently deleted
  // any long body; the plan pages' ignored title_en/title_zh, which the site
  // map both reads and writes. Neither had bitten yet — no plan used `title`,
  // and only Origin's used `detail` — which is exactly what a latent
  // divergence looks like right up until it costs you a file.
  //
  // EMPTY ENTRIES ARE KEPT, not dropped (user decision 2026-08-25). An entry
  // whose text you cleared stays in the file and is named in the save report.
  // A row that silently disappears is the worse failure, and this path has
  // form: it once round-tripped every entry to an empty string (see AUTHORED
  // FIELD NAMES in plan-renderer.js). Deleting is what the ✕ button is for.
  function extractItemsFromUl(ul) {
    const items = [];
    ul.querySelectorAll(':scope > li').forEach(li => {
      const item = {};
      // `unset` is this module's name for a MISSING stage, never an authored
      // value: an entry with no stage saves with no `stage:` key, exactly as
      // it was written. Every li carries dataset.status (renderLeafItem tags
      // the stage-less ones), so without this guard a Save would stamp
      // `stage: unset` across every untagged entry in the file.
      if (li.dataset.status && !PlanOrder.isUnset(li.dataset.status)) {
        item.stage = li.dataset.status;
      }
      const textEl = li.querySelector(':scope > .li-text');
      if (textEl) {
        // DIRECT children only: an optional .li-title carries its own .zh, and
        // a descendant lookup would take that for the summary's.
        const titleEl = textEl.querySelector(':scope > .li-title');
        const zhEl = textEl.querySelector(':scope > .zh');
        item.summary_en = _textExcept(textEl, [zhEl, titleEl]);
        if (zhEl && zhEl.textContent.trim()) item.summary_zh = zhEl.textContent.trim();
        if (titleEl) {
          const tzh = titleEl.querySelector('.zh');
          const ten = _textExcept(titleEl, [tzh]);
          if (ten) item.title_en = ten;
          if (tzh && tzh.textContent.trim()) item.title_zh = tzh.textContent.trim();
        }
      }
      // detail_en/zh round-trip from their rendered (view-only) divs, so an
      // in-browser edit + save never drops a leaf's long-form body.
      const det = li.querySelector(':scope > details.li-detail');
      if (det) {
        const dEn = det.querySelector('.detail-en');
        const dZh = det.querySelector('.detail-zh');
        if (dEn) item.detail_en = dEn.textContent;
        if (dZh) item.detail_zh = dZh.textContent;
      }
      if (item.summary_en === undefined) return;   // not an entry row at all
      if (!item.summary_en && !item.summary_zh) _extractWarnings.push(_liLabel(li));
      items.push(item);
    });
    return items;
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
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


  // ---- Public surface ----
  window.PlanChrome = {
    configure, setLegend, legend, setVersionOrder, versionOrder, versionColor,
    activeFilter, beginExtract, extractWarnings, carryForwardUnrendered,
    selectedRow, clearSelection,
    styleVersionEl, buildTocOl, slugify, appendAddRow, escHtml,
    appendLinkedText, renumberLis, setLiNum, isEditing, sortList,
    toggleStatus, legendRows, buildLegend, buildFilterBar,
    filterItems, liAtPoint, firstLiAbovePoint, emptyUlAtPoint, onDragMove,
    onDragEnd, addHandle, dropZone, showIndicator, doMove, clearIndicators,
    addControls, moveLi, addBelow, deleteLi, addItemToSection,
    addSectionControls, wrapLiText, applyEditables, removeEditables,
    toggleEdit, extractItemsFromUl, downloadFile, updateZhBreaks,
    onTocSearch, tocToggleAll
  };

  // Handlers the page shells call from inline onclick / oninput attributes, and
  // the per-item buttons addControls wires up. Attached here rather than by each
  // host, so a page gets them simply by loading this file.
  window._appPlan = { moveLi, addBelow, deleteLi };
  window.toggleEdit = toggleEdit;
  window.filterItems = filterItems;
  window.onTocSearch = onTocSearch;
  window.tocToggleAll = tocToggleAll;

  // Chinese lines wrap differently at different widths; re-measure on resize.
  let _zhResizeTimer;
  window.addEventListener('resize', () => {
    if (!_hooks.zhBreaks) return;
    clearTimeout(_zhResizeTimer);
    _zhResizeTimer = setTimeout(updateZhBreaks, 120);
  });
})();
