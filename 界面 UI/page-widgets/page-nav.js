// page-nav.js — shared in-page search + navigation wiring (was auto-toc.js).
//
// Two responsibilities, dispatched from DOM structure (no per-page opt-in):
//
//  1. Content pages with ≥2 <h2> direct children of .container:
//     - Auto-injects <input class="filter"> + <nav class="toc"> right
//       after .head-meta (or h1 if no head-meta).
//     - Builds the TOC as a numbered list of h2 anchors.
//     - Wires the filter to hide TOC items whose text doesn't match.
//     - Collapses every section by default (site convention, user decision
//       2026-08-15: any page with a Contents nav starts with its sections
//       closed; this file is the SSOT for that behaviour). The h2 headings
//       become toggles, TOC links / URL hashes expand their target, and a
//       Expand-all button sits in the TOC header. Collapsing is done by
//       classing each element BETWEEN h2s (never re-parenting — pages
//       style via `.container > ul` etc. and a wrapper div would orphan
//       them) with height:0/overflow:hidden/visibility:hidden rather than
//       display:none, so embedded widgets (Leaflet maps, canvas engines)
//       still measure real layout widths while hidden. Expanding a section
//       dispatches a bubbling 'section-expanded' event on its h2 (pages
//       use it to lazy-init heavy widgets) plus a window resize (Leaflet's
//       trackResize picks it up).
//     If the page already includes the markup (e.g. chinese-languages
//     used to inline it), it is reused rather than re-injected.
//
//  2. Index pages (.container > .row > .main, with the build's existing
//     <input class="filter"> above the row):
//     - Wires that input to filter the index entries (.app-card cards
//       AND .main > ul > li bare-link rows).
//
// Activate by linking this file from a page's <head>; the script
// auto-runs on DOMContentLoaded. No globals leaked beyond what was
// already there.

(function () {
  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // ---- Collapsed-by-default sections --------------------------------
  // Styles are injected here (not base.css) so the whole convention —
  // behaviour + look — lives in this one file.
  var COLLAPSE_STYLE_ID = '__page-nav-collapse-styles';
  function injectCollapseStyles() {
    if (document.getElementById(COLLAPSE_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = COLLAPSE_STYLE_ID;
    style.textContent =
      // Collapsed section members: zero the box but keep layout widths
      // measurable (see header comment). !important intentionally beats
      // page-level margin/padding rules.
      '.pn-collapsed { visibility:hidden !important; height:0 !important;' +
      '  min-height:0 !important; margin:0 !important; padding:0 !important;' +
      '  border-width:0 !important; overflow:hidden !important; }' +
      // h2 toggles: pointer + a right-aligned ▸/▾ marker, mirroring the
      // .toc summary markers in base.css.
      'h2.pn-toggle { cursor:pointer; }' +
      'h2.pn-toggle::after { content:"\\25B8"; float:right; color:var(--muted); font-size:0.8em; }' +
      'h2.pn-toggle[aria-expanded="true"]::after { content:"\\25BE"; }';
    document.head.appendChild(style);
  }

  // Elements belonging to a section: everything after its h2 up to the
  // next direct-child h2 (or the end of the container).
  function sectionMembers(h2) {
    var els = [];
    for (var el = h2.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
      els.push(el);
    }
    return els;
  }

  function isCollapsed(h2) {
    return h2.getAttribute('aria-expanded') !== 'true';
  }

  function setCollapsed(h2, collapsed) {
    sectionMembers(h2).forEach(function (el) {
      el.classList.toggle('pn-collapsed', collapsed);
    });
    h2.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) {
      // Pages lazy-init heavy widgets on this; Leaflet maps built while
      // hidden fix themselves via their window-resize listener.
      h2.dispatchEvent(new CustomEvent('section-expanded', { bubbles: true }));
      window.dispatchEvent(new Event('resize'));
    }
  }

  function buildToc(container) {
    // Direct h2 children only — nested h2s (e.g. inside <details>) don't
    // earn TOC entries; they belong to whatever section wraps them.
    var h2s = container.querySelectorAll(':scope > h2');
    // 2+ h2s warrants a TOC. A single-section page is its own TOC.
    if (h2s.length < 2) return;

    // Reuse existing markup if present (chinese-languages legacy pattern),
    // otherwise inject. Pre-placed markup may be hidden via inline style;
    // we clear it after populating.
    var search = container.querySelector(':scope > input.filter');
    var injectedSearch = false;
    if (!search) {
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'filter';
      search.placeholder = 'Search…';
      search.setAttribute('aria-label', 'Filter sections');
      injectedSearch = true;
    }
    var toc = container.querySelector(':scope > nav.toc');
    var injectedToc = false;
    if (!toc) {
      toc = document.createElement('nav');
      toc.className = 'toc';
      var header = document.createElement('div');
      header.className = 'toc-header';
      var h2c = document.createElement('h2');
      h2c.textContent = 'Contents';
      header.appendChild(h2c);
      toc.appendChild(header);
      var ol = document.createElement('ol');
      toc.appendChild(ol);
      injectedToc = true;
    }
    var list = toc.querySelector('ol') || toc.querySelector('ul');
    if (!list) return;

    // Populate. textContent excludes ::before-rendered counters (e.g. the
    // page-side .container > h2::before "1. " prefix) so we get just the
    // heading words and prepend our own monotonic index. h2.appendix
    // sections (the {{EXTERNAL_LINKS}} link lists) letter as A. B. …
    // instead, mirroring base.css's on-page prefixes.
    list.innerHTML = '';
    var idx = 0, appendixIdx = 0;
    h2s.forEach(function (h) {
      var orig = h.textContent.trim();
      if (!h.id) h.id = slugify(orig);
      var label = h.classList.contains('appendix')
        ? String.fromCharCode(65 + (appendixIdx++ % 26))
        : String(++idx);
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = label + '. ' + orig;
      li.appendChild(a);
      list.appendChild(li);
    });

    // Place injected nodes: head-meta → search → toc → first h2.
    if (injectedSearch || injectedToc) {
      var anchor = container.querySelector(':scope > p.head-meta')
        || container.querySelector(':scope > h1');
      if (anchor) {
        if (injectedSearch) anchor.insertAdjacentElement('afterend', search);
        var searchEnd = injectedSearch ? search : anchor;
        if (injectedToc) searchEnd.insertAdjacentElement('afterend', toc);
      }
    }
    // Reveal anything that was pre-rendered hidden.
    if (search.style.display === 'none') search.style.display = '';
    if (toc.style.display === 'none') toc.style.display = '';

    search.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      list.querySelectorAll('li').forEach(function (li) {
        if (!q) { li.classList.remove('search-hidden'); return; }
        li.classList.toggle('search-hidden', li.textContent.toLowerCase().indexOf(q) === -1);
      });
    });

    // ---- Collapse sections by default -------------------------------
    injectCollapseStyles();

    // Expand-all / Collapse-all in the TOC header (styles for
    // .toc-controls/.toc-toggle-btn already live in base.css). Pre-placed
    // TOC markup may lack a header; skip the button there.
    var headerEl = toc.querySelector('.toc-header');
    var allBtn = null;
    function syncAllBtn() {
      if (!allBtn) return;
      var anyCollapsed = false;
      h2s.forEach(function (h) { if (isCollapsed(h)) anyCollapsed = true; });
      allBtn.textContent = anyCollapsed ? 'Expand all' : 'Collapse all';
    }
    if (headerEl && !headerEl.querySelector('.toc-toggle-btn')) {
      var controls = document.createElement('div');
      controls.className = 'toc-controls';
      allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'toc-toggle-btn';
      controls.appendChild(allBtn);
      headerEl.appendChild(controls);
      allBtn.addEventListener('click', function () {
        var expand = allBtn.textContent === 'Expand all';
        h2s.forEach(function (h) { setCollapsed(h, !expand); });
        syncAllBtn();
      });
    }

    // Every h2 becomes a keyboard-reachable toggle, starting collapsed.
    h2s.forEach(function (h) {
      h.classList.add('pn-toggle');
      h.tabIndex = 0;
      function toggle() { setCollapsed(h, !isCollapsed(h)); syncAllBtn(); }
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      setCollapsed(h, true);
    });
    syncAllBtn();

    // Navigating to #some-section (TOC click, external link, page load
    // with a hash) expands the target. The load-time call re-scrolls too:
    // the browser's native hash scroll happened before we collapsed
    // everything, so the position it picked is stale.
    function expandHashTarget(scroll) {
      var id = decodeURIComponent((location.hash || '').slice(1));
      if (!id) return;
      var h = document.getElementById(id);
      if (!h || h.tagName !== 'H2' || h.parentElement !== container) return;
      if (isCollapsed(h)) { setCollapsed(h, false); syncAllBtn(); }
      if (scroll) h.scrollIntoView();
    }
    window.addEventListener('hashchange', function () { expandHashTarget(false); });
    // Same-hash TOC clicks fire no hashchange — expand from the click too.
    list.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var h = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      if (h && isCollapsed(h)) { setCollapsed(h, false); syncAllBtn(); }
    });
    expandHashTarget(true);
  }

  function wireIndexSearch(container) {
    // Build.py emits: <input class="filter" ...> above <div class="row">
    // <div class="main"> with .app-card / <ul><li> entries.
    var filter = container.querySelector(':scope > input.filter');
    if (!filter) return;
    var main = container.querySelector('.row > .main');
    if (!main) return;
    var targets = main.querySelectorAll('.app-card, ul > li');
    if (!targets.length) return;
    filter.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      targets.forEach(function (t) {
        if (!q) { t.classList.remove('search-hidden'); return; }
        t.classList.toggle('search-hidden', t.textContent.toLowerCase().indexOf(q) === -1);
      });
    });
  }

  function init() {
    var container = document.querySelector('.container');
    if (!container) return;
    // Index pages have the row-and-main layout; content pages don't.
    if (container.querySelector(':scope > .row > .main')) {
      wireIndexSearch(container);
    } else {
      buildToc(container);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
