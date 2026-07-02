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

      // Two y-scale modes, selected by the Linear/Logarithmic toggle:
      //   • linear — raw counts against the server-rendered nice-max axis
      //     (yMaxLines / yMaxWords); labels are the counts themselves.
      //   • log    — natural log (base e): each value maps to ln(count). The
      //     lower end is floor(ln min); the tick STEP snaps to a 1-2-5 ladder
      //     value (…, 0.1, 0.2, 0.5, 1, 2, 5, 10, …) — the smallest whose 4 steps
      //     still cover the data — so every label is a 1/2/5 × power-of-ten
      //     multiple (e.g. 9, 9.5, 10; never 7.8 or 9.2). The 5 gridlines never
      //     move; only label text + path geometry do. (A nice step means the top
      //     isn't a tight ceil(ln max) — a little head-room buys clean numbers.)
      const ln = v => Math.log(Math.max(v, 1));
      const totals = points.map(p => p.total);
      const wordVals = points.map(p => p.words).filter(v => v != null);
      // Smallest 1-2-5 ladder value ≥ raw (…, 0.1, 0.2, 0.5, 1, 2, 5, 10, …).
      const niceStep = raw => {
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw - 1e-9) || 10 * p;
      };
      const lnBounds = vals => {
        if (!vals.length) return { lo: 0, hi: 2, step: 0.5 };
        const lo = Math.floor(ln(Math.min(...vals)));
        const raw = Math.max(ln(Math.max(...vals)) - lo, 1e-6) / 4; // per-step to cover data
        const step = niceStep(raw);
        return { lo, hi: lo + step * 4, step };
      };
      const lnLines = lnBounds(totals);
      const lnWords = wordVals.length ? lnBounds(wordVals) : { lo: 0, hi: 2, step: 0.5 };
      // Label a tick with just enough decimals for its step (0.5→"9.5", 1→"9").
      const fmtStep = (v, step) => {
        const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
        return Number(v.toFixed(d)).toString();
      };
      const lnPos = (v, b) => (ln(v) - b.lo) / (b.hi - b.lo);

      const SCALES = {
        linear: {
          yl: v => padT + chartH * (1 - v / yMaxLines),
          yw: v => yMaxWords <= 0 ? padT + chartH : padT + chartH * (1 - v / yMaxWords),
          labL: i => Math.round(yMaxLines * i / 4).toLocaleString(),
          labR: i => Math.round(yMaxWords * i / 4).toLocaleString(),
        },
        log: {
          yl: v => padT + chartH * (1 - lnPos(v, lnLines)),
          yw: v => padT + chartH * (1 - lnPos(v, lnWords)),
          labL: i => fmtStep(lnLines.lo + lnLines.step * i, lnLines.step),
          labR: i => fmtStep(lnWords.lo + lnWords.step * i, lnWords.step),
        },
      };

      const linesPath = svg.querySelector('path.lines-series');
      const wordsPath = svg.querySelector('path.words-series');
      const wordsIdx = points.map((p, i) => p.words != null ? i : -1).filter(i => i >= 0);
      const leftLabels = svg.querySelectorAll('.y-label-left');
      const rightLabels = svg.querySelectorAll('.y-label-right');
      const legendLines = svg.querySelector('.legend-lines');
      const legendWords = svg.querySelector('.legend-words');

      function redraw(mode) {
        const s = SCALES[mode] || SCALES.linear;
        if (linesPath) {
          linesPath.setAttribute('d', 'M ' + points.map((p, i) =>
            `${xs(dates[i]).toFixed(1)},${s.yl(p.total).toFixed(1)}`
          ).join(' L '));
        }
        if (wordsPath && wordsIdx.length >= 2) {
          wordsPath.setAttribute('d', 'M ' + wordsIdx.map(i =>
            `${xs(dates[i]).toFixed(1)},${s.yw(points[i].words).toFixed(1)}`
          ).join(' L '));
        }
        leftLabels.forEach((el, i) => { el.textContent = s.labL(i); });
        rightLabels.forEach((el, i) => { el.textContent = s.labR(i); });
      }

      // Series visibility — two orthogonal checkboxes. Each hides its path, that
      // axis's labels, and its legend swatch; unchecking both leaves a bare
      // gridded frame.
      const showLines = document.querySelector('#series-lines');
      const showWords = document.querySelector('#series-words');
      const setVis = (els, on) => els.forEach(el => { if (el) el.style.display = on ? '' : 'none'; });
      function applyVisibility() {
        setVis([linesPath, legendLines, ...leftLabels], !showLines || showLines.checked);
        setVis([wordsPath, legendWords, ...rightLabels], !showWords || showWords.checked);
      }
      // No words series on this page → the Words checkbox controls nothing.
      if (!wordsPath && showWords) { showWords.checked = false; showWords.disabled = true; }

      // Initial y-scale draw + series visibility (Linear default), then wire the
      // scale + series controls to re-scale / re-filter in place.
      const currentMode = () => document.querySelector('#scale-log:checked') ? 'log' : 'linear';
      redraw(currentMode());
      applyVisibility();
      document.querySelectorAll('input[name="chart-scale"]').forEach(radio => {
        radio.addEventListener('change', () => redraw(currentMode()));
      });
      [showLines, showWords].forEach(cb => cb && cb.addEventListener('change', applyVisibility));

      // ── X-axis: block / month / week boundary labels ─────────────────────
      // Mirrors the lifespan-atlas clock view: a faint boundary gridline at each
      // period START + the unit label (block no. / month / ISO week no.) centred
      // at the period MIDPOINT. Blocks is the default. The math comes from the
      // shared event-marks engine (引擎 Engines/event-marks) — the SAME module the
      // Atlas uses — so the numbers agree. Loaded via dynamic import so an
      // engine-load failure disables only the x-axis, not the table sorting.
      const SVGNS = 'http://www.w3.org/2000/svg';
      const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const domainMinMs = +xMin, domainMaxMs = +xMax;
      const xForMs = ms => padL + chartW * (ms - domainMinMs) / Math.max(1, domainMaxMs - domainMinMs);
      const clampX = x => Math.max(padL, Math.min(W - padR, x));
      let boundaries = [];
      try { boundaries = JSON.parse(svg.dataset.chartBlockBoundaries || '[]'); } catch (e) { boundaries = []; }
      let phaseBnd = [];
      try { phaseBnd = JSON.parse(svg.dataset.chartPhaseBoundaries || '[]'); } catch (e) { phaseBnd = []; }

      import('../../引擎 Engines/event-marks/marks.js').then(marks => {
        // Engine loaded → the server date fallbacks give way to unit labels.
        svg.querySelectorAll('.x-date-fallback').forEach(el => el.remove());
        const blockCtx = marks.computeBlockContext(boundaries, domainMaxMs);
        // Website version phases: [iso, label] pairs → { startMs, label }.
        const phases = phaseBnd.map(([iso, label]) => ({ startMs: marks.isoToDayMs(iso), label }));
        const labelY = H - padB + 16;
        const ticksFor = mode => {
          if (mode === 'months') {
            return marks.getMonthMarksInRange(domainMinMs, domainMaxMs)
              .map(m => ({ startMs: m.startMs, endMs: m.endMs, midMs: m.midMs, text: EN_MONTHS[m.monthIndex] }));
          }
          if (mode === 'weeks') {
            return marks.getWeekMarksInRange(domainMinMs, domainMaxMs)
              .map(w => ({ startMs: w.startMs, endMs: w.endMs, midMs: w.midMs, text: String(w.isoWeek) }));
          }
          if (mode === 'phases') {
            return marks.getPhaseMarksInRange(domainMinMs, domainMaxMs, phases)
              .map(p => ({ startMs: p.startMs, endMs: p.endMs, midMs: p.midMs, text: p.label }));
          }
          return marks.getBlockMarksInRange(domainMinMs, domainMaxMs, blockCtx)
            .map(b => ({ startMs: b.startMs, endMs: b.endMs, midMs: b.midMs, text: b.label }));
        };
        function drawXAxis(mode) {
          const existing = svg.querySelector('.x-axis-layer');
          if (existing) existing.remove();
          const layer = document.createElementNS(SVGNS, 'g');
          layer.setAttribute('class', 'x-axis-layer');
          // Only periods whose window actually overlaps the data range. The
          // engine emits one period early (for the Atlas ring's midpoint labels),
          // which on a linear axis would otherwise clamp a non-overlapping label
          // (e.g. a month before the first snapshot) onto the left edge.
          const visible = ticksFor(mode).filter(t => t.endMs > domainMinMs && t.startMs < domainMaxMs);
          for (const t of visible) {
            const bx = xForMs(t.startMs);
            // Boundary gridline — only when it lands strictly inside the plot.
            if (bx > padL + 0.5 && bx < W - padR - 0.5) {
              const line = document.createElementNS(SVGNS, 'line');
              line.setAttribute('x1', bx.toFixed(1)); line.setAttribute('x2', bx.toFixed(1));
              line.setAttribute('y1', padT); line.setAttribute('y2', H - padB);
              line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-opacity', '0.08');
              layer.appendChild(line);
            }
            // Label centred at the period midpoint, clamped into the plot so an
            // edge period whose midpoint is off-range still shows its number.
            if (t.text) {
              const txt = document.createElementNS(SVGNS, 'text');
              txt.setAttribute('x', clampX(xForMs(t.midMs)).toFixed(1));
              txt.setAttribute('y', labelY);
              txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '10');
              txt.setAttribute('fill', 'currentColor'); txt.setAttribute('fill-opacity', '0.55');
              txt.textContent = t.text;
              layer.appendChild(txt);
            }
          }
          // Behind the series paths (first child) so gridlines don't cross them.
          svg.insertBefore(layer, svg.firstChild);
        }
        const xMode = () =>
          document.querySelector('#xaxis-months:checked') ? 'months' :
          document.querySelector('#xaxis-weeks:checked') ? 'weeks' :
          document.querySelector('#xaxis-phases:checked') ? 'phases' :
          document.querySelector('#xaxis-blocks:checked') ? 'blocks' :
          'months';  // no toggle present (e.g. app-stats) → sensible month labels
        drawXAxis(xMode());
        document.querySelectorAll('input[name="chart-xaxis"]').forEach(radio => {
          radio.addEventListener('change', () => drawXAxis(xMode()));
        });
      }).catch(() => {
        // Engine unavailable → keep the server date fallbacks; refresh the
        // right-edge label to the live "now" (its old build-time behaviour).
        const lbl = svg.querySelector('text.x-label-right');
        if (lbl) {
          const yyyy = now.getUTCFullYear();
          const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(now.getUTCDate()).padStart(2, '0');
          lbl.textContent = `${yyyy}-${mm}-${dd}`;
        }
      });
    }
  }
})();
