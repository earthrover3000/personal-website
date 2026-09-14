// plan-counts.js — how many entries each plan on a console index holds.
//
// A console's rows are plan pages, and a plan page fills itself at runtime
// from the plan store (/plan-data/, the same YAML the terminal Planner
// writes). A count baked in at build time would drift from the page it
// opens the moment an entry was added, so this reads the same store the
// page does: every `a[data-plan-id]` on the page fetches its two authored
// halves, counts the leaves, and stamps the total as `data-count` for
// index.css to draw (user decision 2026-09-15 — counts on the consoles and
// plan pages, not on the Planning Hub's own rows).
//
// COUNTING RULE. Anything carrying an `entries` list is a container and
// contributes nothing itself; everything else is a leaf. That is the one
// rule the plan renderer (PlanOrder.isSubgroup) and the Overnight view walk
// by, so a titled sub-group under a page is a heading here too, never an
// entry. The dev half is {sections: [...]} and the entries half is
// {pageId: [...]}; both nest the same way below that.
//
// The total, not the filtered view: an index has no stage filter, so the
// page's own live count and this one agree whenever the page opens on All.
//
// BEST-EFFORT BY CONTRACT. A 404 (a plan whose halves were never stamped,
// or a vault that is locked), an offline machine (js-yaml comes off a CDN,
// as on every plan page) and a missing PLAN_DATA_BASE all leave the row as
// it was — the row is the door; the count is a courtesy beside it.
//
// Inlined by index_page.generate_index_html when a caller passes
// `plan_data_base` (which it stamps as window.PLAN_DATA_BASE just above),
// the way theme-init.js and page-nav.js are — one source, no depth-aware
// script paths on the consoles.
(function () {
  'use strict';
  const base = window.PLAN_DATA_BASE;
  const rows = document.querySelectorAll('a[data-plan-id]');
  if (!base || !window.jsyaml || !rows.length) return;

  function leaves(node) {
    if (Array.isArray(node)) return node.reduce((n, x) => n + leaves(x), 0);
    if (!node || typeof node !== 'object') return 0;
    if (Array.isArray(node.entries)) return leaves(node.entries);
    return 1;
  }

  async function half(id, kind) {
    try {
      const res = await fetch(base + id + '-' + kind + '.yaml');
      if (!res.ok) return null;
      const doc = window.jsyaml.load(await res.text());
      return doc && typeof doc === 'object' ? doc : null;
    } catch (e) {
      return null;
    }
  }

  async function count(id) {
    let n = 0;
    const dev = await half(id, 'dev');
    // A dev section is a container whether or not it has entries yet — a
    // section with no `entries:` key is empty, not a leaf.
    if (dev) (dev.sections || []).forEach(s => { n += leaves((s && s.entries) || []); });
    const entries = await half(id, 'entries');
    if (entries) Object.keys(entries).forEach(k => { n += leaves(entries[k]); });
    return n;
  }

  rows.forEach(async a => {
    const n = await count(a.dataset.planId);
    if (n) a.dataset.count = n;
  });
})();
