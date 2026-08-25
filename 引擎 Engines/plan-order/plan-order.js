// plan-order — the single source of truth for how plan pages are ORDERED and
// NUMBERED. Pure logic, no DOM: runs in the browser (site-map.html and
// plan-renderer.js load it as a <script>, picking up `window.PlanOrder`) and in
// Node (the launchpad's plan manager runs it via plan-order/cli.js). Whoever
// renders the plan — browser or terminal — gets identical order and numbers
// because they all call this one file.
//
// What lives here (and ONLY here):
//   - compareVersion               : entries sort by roadmap version ascending
//                                    (0.3 < 0.4 < 1.0 < 1.+ < unset). Intrinsic —
//                                    parses the version itself, so there is no
//                                    rank table to maintain and the order stays
//                                    correct as the roadmap advances.
//   - tokenLabel / stageClass      : how a status is PRINTED (versions
//                                    verbatim, ladder words capitalised) and
//                                    which CSS hook it takes. Display only —
//                                    stored values stay lowercase.
//   - UNSET / isUnset              : the name for an entry with NO stage.
//                                    stages.json's `unset` key, mirrored here;
//                                    not a rung of the ladder but the absence
//                                    of one, so it holds on the website's
//                                    version axis too.
//   - leafSorted                   : a folder whose children are ALL leaves is
//                                    sorted by label (site map); mixed folders
//                                    keep declared order. App plans pass
//                                    leafSort:false (manifest order is curated).
//   - headingNumber / itemNumber / numberSection : the hierarchical numbering
//                                    ("2.1.3.") — exactly what the pages' old
//                                    renumberLis computed, now in one place.
//   - buildModel : walk structure + entries + dev in render order and return a
//                  flat list of numbered rows. Non-DOM consumers (the launchpad)
//                  render straight from this; the browser keeps its own DOM
//                  rendering but borrows the rules above.
//
// Render order (mirrors the pages): the Development section is always #1, then
// the structure sections in document order. Within a page, its own entries come
// first, then sub-pages. Entries are status-sorted before numbering. A page
// whose entries are ALL sub-groups ({title, entries}) renders each sub-group as
// its own numbered heading (leaves and sub-groups never mix in one page).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanOrder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A status is a roadmap version token with an optional one-letter prefix from
  // the roadmap stage word ("p0.3" = Phase 0.3, "v1.0" = Version 1.0, "1.+").
  // Parse into { major, minor } with "+" as an open-ended highest minor (so
  // "1.+" follows "1.0"); the prefix is ignored for ordering. Anything that
  // isn't a version — including "unset"/missing — is null and sorts last.
  function parseVersion(s) {
    if (s == null) return null;
    var m = String(s).trim().match(/^[a-z]*(\d+)\.(\d+|\+)$/i);
    if (!m) return null;
    return { major: parseInt(m[1], 10), minor: m[2] === '+' ? Infinity : parseInt(m[2], 10) };
  }

  // The NAMED stage ladder, for the plans that are not the website's. The
  // source is stages.json beside this file, which carries the reasoning; the
  // ranks are mirrored here as a literal because this module is loaded as a
  // bare <script> in the browser, with no fetch available at parse time.
  // `planStages()` below returns the same list for callers that render it,
  // and `plan_data_check` reads stages.json to keep the two honest.
  //
  // Ranked BELOW every version token deliberately: a plan tagged to a roadmap
  // milestone is scheduled against a DATE, one tagged `now` against
  // ATTENTION. Nothing mixes the two today; if a page ever does, dated work
  // sorts first.
  var STAGE_RANK = { now: 0, next: 1, later: 2 };

  function stageRank(s) {
    if (s == null) return null;
    var k = String(s).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STAGE_RANK, k) ? STAGE_RANK[k] : null;
  }

  // Compare two statuses ascending (earlier milestone first): version tokens
  // among themselves, then the named ladder, then unset/unknown last. The
  // version half is INTRINSIC — it parses the number, so it needs no table and
  // stays correct as the roadmap advances. The named half needs one, because
  // "now" only precedes "later" by fiat.
  //
  // Before 2026-08-24 there was no named half: every word parsed to null and
  // sorted last, so `investigate` / `planned` / `on-hold` were priority labels
  // that carried no priority. This arm is what fixes that.
  function compareVersion(a, b) {
    var va = parseVersion(a), vb = parseVersion(b);
    if (va && vb) {
      if (va.major !== vb.major) return va.major - vb.major;
      if (va.minor === vb.minor) return 0;
      return va.minor - vb.minor;
    }
    if (va) return -1;             // any version outranks any named stage
    if (vb) return 1;
    var sa = stageRank(a), sb = stageRank(b);
    if (sa != null && sb != null) return sa - sb;
    if (sa != null) return -1;     // a known stage outranks unset/unknown
    if (sb != null) return 1;
    return 0;
  }

  // The ladder as [{token, title}] — the SAME shape the website's
  // plans/plan-versions.json uses, so one legend renderer serves both. The
  // console builds serialise this to that filename; the terminal plan
  // manager offers it as the token picker's choices.
  function planStages() {
    return [
      { token: 'now', title: 'In progress' },
      { token: 'next', title: 'Up next' },
      { token: 'later', title: 'Not scheduled' },
    ];
  }

  // The name for an entry that has NO stage — stages.json's `unset` key, which
  // is deliberately NOT a rung of the ladder above: it is the absence of a
  // decision rather than one of them, so it applies to the website's version
  // axis too, which the ladder does not. Mirrored here as a literal for the
  // same reason STAGE_RANK is — this module loads as a bare <script>, with no
  // fetch available at parse time.
  //
  // The TOKEN is not new. plan-renderer.js has keyed the neutral tag chrome,
  // the 'unset' filter button and the first step of its click-cycle off it
  // since the filter bar existed. Only the TITLE is, and having one is what
  // lets a stage-less entry carry a visible tag instead of rendering as a bare
  // untagged line that the 'unset' filter could never match.
  var UNSET = { token: 'unset', title: 'No stage' };

  // Is this status the absence of one? Missing, empty and the literal token all
  // answer yes, so callers stop spelling `s || 'unset'` three different ways.
  function isUnset(s) {
    return s == null || String(s).trim() === '' ||
           String(s).trim().toLowerCase() === UNSET.token;
  }

  // How a status is PRINTED, as against stored. Version tokens go out verbatim
  // — 'p0.4' is a name, and 'P0.4' would be a different one — while the named
  // ladder's words take an initial capital (user decision 2026-08-25). The
  // filter bar is where the old inconsistency showed worst: a row reading
  // 'All  now  next  later  unset', capitalised on exactly one button.
  // Display only. `stage:` in the YAML, li.dataset.status and every comparison
  // stay lowercase, so nothing that MATCHES a status has to know about this.
  function tokenLabel(t) {
    var s = t == null ? '' : String(t);
    if (!s || parseVersion(s)) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // CSS hook for a rung of the named ladder — 'stage-now' — and null for
  // anything that is not one (a version token, or no stage at all).
  //
  // Named stages get a FIXED palette in docs.css rather than a computed hue,
  // and the split is not arbitrary: versions are an open series whose members
  // arrive and retire, so their colours are generated by relative position
  // (versionColors); the ladder is three fixed words with fixed meanings, so
  // theirs can be authored and stay put. The scheme restores the one the
  // Personal Apps App List carried before the shared docs.css went
  // version-colours-only — teal for `next` is that page's own teal.
  function stageClass(t) {
    return stageRank(t) == null ? null : 'stage-' + String(t).trim().toLowerCase();
  }

  // Stable version sort that remembers each entry's original index, so callers
  // that mutate the underlying file (the launchpad) can map a displayed entry
  // back to its real position. Returns [{ item, srcIndex }].
  function sortedEntries(list) {
    var arr = (list || []).map(function (it, i) { return { item: it, srcIndex: i }; });
    arr.sort(function (a, b) {
      var d = compareVersion(a.item && a.item.status, b.item && b.item.status);
      return d !== 0 ? d : a.srcIndex - b.srcIndex;   // stable
    });
    return arr;
  }

  // Two colour series for the (at most two) major versions in play — by the time
  // a 2.x exists every 0.x is done, so only two majors are ever shown together.
  // Series are assigned by RELATIVE position (lower major = series 0); within a
  // series the hue steps slightly across members so related versions stay one
  // family yet read as distinct. Returns { token: 'hsl(…)' }. Pure logic, no DOM.
  var VERSION_SERIES = [
    { h0: 212, h1: 260 },   // lower major  — blue → indigo
    { h0: 38,  h1: 6 },     // higher major — amber → red-orange
  ];
  function versionColors(tokens) {
    var out = {};
    var majorOf = function (t) { var p = parseVersion(t); return p ? p.major : null; };
    var majors = [];
    (tokens || []).forEach(function (t) {
      var m = majorOf(t); if (m !== null && majors.indexOf(m) < 0) majors.push(m);
    });
    majors.sort(function (a, b) { return a - b; });
    majors.forEach(function (maj, gi) {
      var s = VERSION_SERIES[gi % VERSION_SERIES.length];
      var grp = tokens.filter(function (t) { return majorOf(t) === maj; });
      var K = grp.length;
      grp.forEach(function (tok, i) {
        var h = (K <= 1) ? s.h0 : s.h0 + i * (s.h1 - s.h0) / (K - 1);
        out[tok] = 'hsl(' + Math.round(h) + ', 68%, 48%)';
      });
    });
    return out;
  }

  function isLeaf(p) { return !p || !p.pages || !p.pages.length; }

  function leafSorted(pages) {
    if (!pages || !pages.length) return pages || [];
    if (!pages.every(isLeaf)) return pages;           // mixed: keep declared order
    return pages.slice().sort(function (a, b) {
      var ka = (a && (a.label || a.title)) || '';
      var kb = (b && (b.label || b.title)) || '';
      return String(ka).localeCompare(String(kb));
    });
  }

  // The single naming rule for a node: prefer the human label; fall back to the
  // path/title only when there's no label (intermediate tier folders like
  // "./public/"), and to the id as a last resort. So end-level project folders
  // read "Bracelet Database", not "./public/experiments/bracelet-database/".
  function displayName(node) {
    if (node && node.label) return String(node.label);
    if (node && node.title != null) return String(node.title);
    return (node && node.id != null) ? String(node.id) : '';
  }

  function isSubgroup(it) {
    return it && typeof it === 'object' && it.entries && it.title;
  }
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // Bilingual fields are symmetric `<base>_en/_zh/_raw` trios. These resolve one
  // onto the normalized display model, reading the new keys first and falling
  // back to the pre-migration keys (entries: text/zh; folders: description/
  // description_zh) so a not-yet-migrated plan still renders. `enOf` folds the
  // untranslated `_raw` in as a last resort, so an offline-staged entry shows its
  // text instead of a blank line. See plan/translate.py for the write side.
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v != null && v !== '') return String(v);
    }
    return null;
  }
  // `enOf(o, base, ...legacyKeys)` — new `_en` first, then each legacy key in
  // order (a field renamed twice carries a chain), then the base's own `_raw`.
  function enOf(o, base) {
    var vals = [o[base + '_en']];
    for (var i = 2; i < arguments.length; i++) vals.push(o[arguments[i]]);
    vals.push(o[base + '_raw']);
    return pick.apply(null, vals);
  }
  function zhOf(o, base) {
    var vals = [o[base + '_zh']];
    for (var i = 2; i < arguments.length; i++) vals.push(o[arguments[i]]);
    return pick.apply(null, vals);
  }
  function rawOf(o, base) { return pick(o[base + '_raw']); }

  // A mnemonic UPPERCASE letter for a top-level section, from its title:
  // first letters of words first (Infrastructure → I, Developer Docs → D), then
  // any other letter, then A–Z; `taken` (mutated) keeps them unique in order. So
  // sections read I, D, F, P, U and sub-levels stay digits (I.1, I.1.1).
  function sectionLetter(title, taken) {
    var t = String(title || '');
    var cands = [];
    t.split(/\s+/).forEach(function (w) {
      var m = w.match(/[A-Za-z]/);
      if (m) { var u = m[0].toUpperCase(); if (cands.indexOf(u) < 0) cands.push(u); }
    });
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (/[A-Za-z]/.test(c)) { c = c.toUpperCase(); if (cands.indexOf(c) < 0) cands.push(c); }
    }
    for (var z = 0; z < 26; z++) {
      var L = String.fromCharCode(65 + z);
      if (cands.indexOf(L) < 0) cands.push(L);
    }
    for (var k = 0; k < cands.length; k++) {
      if (taken.indexOf(cands[k]) < 0) { taken.push(cands[k]); return cands[k]; }
    }
    return '?';
  }

  // ---- numbering primitives (shared by buildModel and the browser renumber) --
  // counters[0] is the section number; counters[1..4] track h3..h6. A heading at
  // level L bumps counters[L-2], clears deeper levels, and becomes the active
  // depth; an item appends its 1-based position to the counters up to that depth.
  function headingNumber(counters, level) {
    var idx = level - 2;
    counters[idx]++;
    for (var i = idx + 1; i < 5; i++) counters[i] = 0;
    return { activeDepth: idx, number: counters.slice(0, idx + 1).join('.') };
  }
  function itemNumber(counters, activeDepth, li) {
    return counters.slice(0, activeDepth + 1).concat([li]).join('.') + '.';
  }

  // DOM-free numbering for one section, used by the browser's renumber after
  // edits. `seq` is the rendered order as { h: level } (a heading) or { u: n }
  // (a list of n items). Returns one result per step: { h, number } for a
  // heading, { u, numbers: [...] } for a list.
  function numberSection(sectionNumber, seq) {
    var counters = [sectionNumber, 0, 0, 0, 0];
    var activeDepth = 0;
    return (seq || []).map(function (step) {
      if (step.h != null) {
        var r = headingNumber(counters, step.h);
        activeDepth = r.activeDepth;
        return { h: step.h, number: r.number };
      }
      var nums = [];
      for (var li = 1; li <= step.u; li++) nums.push(itemNumber(counters, activeDepth, li));
      return { u: step.u, numbers: nums };
    });
  }

  // ---- the model -----------------------------------------------------------
  // Which entries-doc key holds a page's entries. SUBVIEWS — third-level
  // nodes (section › page › subview, e.g. compass › wheel › orbiter) — are
  // keyed `<parentPageId>.<subviewId>` per the entries yaml's documented
  // namespacing (the dotted form disambiguates duplicate subview ids across
  // pages); levels 1–2 key bare. Prefer whichever key the doc actually
  // contains (dotted first at subview depth) so legacy bare keys keep
  // resolving; a NEW subview list is created under the dotted key. This is
  // THE lookup both consumers use (buildModel below + plan-renderer.js) —
  // it regressed silently when the structure emitter moved to bare node ids
  // (dotted keys stopped matching anything; restored 2026-08-19).
  // `pageDepth`: 1 = a section's direct page, 2 = its child, 3+ = subviews.
  function entriesKeyFor(entriesDoc, pageId, parentPageId, pageDepth) {
    var dotted = parentPageId ? parentPageId + '.' + pageId : null;
    if (pageDepth >= 3 && dotted) {
      if (entriesDoc && entriesDoc[dotted] !== undefined) return dotted;
      if (entriesDoc && entriesDoc[pageId] !== undefined) return pageId;
      return dotted;
    }
    return pageId;
  }

  function buildModel(opts) {
    opts = opts || {};
    var structure = opts.structure || {};
    var entries = opts.entries || {};
    var dev = opts.dev || { sections: [] };
    var devTitle = opts.devTitle || '🔧 Development';
    var doLeafSort = !!opts.leafSort;

    var rows = [];
    // Top-level sections are lettered by a mnemonic of their title (see
    // sectionLetter) so a section's press key is a memorable letter and
    // sub-levels stay digits — e.g. I, I.1, I.1.1. headingNumber/itemNumber
    // never touch counters[0], so a letter there is safe.
    var sectionTaken = [];

    function clamp(level) { return Math.max(3, Math.min(level, 6)); }

    // Emit status-sorted leaf entries under the current heading context.
    function emitEntries(list, ctx, where) {
      sortedEntries(list).forEach(function (rec, i) {
        var it = rec.item || {};
        rows.push({
          type: 'entry',
          number: itemNumber(ctx.counters, ctx.activeDepth, i + 1),
          status: pick(it.stage, it.status),   // roadmap stage token (was `status`)
          title: enOf(it, 'title'),            // optional short title (English)
          title_zh: zhOf(it, 'title'),
          text: enOf(it, 'summary', 'text_en', 'text') || '',   // the line (was `text`)
          zh: zhOf(it, 'summary', 'text_zh', 'zh'),
          raw: rawOf(it, 'summary'),
          depth: ctx.activeDepth + 1,
          doc: where.doc,
          ownerKind: where.ownerKind,
          ownerKey: where.ownerKey,
          parentId: where.parentId != null ? where.parentId : null,
          subgroupIndex: where.subgroupIndex != null ? where.subgroupIndex : null,
          devIndex: where.devIndex != null ? where.devIndex : null,
          srcIndex: rec.srcIndex,
        });
      });
    }

    // Mirror renderEntriesFor: all-sub-groups vs leaves (never mixed). Returns
    // true if the node turned out to be a sub-group parent (so it can't take a
    // bare leaf — the launchpad targets its sub-groups instead).
    function emitEntriesFor(nodeId, ctx, headingLevel, headingRow) {
      var items = entries[nodeId];
      if (!Array.isArray(items)) return false;
      var subs = items.filter(isSubgroup);
      if (subs.length === items.length && subs.length > 0) {
        if (headingRow) headingRow.subgroupParent = true;
        var subLevel = clamp(headingLevel + 1);
        items.forEach(function (g, gi) {
          if (!isSubgroup(g)) return;
          var hn = headingNumber(ctx.counters, subLevel);
          ctx.activeDepth = hn.activeDepth;
          rows.push({
            type: 'subgroup', level: subLevel, number: hn.number,
            id: g.id || (nodeId + '-' + slugify(g.title)), title: String(g.title),
            depth: hn.activeDepth, doc: 'entries', ownerKind: 'subgroup',
            ownerKey: nodeId, parentId: nodeId, subgroupIndex: gi,
            description: enOf(g, 'desc', 'description'), description_zh: zhOf(g, 'desc', 'description_zh'),
          });
          emitEntries(g.entries || [], ctx, {
            doc: 'entries', ownerKind: 'subgroup', ownerKey: nodeId,
            parentId: nodeId, subgroupIndex: gi,
          });
        });
        return true;
      }
      emitEntries(items, ctx, { doc: 'entries', ownerKind: 'node', ownerKey: nodeId });
      return false;
    }

    function walkPage(page, ctx, level, parentPageId, pageDepth) {
      // site-map.html drives the heading tag from each page's explicit `level`
      // field; app plans (no `level`) use positional depth. Honoring `level`
      // when present matches both renderers exactly.
      var L = clamp(page.level != null ? page.level : level);
      var hn = headingNumber(ctx.counters, L);
      ctx.activeDepth = hn.activeDepth;
      // The RESOLVED entries key (bare, or dotted for subviews — see
      // entriesKeyFor above) is what ownerKey carries, so the launchpad's
      // add/edit/delete/move write to the same list this walk read.
      var key = entriesKeyFor(entries, page.id, parentPageId, pageDepth);
      var row = {
        type: 'page', level: L, number: hn.number,
        id: page.id, title: String(page.title != null ? page.title : page.id),
        label: page.label || null, depth: hn.activeDepth,
        doc: 'entries', ownerKind: 'node', ownerKey: key,
        description: enOf(page, 'desc', 'description'), description_zh: zhOf(page, 'desc', 'description_zh'),
        status: pick(page.stage, page.status), subgroupParent: false,
      };
      rows.push(row);
      emitEntriesFor(key, ctx, L, row);
      var kids = doLeafSort ? leafSorted(page.pages) : (page.pages || []);
      kids.forEach(function (c) { walkPage(c, ctx, L + 1, page.id, pageDepth + 1); });
    }

    // ---- Development section (first) ----------------------------------------
    var devKey = sectionLetter(devTitle, sectionTaken);
    rows.push({
      type: 'devSection', level: 2, number: devKey,
      id: 'dev', title: devTitle, doc: 'dev', ownerKind: 'devHeader',
      subgroupParent: false,
    });
    var devCtx = { counters: [devKey, 0, 0, 0, 0], activeDepth: 0 };
    ((dev && dev.sections) || []).forEach(function (sub, di) {
      var hn = headingNumber(devCtx.counters, 3);   // dev sub = h3
      devCtx.activeDepth = hn.activeDepth;
      rows.push({
        type: 'devSub', level: 3, number: hn.number,
        id: sub.id, title: String(sub.title != null ? sub.title : sub.id),
        depth: hn.activeDepth, doc: 'dev', ownerKind: 'dev', ownerKey: sub.id,
        devIndex: di, description: enOf(sub, 'desc', 'description'),
        description_zh: zhOf(sub, 'desc', 'description_zh'), subgroupParent: false,
      });
      emitEntries(sub.entries || [], devCtx,
        { doc: 'dev', ownerKind: 'dev', ownerKey: sub.id, devIndex: di });
    });

    // ---- structure sections --------------------------------------------------
    ((structure && structure.sections) || []).forEach(function (sec) {
      var secKey = sectionLetter(sec.title != null ? sec.title : sec.id, sectionTaken);
      var ctx = { counters: [secKey, 0, 0, 0, 0], activeDepth: 0 };
      var row = {
        type: 'section', level: 2, number: secKey,
        id: sec.id, title: String(sec.title != null ? sec.title : sec.id),
        doc: 'entries', ownerKind: 'node', ownerKey: sec.id,
        status: pick(sec.stage, sec.status), subgroupParent: false,
      };
      rows.push(row);
      emitEntriesFor(sec.id, ctx, 2, row);          // section-level entries (activeDepth 0)
      var pages = doLeafSort ? leafSorted(sec.pages) : (sec.pages || []);
      pages.forEach(function (p) { walkPage(p, ctx, 3, null, 1); });
    });

    // Stamp the canonical display name on every heading row (single source for
    // both the page renderer and the launchpad tree).
    rows.forEach(function (r) {
      if (r.type !== 'entry') r.display = displayName(r);
    });

    return { rows: rows };
  }

  return {
    parseVersion: parseVersion,
    compareVersion: compareVersion,
    planStages: planStages,
    UNSET: UNSET,
    isUnset: isUnset,
    tokenLabel: tokenLabel,
    stageClass: stageClass,
    versionColors: versionColors,
    sortedEntries: sortedEntries,
    leafSorted: leafSorted,
    isSubgroup: isSubgroup,
    entriesKeyFor: entriesKeyFor,
    displayName: displayName,
    sectionLetter: sectionLetter,
    slugify: slugify,
    headingNumber: headingNumber,
    itemNumber: itemNumber,
    numberSection: numberSection,
    buildModel: buildModel,
  };
});
