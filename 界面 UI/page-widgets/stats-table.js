// Stats-page behaviours, shared by the website's /site-stats (网站统计) and
// the Personal Apps app-stats page (应用统计). Pairs with styles/stats.css.
//
// Two independent behaviours:
//   1. Click-to-sort on the first .stats-table (columns discovered from the
//      markup — no hardcoded column map, so tables with different column
//      sets work unchanged).
//   2. Live time refresh: "From today" cells, the "Last updated" head line,
//      and the line-history chart's time axis all track the moment the page
//      LOADED, not the moment the build ran.

// Click-to-sort table headers. Default order is what the server renders, so
// crawlers + JS-disabled browsers see the canonical sort. JS only affects
// the order; the data is already in the DOM.
(function () {
  const table = document.querySelector('.stats-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const thead = table.querySelector('thead');
  if (!tbody || !thead) return;
  const headers = thead.querySelectorAll('th[data-sort]');

  // Column index + value type are discovered from the markup itself:
  //   index — the header's own cell position;
  //   type  — data-bytes on a cell ⇒ byte count; a .touched-date span ⇒
  //           date triplet; a .num header ⇒ numeric text; else plain text.
  const COL_IDX = {};
  const COL_KIND = {};
  headers.forEach(h => {
    const col = h.dataset.sort;
    COL_IDX[col] = h.cellIndex;
    COL_KIND[col] = h.classList.contains('num') ? 'num' : 'text';
  });
  for (const r of tbody.children) {
    if (r.classList.contains('section-bar') || r.classList.contains('nofold')) continue;
    for (const col of Object.keys(COL_IDX)) {
      const td = r.children[COL_IDX[col]];
      if (!td) continue;
      if (td.dataset && td.dataset.bytes !== undefined) COL_KIND[col] = 'bytes';
      else if (td.querySelector && td.querySelector('.touched-date')) COL_KIND[col] = 'date';
    }
    break; // one data row is enough to sniff cell kinds
  }

  // Natural first-click direction: dates read as a forward timeline (asc),
  // numbers lead with the heaviest (desc), text alphabetically (asc).
  // A header can override via data-natural-dir ("asc"/"desc") — e.g. the
  // site's "Last touched" column wants recency-leading desc.
  function naturalDir(col) {
    const th = thead.querySelector('th[data-sort="' + col + '"]');
    if (th && th.dataset.naturalDir) return th.dataset.naturalDir;
    const kind = COL_KIND[col];
    if (kind === 'num' || kind === 'bytes') return 'desc';
    return 'asc';
  }

  // Initial sort state: the server-rendered order, declared on the table
  // (data-default-sort / data-default-dir); falls back to the first
  // sortable numeric column descending.
  // A table with no sortable headers (e.g. the roadmap's Site History, which
  // only wants the collapsible sections) has no default column — sorting then
  // no-ops while folding + time-refresh still run.
  const _firstSortable = Array.from(headers).find(h => h.classList.contains('num')) || headers[0];
  let current = {
    col: table.dataset.defaultSort || (_firstSortable ? _firstSortable.dataset.sort : null),
    dir: table.dataset.defaultDir || 'desc',
  };

  const groupToggle = document.getElementById('group-categories');
  // Snapshot the initial (correctly grouped) section structure ONCE, so
  // either layout can be rebuilt regardless of how rows get reordered by
  // later sorts or by flattening. Each entry: { bar, rows: [...], collapsed }.
  const sections = [];
  {
    let cur = null;
    for (const r of Array.from(tbody.children)) {
      if (r.classList.contains('section-bar')) { cur = { bar: r, rows: [], collapsed: false }; sections.push(cur); }
      else if (r.classList.contains('nofold')) { /* global marker (e.g. Today line) — never folds */ }
      else if (cur) cur.rows.push(r);
    }
  }

  // ---- Collapsible sections + expand/collapse-all ----
  // Click a grey bar to fold/unfold its section. Fold state lives on the
  // section object and survives sorting (classes ride with the row
  // elements); it SUSPENDS while the table is flattened (group toggle off —
  // the bars are hidden, every row shows) and restores on re-grouping.
  // The expand/collapse-all button is injected here so every stats page
  // gets it without templating changes: into the .group-toggle row when one
  // exists, else into a fresh row above the table.
  const foldBtn = document.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = 'fold-all';
  {
    let host = document.querySelector('.group-toggle');
    if (!host) {
      host = document.createElement('div');
      host.className = 'group-toggle';
      table.parentNode.insertBefore(host, table);
    }
    host.appendChild(foldBtn);
  }

  function applyFolds() {
    const grouped = !groupToggle || groupToggle.checked;
    for (const s of sections) {
      s.bar.classList.toggle('collapsed', s.collapsed);
      for (const r of s.rows) r.classList.toggle('fold-hidden', grouped && s.collapsed);
    }
    const anyCollapsed = sections.some(s => s.collapsed);
    foldBtn.textContent = anyCollapsed ? 'Expand all' : 'Collapse all';
    // Folding is meaningless while flattened — hide the button with the bars.
    foldBtn.style.display = grouped ? '' : 'none';
  }

  sections.forEach(s => {
    s.bar.addEventListener('click', () => {
      s.collapsed = !s.collapsed;
      applyFolds();
    });
  });

  foldBtn.addEventListener('click', () => {
    const target = !sections.some(s => s.collapsed);
    sections.forEach(s => { s.collapsed = target; });
    applyFolds();
  });

  function getKey(row, col) {
    const td = row.children[COL_IDX[col]];
    if (!td) return '';
    const kind = COL_KIND[col];
    if (kind === 'bytes') return Number(td.dataset.bytes || 0);
    if (kind === 'num') {
      // '—' (em-dash) means "not applicable" — treat as 0 so projects
      // without that metric sort below those with it under desc, and at the
      // top under asc (which still reads as "lowest first").
      const txt = td.textContent.trim();
      if (txt === '—' || txt === '') return 0;
      return parseInt(txt.replace(/,/g, ''), 10) || 0;
    }
    if (kind === 'date') {
      // Sort by underlying YYYY-MM-DD even when the toggle shows blocks,
      // so date- and block-view sort identically by chronology.
      // Em-dash means "not yet" — a future date — so we map it to a
      // high-sentinel string that lexically sorts after any YYYY-MM-DD
      // value. This makes ascending end with `—` and descending start
      // with `—` (not-yet = newest possible).
      const span = td.querySelector('.touched-date');
      const text = span ? span.textContent.trim() : '';
      if (text === '—' || text === '') return '￿';
      return text;
    }
    return td.textContent.trim().toLowerCase();
  }

  function sortRows(col, dir) {
    const cmpFn = (a, b) => {
      const ka = getKey(a, col);
      const kb = getKey(b, col);
      let cmp;
      if (typeof ka === 'number' && typeof kb === 'number') cmp = ka - kb;
      else cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    };
    // Grouped (default): sort data rows WITHIN each section; the
    // .section-bar pins to the top of its section and the aggregate
    // "Others" rollup (.agg) pins to the bottom, so a click on Lines
    // reorders each section without intermixing them. Only .agg is pinned —
    // NOT every .others row: the Libraries rows share the .others *style*
    // (muted/italic) but are real data and must sort like any other row.
    //
    // Flat (category toggle off): the grey section bars are hidden via CSS
    // and every entry sorts together across all sections. The aggregate
    // "Others" rollup (.agg) still sinks to the very bottom; the Total in
    // <tfoot> is untouched by sorting either way.
    const grouped = !groupToggle || groupToggle.checked;
    const out = [];
    if (grouped) {
      for (const s of sections) {
        out.push(s.bar);
        const agg = s.rows.filter(r => r.classList.contains('agg'));
        const data = s.rows.filter(r => !r.classList.contains('agg'));
        data.sort(cmpFn);
        out.push(...data, ...agg);
      }
    } else {
      const allRows = sections.flatMap(s => s.rows);
      const agg = allRows.filter(r => r.classList.contains('agg'));
      const data = allRows.filter(r => !r.classList.contains('agg'));
      data.sort(cmpFn);
      // Hidden section bars ride along (display:none) so toggling back to
      // grouped restores them in place; their order here is irrelevant.
      out.push(...sections.map(s => s.bar), ...data, ...agg);
    }
    out.forEach(r => tbody.appendChild(r));

    headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
    const active = thead.querySelector('th[data-sort="' + col + '"]');
    if (active) active.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
    current = { col, dir };
  }

  headers.forEach(h => {
    h.addEventListener('click', () => {
      const col = h.dataset.sort;
      // Click active header → toggle direction. Click new header → start
      // with the column's natural direction (see naturalDir above).
      const dir = current.col === col
        ? (current.dir === 'desc' ? 'asc' : 'desc')
        : naturalDir(col);
      sortRows(col, dir);
    });
  });

  // Re-sort under the new scope whenever the grouping toggle flips, and
  // re-apply folds (suspended while flat, restored when grouped).
  if (groupToggle) {
    groupToggle.addEventListener('change', () => {
      sortRows(current.col, current.dir);
      applyFolds();
    });
  }

  // Initial state: render the indicator on the default sort column.
  if (current.col) sortRows(current.col, current.dir);
  applyFolds();

  // Freeze column widths at their first-load values so nothing reflows the
  // columns afterwards — folding a section (which removes its rows, and with
  // them whatever content was widest), re-sorting, or swapping the date view
  // all keep every column exactly where it loaded. Measure once with every
  // section expanded (the initial state), pin the measurements on the header
  // cells, then switch to fixed layout so content no longer drives sizing.
  {
    const ths = table.querySelectorAll('thead th');
    const widths = Array.from(ths, th => th.getBoundingClientRect().width);
    ths.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
    table.style.tableLayout = 'fixed';
  }
})();

// Live time refresh — both the "From today" labels and the
// line-history chart's right-edge use the moment the page LOADED, not
// the moment the build ran. A page sitting in a browser tab a week
// after the last build still shows accurate "X days ago" values and a
// chart whose time-axis ends at today.
(function () {
  const now = new Date();
  function fmtAgo(dateStr) {
    if (!dateStr || dateStr === '—') return '—';
    const e = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(e.getTime())) return '—';
    const r = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const diffDays = Math.round((e - r) / 86400000);
    if (diffDays === 0) return 'today';
    const future = diffDays > 0;
    const absDays = Math.abs(diffDays);
    if (absDays < 60) {
      const body = `${absDays} day${absDays === 1 ? '' : 's'}`;
      return future ? `in ${body}` : body;
    }
    const earlier = future ? r : e;
    const later = future ? e : r;
    let years = later.getUTCFullYear() - earlier.getUTCFullYear();
    let months = later.getUTCMonth() - earlier.getUTCMonth();
    if (later.getUTCDate() < earlier.getUTCDate()) months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    const body = years === 0 ? `${months}mo` : `${years}yr ${months}mo`;
    return future ? `in ${body}` : body;
  }
  // Update every "From today" cell against page-load now.
  document.querySelectorAll('[data-date]').forEach(el => {
    el.textContent = fmtAgo(el.dataset.date);
  });
  // "Last updated" head line — uses the index-page-style "X ago" format
  // (seconds/minutes/hours/days/weeks/months/years), which fits a
  // build-delta of minutes-to-days better than the projects-table
  // format above (designed for years-scale spans).
  const buildAgo = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  function fmtBuildAgo(secs) {
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs} seconds ago`;
    if (secs < 3600) return buildAgo(Math.floor(secs / 60), 'minute');
    if (secs < 86400) return buildAgo(Math.floor(secs / 3600), 'hour');
    if (secs < 1209600) return buildAgo(Math.floor(secs / 86400), 'day');
    if (secs < 5443200) return buildAgo(Math.floor(secs / 604800), 'week');
    if (secs < 31557600) return buildAgo(Math.floor(secs / 2629800), 'month');
    return buildAgo(Math.floor(secs / 31557600), 'year');
  }
  document.querySelectorAll('[data-build-ts]').forEach(el => {
    const dt = new Date(el.dataset.buildTs);
    if (isNaN(dt.getTime())) return;
    const secs = Math.max(0, Math.floor((now - dt) / 1000));
    el.textContent = fmtBuildAgo(secs);
  });

  // Re-render the line-history chart so the time axis ends at now.
  const svg = document.querySelector('.line-history-svg[data-chart-points]');
  if (svg) {
    let points;
    try { points = JSON.parse(svg.dataset.chartPoints); } catch (e) { points = null; }
    if (points && points.length) {
      const W = +svg.dataset.chartW, H = +svg.dataset.chartH;
      const padL = +svg.dataset.chartPadLeft, padR = +svg.dataset.chartPadRight;
      const padT = +svg.dataset.chartPadTop, padB = +svg.dataset.chartPadBottom;
      const yMaxLines = +svg.dataset.chartYMaxLines;
      const yMaxWords = +svg.dataset.chartYMaxWords;
      const chartW = W - padL - padR, chartH = H - padT - padB;
      const dates = points.map(p => new Date(p.ts));
      const xMin = dates[0];
      const last = dates[dates.length - 1];
      const xMax = last > now ? last : now;
      const xSecs = Math.max(1, (xMax - xMin) / 1000);
      const xs = d => padL + chartW * ((d - xMin) / 1000) / xSecs;
      const ysL = v => padT + chartH * (1 - v / yMaxLines);
      const ysW = v => yMaxWords <= 0 ? padT + chartH : padT + chartH * (1 - v / yMaxWords);
      const linesPath = svg.querySelector('path.lines-series');
      if (linesPath) {
        linesPath.setAttribute('d', 'M ' + points.map((p, i) =>
          `${xs(dates[i]).toFixed(1)},${ysL(p.total).toFixed(1)}`
        ).join(' L '));
      }
      const wordsIdx = points.map((p, i) => p.words != null ? i : -1).filter(i => i >= 0);
      const wordsPath = svg.querySelector('path.words-series');
      if (wordsPath && wordsIdx.length >= 2) {
        wordsPath.setAttribute('d', 'M ' + wordsIdx.map(i =>
          `${xs(dates[i]).toFixed(1)},${ysW(points[i].words).toFixed(1)}`
        ).join(' L '));
      }
      // Right-edge x-axis label tracks the new now.
      const lbl = svg.querySelector('text.x-label-right');
      if (lbl) {
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        lbl.textContent = `${yyyy}-${mm}-${dd}`;
      }
    }
  }
})();
