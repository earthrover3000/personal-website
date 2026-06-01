// Shared status-line builder for the docs pages (app-plan.js + site-map.html).
// Single source of truth for the "N lines · M words · K 字 📊" head and the
// link that wraps the whole row and points at site-stats. The Python index
// pages build the same string at build time in site_shell/indexes.py — keep
// the two formats in sync (different runtimes, can't share the literal code).
//
// Counts: lines = source-code lines; words = English words in prose;
// 字 = Chinese (Han) characters in prose. Words and 字 are mutually exclusive.
(function (global) {
  // Build the fixed-position head: counts joined by middle dots (one count,
  // several facets) with the 📊 marker last, so the head sits at the same left
  // position regardless of whatever variable text a caller appends after it.
  // Falsy/zero counts are skipped. Returns '' when there is nothing to show.
  function head(lines, words, chars) {
    const parts = [];
    if (lines) parts.push(lines.toLocaleString() + ' lines');
    if (words) parts.push(words.toLocaleString() + ' words');
    if (chars) parts.push(chars.toLocaleString() + ' 字');
    if (!parts.length) return '';
    return parts.join(' · ') + ' 📊';
  }

  // Wrap one or more top-level segments (the head, then any extras like
  // "X/Y built") in a single anchor to site-stats, so the whole row is one tap
  // target. Segments are joined by ✦ to mark the stronger break between them.
  // Returns an <a> element, or null when there is nothing to render.
  //
  // The site-stats href is derived from the current URL: everything before
  // '/contents/' is the project base. Robust against a missing trailing slash
  // and sub-path deployments (e.g. GitHub Pages '/personal-website/...').
  function link(segments) {
    const text = (segments || []).filter(Boolean).join(' ✦ ');
    if (!text) return null;
    const path = global.location.pathname;
    const m = path.match(/^(.*)\/contents\//);
    const projectBase = m ? m[1] : '';
    const a = global.document.createElement('a');
    a.href = projectBase + '/contents/pages/private/site-stats/';
    a.title = 'View site-stats';
    a.textContent = text;
    return a;
  }

  global.StatusLine = { head: head, link: link };
})(window);
