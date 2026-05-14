// auto-toc.js — shared search bar + table-of-contents wiring.
//
// Two responsibilities, dispatched from DOM structure (no per-page opt-in):
//
//  1. Content pages with ≥2 <h2> direct children of .container:
//     - Auto-injects <input class="filter"> + <nav class="toc"> right
//       after .head-meta (or h1 if no head-meta).
//     - Builds the TOC as a numbered list of h2 anchors.
//     - Wires the filter to hide TOC items whose text doesn't match.
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
    // heading words and prepend our own monotonic index.
    list.innerHTML = '';
    var idx = 0;
    h2s.forEach(function (h) {
      idx++;
      var orig = h.textContent.trim();
      if (!h.id) h.id = slugify(orig);
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = idx + '. ' + orig;
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
