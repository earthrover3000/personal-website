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

      // ── Hover crosshair: vertical guide + per-series readout ─────────────
      // Snaps to the NEAREST snapshot rather than interpolating along the
      // segment under the cursor: the series are straight lines between real
      // builds, so a value read off a segment's interior would be invented.
      // Every readout is therefore a real (timestamp, lines, words) triple
      // straight out of data-chart-points.
      //
      // Nothing positional is cached: redraw() rewrites each path's `d` on
      // every scale change, so geometry is recomputed from live state (via
      // SCALES[currentMode()]) on each move and on each toggle.
      // The readout sits BELOW the chart in normal flow, never floating over
      // the plot: the series are dense (thousands of builds on a mature log),
      // so a box tracking the cursor would cover the very curve being read.
      // Its height is reserved whether or not a point is active — it toggles
      // visibility, not display — so hovering never reflows the page.
      const wrap = document.createElement('div');
      wrap.className = 'chart-hover-wrap';
      svg.parentNode.insertBefore(wrap, svg);
      wrap.appendChild(svg);
      const readout = document.createElement('div');
      // ch-grid: the two-row column-aligned variant of the readout (stats.css).
      // The other consumer of .chart-readout (site-log-rings) emits a single
      // line of prose and keeps the plain flex layout.
      readout.className = 'chart-readout ch-grid';
      wrap.appendChild(readout);

      // Crosshair layer is APPENDED (not inserted first like .x-axis-layer):
      // the guide and its markers read on top of the series, not behind them.
      const chLayer = document.createElementNS(SVGNS, 'g');
      chLayer.setAttribute('class', 'crosshair-layer');
      chLayer.style.display = 'none';
      const chLine = document.createElementNS(SVGNS, 'line');
      chLine.setAttribute('class', 'ch-line');
      chLine.setAttribute('y1', padT);
      chLine.setAttribute('y2', H - padB);
      chLayer.appendChild(chLine);
      const mkDot = cls => {
        const c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('class', `ch-dot ${cls}`);
        c.setAttribute('r', '3.5');
        chLayer.appendChild(c);
        return c;
      };
      const chDotLines = mkDot('ch-dot-lines');
      const chDotWords = mkDot('ch-dot-words');
      svg.appendChild(chLayer);

      // Readouts follow the series checkboxes — a hidden series contributes
      // neither a marker nor a tooltip row.
      const linesOn = () => !showLines || showLines.checked;
      const wordsOn = () => !!wordsPath && (!showWords || showWords.checked);

      const p2 = n => String(n).padStart(2, '0');
      // Two labelling modes, set by the server:
      //   • full  — snapshots are stored UTC and rendered in LOCAL time, which
      //     is what "when was I working" means to the reader. Unlabelled.
      //   • daily — the payload was collapsed to one point per day and stamped
      //     midnight UTC, so it carries no real clock. Read the ISO date
      //     straight off the string: passing it through Date would print an
      //     invented 00:00 and, for any reader west of UTC, roll the date back
      //     a day.
      const dayGranular = svg.dataset.chartDaily === '1';
      const fmtWhen = i => {
        if (dayGranular) return points[i].ts.slice(0, 10);
        const d = dates[i];
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
               `${p2(d.getHours())}:${p2(d.getMinutes())}`;
      };

      function nearestIndex(vbX) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < points.length; i++) {
          const d = Math.abs(xs(dates[i]) - vbX);
          if (d < bestD) { bestD = d; best = i; }
        }
        return best;
      }

      // ── The 24h row ─────────────────────────────────────────────────────
      // Line 2 of the readout: how much each count moved over the 24 hours
      // ENDING at the moment line 1 is reporting — the hovered snapshot, or
      // the newest build at rest. Tying it to the hovered point rather than to
      // the reader's clock is what keeps the two lines honest: a fixed "last
      // 24h from now" sitting under a line reporting a build from March would
      // be two different moments stacked in one box.
      //
      // The baseline is the newest snapshot at or before (t − 24h), and that
      // is EXACT, not an approximation. The counts are a step function: they
      // change only where a build recorded a snapshot, so the value at any
      // instant between two snapshots IS the earlier one's. A quiet fortnight
      // doesn't smear the window — it means the baseline is a fortnight old
      // and the 24h delta is correctly zero.
      const DAY_MS = 86400000;
      const DASH = '—';
      // baseOf[i] — the newest snapshot at or before (t_i − 24h), or -1 where
      // the history doesn't reach a full day back. Precomputed in one forward
      // sweep: the cutoff only ever moves right, so the baseline pointer never
      // rewinds, and the hover path becomes an array lookup rather than a
      // backward scan through four thousand points on every mouse move.
      const baseOf = new Array(points.length);
      {
        let j = -1;
        for (let i = 0; i < points.length; i++) {
          const cutoff = dates[i].getTime() - DAY_MS;
          while (j + 1 < points.length && dates[j + 1].getTime() <= cutoff) j++;
          baseOf[i] = j;
        }
      }
      const deltaAt = (i, key) => {
        const b = baseOf[i] >= 0 ? points[baseOf[i]] : null;
        if (!b || b[key] == null || points[i][key] == null) return null;
        return points[i][key] - b[key];
      };
      // U+2212 MINUS, not a hyphen: the deltas sit in the same tabular-nums
      // column as the counts above them, and a hyphen is narrower than a digit.
      const fmtDelta = d =>
        (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toLocaleString();
      const fmtCount = v => v == null ? DASH : v.toLocaleString();

      // ── Pinned value columns ──────────────────────────────────
      // Counts are not all the same width (41,578 → 115,793), so an auto track
      // resizes as the pointer moves and shunts everything to its right along
      // with it — on a series this dense, a permanent shimmer under the cursor.
      // Each value column is measured ONCE against the widest string it will
      // ever hold — its longest count, its longest delta, or the dash — and
      // pinned there, so only the digits change while the layout holds still.
      // Measured with a probe carrying .ch-val rather than with a canvas, so it
      // inherits the real font and tabular-nums instead of a reconstruction.
      const colW = { total: 0, words: 0 };
      function pinColumns() {
        const probe = document.createElement('span');
        probe.className = 'ch-val';
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        readout.appendChild(probe);
        const longest = strs => strs.reduce((a, b) => b.length > a.length ? b : a, '');
        for (const key of ['total', 'words']) {
          const counts = longest(points.map(q => fmtCount(q[key])));
          const deltas = longest(points.map((q, i) => {
            const d = deltaAt(i, key);
            return d === null ? DASH : fmtDelta(d);
          }));
          let w = 0;
          for (const str of [counts, deltas, DASH]) {
            probe.textContent = str;
            w = Math.max(w, probe.getBoundingClientRect().width);
          }
          colW[key] = Math.ceil(w);
        }
        probe.remove();
      }

      // Counts are always the raw values: the Log toggle changes the axis, not
      // what the number is. A point predating word tracking has words == null
      // and reads as a dash rather than dropping its field: a vanishing column
      // is the one layout shift the pinned widths above cannot prevent.
      function renderReadout(i) {
        const p = points[i];
        const lOn = linesOn(), wOn = wordsOn();
        const field = (cls, key, val) =>
          `<span class="ch-field ${cls}"><span class="ch-key">${key}</span>` +
          `<span class="ch-val">${val}</span></span>`;
        let html =
          `<span class="ch-when">${fmtWhen(i)}</span>` +
          (lOn ? field('ch-f-lines', 'Lines', fmtCount(p.total)) : '') +
          (wOn ? field('ch-f-words', 'Words', fmtCount(p.words)) : '');

        // The row is unconditional. Through the first day of any history there
        // is no instant 24h back to measure from, and a dash says so plainly;
        // a row that came and went would move the page under the reader for
        // the same reason a resizing column does.
        const cell = (cls, key) => {
          const d = deltaAt(i, key);
          return field(cls + ' ch-d', '', d === null ? DASH : fmtDelta(d));
        };
        html +=
          '<span class="ch-when ch-since">24h</span>' +
          (lOn ? cell('ch-f-lines', 'total') : '') +
          (wOn ? cell('ch-f-words', 'words') : '');
        // One column for the when/since label, then a (key, value) pair per
        // VISIBLE series — set here rather than in CSS because unchecking a
        // series removes its two columns, and a fixed template would leave
        // their gaps behind. Line 2's empty key cells hold its deltas in the
        // same columns as the counts they modify; that alignment is what lets
        // the row drop its own labels.
        // A pinned width of 0 means the probe measured inside a hidden box —
        // fall back to an auto track rather than clamping the column shut.
        const track = w => w ? `${w}px` : 'auto';
        readout.style.gridTemplateColumns = 'auto'
          + (lOn ? ` auto ${track(colW.total)}` : '')
          + (wOn ? ` auto ${track(colW.words)}` : '');
        readout.innerHTML = html;
      }

      let activeIdx = -1;
      function showAt(i) {
        activeIdx = i;
        const s = SCALES[currentMode()] || SCALES.linear;
        const p = points[i];
        const x = xs(dates[i]);
        chLine.setAttribute('x1', x.toFixed(1));
        chLine.setAttribute('x2', x.toFixed(1));
        const lOn = linesOn(), wOn = wordsOn() && p.words != null;
        if (lOn) {
          chDotLines.setAttribute('cx', x.toFixed(1));
          chDotLines.setAttribute('cy', s.yl(p.total).toFixed(1));
        }
        if (wOn) {
          chDotWords.setAttribute('cx', x.toFixed(1));
          chDotWords.setAttribute('cy', s.yw(p.words).toFixed(1));
        }
        chDotLines.style.display = lOn ? '' : 'none';
        chDotWords.style.display = wOn ? '' : 'none';
        chLayer.style.display = '';
        renderReadout(i);
      }

      // Resting state: no guide (nothing is being pointed at), but the line
      // still reports the most recent build rather than going blank — the
      // number a visitor most likely wants is the current one.
      function restCrosshair() {
        activeIdx = -1;
        chLayer.style.display = 'none';
        renderReadout(points.length - 1);
      }

      svg.addEventListener('pointermove', evt => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const q = svg.createSVGPoint();
        q.x = evt.clientX; q.y = evt.clientY;
        // Screen → viewBox units: the SVG is width:100% with a fixed viewBox,
        // so the CTM is the only reliable way to undo the responsive scaling.
        const v = q.matrixTransform(ctm.inverse());
        if (v.x < padL - 8 || v.x > W - padR + 8) { restCrosshair(); return; }
        showAt(nearestIndex(v.x));
      });
      svg.addEventListener('pointerleave', restCrosshair);
      pinColumns();
      restCrosshair();

      // Re-render whatever the line is currently showing when a toggle moves
      // the geometry or changes which series count. Registered after the
      // redraw()/applyVisibility() listeners above, so the paths and visibility
      // are already settled by the time this runs.
      const refreshCrosshair = () =>
        activeIdx >= 0 ? showAt(activeIdx) : restCrosshair();
      document.querySelectorAll('input[name="chart-scale"]').forEach(radio => {
        radio.addEventListener('change', refreshCrosshair);
      });
      [showLines, showWords].forEach(cb => cb && cb.addEventListener('change', refreshCrosshair));
      // Re-pin once webfonts land: widths first measured against the fallback
      // face would sit a few pixels off the text that finally renders.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { pinColumns(); refreshCrosshair(); });
      }
    }
  }
})();
