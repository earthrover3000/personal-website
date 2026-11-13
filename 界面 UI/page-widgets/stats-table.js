// Stats-page behaviours, shared by the website's /site-stats (网站统计) and
// the console app-stats pages (应用统计). Pairs with styles/stats.css.
//
// Two independent behaviours:
//   1. Click-to-sort on the first .stats-table (columns discovered from the
//      markup — no hardcoded column map, so tables with different column
//      sets work unchanged).
//   2. Live time refresh: "From today" cells, the "Last updated" head line,
//      and the line-history chart's time axis all track the moment the page
//      LOADED, not the moment the build ran.
//
// The two meet in one place: a table row carrying data-series is a click
// target for the chart, which then draws that project's history alone (see
// "One project at a time" below).

// A live stats page (source_stats.page) swaps its baked copy for a fresh
// render with document.write, which keeps this window — and a module runs
// once per window. Wait until the swap has settled, so the widgets below
// bind to the document that stays on screen, not the one thrown away.
// Pages without the swap set no promise and start at once — synchronously,
// which the roadmap needs: it loads this as a classic script that must run
// where it stands (source_stats.page `widget_module`), so no top-level await.
function whenSettled(start) {
  if (window.statsPageSettled) window.statsPageSettled.then(start);
  else start();
}

// ── Line colours ─────────────────────────────────────────────────────────
// LINES THAT RUN CLOSE GET THE MOST DIFFERENT COLOURS (user request
// 2026-11-03: Lifespan Atlas and 数字基建 sat side by side in two reds).
// Every pair of series is scored by how near their curves run — on the
// linear scale or the log one, whichever is nearer, since the reader may
// pick either — and colours are handed out greedily, the most crowded
// line first, each taking the free colour farthest (in Lab ΔE) from the
// colours of the lines it runs near. Same data, same colours: nothing
// depends on what is ticked. None is blue, which is the totals'.
// source_stats/series_colours.py is the same rule in Python, for charts
// that choose on the server: keep the palette and overflow in step.
const SERIES_PALETTE = ['#e4572e', '#2ca25f', '#9b5de5', '#f0b429',
                        '#17becf', '#e0399a', '#8cc63f', '#8c564b',
                        '#ffa3c4', '#006d5b'];
// Past ten (the atlas has ~45): golden-angle hues squeezed out of the
// accent's blue (200°–245°), lightness stepping between neighbours.
function overflowColour(n) {
  let h = ((n * 137.508) % 360) * (315 / 360);
  if (h >= 200) h += 45;
  const l = [0.48, 0.64, 0.56][n % 3], s = 0.6;
  const f = k => {
    const a = (k + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(a - 3, 9 - a, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hexToLab(hex) {
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const t = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = t((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = t(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = t((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// One page, one colour per part: a page with two charts (Workshop Stats'
// lines and size) keeps the first chart's choices and only fills in keys
// the first did not have.
const _pageSeriesColours = {};
function assignSeriesColours(expanded) {
  const keys = Object.keys(expanded);
  const vals = keys.map(k => expanded[k].total);
  let max = 0, minPos = Infinity;
  vals.forEach(v => v.forEach(x => {
    if (x > max) max = x;
    if (x > 0 && x < minPos) minPos = x;
  }));
  const logSpan = Math.max(1, Math.log(max / minPos) || 1);
  // How far apart two curves run, 0 = on top of each other, 1 = far.
  const len = vals.length ? vals[0].length : 0;
  const stride = Math.max(1, Math.floor(len / 400));
  const apart = (a, b) => {
    let lin = 0, log = 0, n = 0;
    for (let i = 0; i < len; i += stride) {
      const p = a[i], q = b[i];
      if (p == null || q == null) continue;
      lin += Math.abs(p - q) / (max || 1);
      if (p > 0 && q > 0) log += Math.abs(Math.log(p / q)) / logSpan;
      else log += 1;
      n += 1;
    }
    return n ? Math.min(lin, log) / n : 1;
  };
  const near = keys.map(() => new Array(keys.length).fill(0));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      near[i][j] = near[j][i] = 1 / (apart(vals[i], vals[j]) + 0.02);
    }
  }
  const pool = SERIES_PALETTE.slice();
  for (let n = pool.length; n < keys.length; n++) pool.push(overflowColour(n));
  const labs = pool.map(hexToLab);
  const colourIx = new Array(keys.length).fill(-1);
  const taken = new Set();
  keys.forEach((k, i) => {
    const c = _pageSeriesColours[k];
    if (c && pool.includes(c)) { colourIx[i] = pool.indexOf(c); taken.add(colourIx[i]); }
  });
  const crowd = i => near[i].reduce((s, w) => s + w, 0);
  const order = keys.map((_, i) => i).filter(i => colourIx[i] < 0)
    .sort((a, b) => crowd(b) - crowd(a) || a - b);
  for (const i of order) {
    let best = -1, bestCost = Infinity;
    for (let c = 0; c < pool.length; c++) {
      if (taken.has(c)) continue;
      let cost = 0;
      for (let j = 0; j < keys.length; j++) {
        if (colourIx[j] < 0) continue;
        const d = Math.hypot(...labs[c].map((v, m) => v - labs[colourIx[j]][m]));
        cost += near[i][j] / Math.max(d, 1) ** 2;
      }
      if (cost < bestCost - 1e-12) { bestCost = cost; best = c; }
    }
    if (best < 0) best = taken.size % pool.length;   // more keys than colours
    colourIx[i] = best;
    taken.add(best);
  }
  const out = {};
  keys.forEach((k, i) => {
    out[k] = pool[colourIx[i]];
    if (!_pageSeriesColours[k]) _pageSeriesColours[k] = out[k];
  });
  return out;
}

// Click-to-sort table headers. Default order is what the server renders, so
// crawlers + JS-disabled browsers see the canonical sort. JS only affects
// the order; the data is already in the DOM.
whenSettled(function () {
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
  // exists, else into a fresh row above the table. Not at all on a table
  // with no sections (Workshop Stats' Parts): nothing there folds.
  const foldBtn = document.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = 'fold-all';
  if (sections.length) {
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

  function cellText(td) {
    if (!td.querySelector('.cell-sub')) return td.textContent.trim();
    const copy = td.cloneNode(true);
    copy.querySelectorAll('.cell-sub').forEach(el => el.remove());
    return copy.textContent.trim();
  }

  function getKey(row, col) {
    const td = row.children[COL_IDX[col]];
    if (!td) return '';
    const kind = COL_KIND[col];
    if (kind === 'bytes') return Number(td.dataset.bytes || 0);
    if (kind === 'num') {
      // '—' (em-dash) means "not applicable" — treat as 0 so projects
      // without that metric sort below those with it under desc, and at the
      // top under asc (which still reads as "lowest first").
      // A .cell-sub second line (Workshop Stats' footprint under Lines)
      // is not the cell's value: read the text around it.
      const txt = cellText(td);
      if (txt === '—' || txt === '') return 0;
      return parseFloat(txt.replace(/,/g, '')) || 0;
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
    return cellText(td).toLowerCase();
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
  // A table with nothing to fold or sort has nothing to reflow it, and is
  // left free: Workshop Stats' Parts hides one group of columns at load
  // and shows it later, which a freeze would pin at zero width.
  if (sections.length || headers.length) {
    const ths = table.querySelectorAll('thead th');
    const widths = Array.from(ths, th => th.getBoundingClientRect().width);
    ths.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
    table.style.tableLayout = 'fixed';
  }
});

// Live time refresh — both the "From today" labels and the
// line-history chart's right-edge use the moment the page LOADED, not
// the moment the build ran. A page sitting in a browser tab a week
// after the last build still shows accurate "X days ago" values and a
// chart whose time-axis ends at today.
whenSettled(function () {
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
  // "Last updated" head line — the one "X ago" spelling, `agoText` from
  // 引擎 Engines/time-ago (user decision 2026-10-20: one copy everywhere),
  // which fits a build-delta of minutes-to-days better than the
  // projects-table format above (designed for years-scale spans).
  // Imported relative to this file, as event-marks is below: every page
  // that loads it keeps 界面 UI/ and 引擎 Engines/ side by side. Until it
  // answers, the cell keeps the text the build wrote.
  const builds = document.querySelectorAll('[data-build-ts]');
  if (builds.length) {
    import('../../引擎 Engines/time-ago/time-ago.js')
      .then(({ agoText }) => builds.forEach(el => {
        const dt = new Date(el.dataset.buildTs);
        if (isNaN(dt.getTime())) return;
        el.textContent = agoText((now - dt) / 1000);
      }))
      .catch(() => { /* not deployed yet: the built text stands */ });
  }

  // Re-render each line-history chart so the time axis ends at now — or, once
  // the event-marks engine has loaded (below), at the end of the CURRENT
  // blocks, the same edge the atlas Blocks view's Current section ends at.
  //
  // EVERY chart on the page, each with its own controls (2026-10-05). This
  // took the first SVG and looked its controls up by document id until the
  // Backlog page drew a second chart, which then had no crosshair, no unit
  // axis, no table, and buttons that drove the chart above it. Nothing below
  // may reach for a control through `document`: go through ctl / ctlGroup.
  const charts = document.querySelectorAll('.line-history-svg[data-chart-points]');
  // THE SLEEP DAY (引擎 Engines/day_cut, 04:00 to 04:00 on this clock):
  // the readout's `24h` and `today`, and the Days view's days (user
  // decision 2026-11-08). Each chart draws at once and redraws when it
  // lands (`dayCut` below); until then its changes read as dashes.
  const dayCutLoad = charts.length
    ? import('../../引擎 Engines/day_cut/day-cut.js') : null;
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  charts.forEach((svg, chartIdx) => {
    // What other code may ask of this chart (the alternates switch below):
    // filled in as the pieces it needs are made.
    svg.chartApi = {};
    // This chart's control bar: source_stats.chart.render_section emits it
    // directly ahead of the SVG. A page that placed a lone bar elsewhere by
    // hand still has only one to mean.
    const prev = svg.previousElementSibling;
    const controls = prev && prev.matches('.chart-controls') ? prev
      : charts.length === 1 ? document.querySelector('.chart-controls') : null;
    // Matched by id / name PREFIX: the engine suffixes both per chart so two
    // bars stay two radio groups ('scale-log-open-todoist-tasks'), and a page
    // built before it did carries the bare form. Both answer to 'scale-log'.
    const ctl = id => controls ? controls.querySelector(`input[id^="${id}"]`) : null;
    const ctlGroup = name => controls ? controls.querySelectorAll(`input[name^="${name}"]`) : [];
    const isOn = id => { const el = ctl(id); return !!el && el.checked; };
    // The server's payload, never written to. Everything below reads
    // `points`, a VIEW of it — the same snapshots, or one per day — rebuilt by
    // loadPoints() when the resolution radio moves.
    let rawPoints;
    try { rawPoints = JSON.parse(svg.dataset.chartPoints); } catch (e) { rawPoints = null; }
    if (rawPoints && rawPoints.length) {
      // W is the drawing's width in viewBox units — `let`: fitWidth (below)
      // redraws the chart at its box's own width.
      let W = +svg.dataset.chartW;
      const H = +svg.dataset.chartH;
      // padL is `let`: fitPadLeft widens it past the server's when a
      // zoomed axis needs longer labels, and returns it after.
      const basePadL = +svg.dataset.chartPadLeft;
      let padL = basePadL;
      const padR = +svg.dataset.chartPadRight;
      // Set further down; declared here because redraw calls both when
      // fitPadLeft moves the plot, which can happen before they are set.
      let refreshAxis = () => {};
      let onWidth = () => {};       // the crosshair's refresh, once it exists
      const padT = +svg.dataset.chartPadTop, padB = +svg.dataset.chartPadBottom;
      // The server sized these for the totals. `let`, like the log bounds
      // below: showing one project re-measures both axes (measure()).
      let yMaxLines = +svg.dataset.chartYMaxLines;
      // Display unit (source_stats.chart `unit_scale` / `decimals`): the
      // points are raw whole numbers (bytes); what the reader sees is
      // divided by unitScale and shown to `decimals` places. 1 / 0 = as
      // before.
      const unitScale = +svg.dataset.chartUnitScale || 1;
      const decimals = +svg.dataset.chartDecimals || 0;
      const plain = unitScale === 1 && !decimals;
      // One formatter per decimal count, made once: toLocaleString builds
      // a fresh one on every call in Chrome (~13 µs with options, less
      // without), and pinColumns formats every point — 533 ms of Workshop
      // Stats' load (measured 2026-11-03). A default NumberFormat writes
      // exactly what a bare toLocaleString() does.
      const plainFormat = new Intl.NumberFormat();
      const formatters = new Map();
      const formatter = places => {
        let f = formatters.get(places);
        if (!f) {
          f = new Intl.NumberFormat(undefined, {
            minimumFractionDigits: places, maximumFractionDigits: places });
          formatters.set(places, f);
        }
        return f;
      };
      const fmtNum = (v, places) => plain ? plainFormat.format(v)
        : formatter(places).format(v / unitScale);
      let yMaxWords = +svg.dataset.chartYMaxWords;
      let chartW = W - padL - padR;
      const chartH = H - padT - padB;
      const DAY_MS = 86400000;

      // ── Counts / Share (user decision 2026-10-24) ────────────────────────
      // Where the server names parts in data-chart-share (source_stats.chart
      // `share`), the Share radio redraws the chart as each part's
      // percentage of the record's total, one line per part. Nothing new
      // rides in the payload: a share is a part's own series divided by the
      // totals, point by point (see "One project at a time" below). The
      // axis is linear and runs to at most 100%; the scale radios go inert.
      let shareKeys = [];
      try { shareKeys = JSON.parse(svg.dataset.chartShare || '[]'); } catch (e) { shareKeys = []; }
      const shareOn = () => shareKeys.length > 0 && isOn('measure-share');

      // ── Point resolution: every snapshot, or one point per day ───────────
      // The public page's payload arrives collapsed to days (data-chart-daily
      // — a privacy rule the engine applies before the timestamps reach the
      // markup, source_stats.chart._collapse_daily) and offers no choice. A
      // payload that kept its clock times — the private page, the consoles —
      // carries a Snapshots / Days radio instead, and Days applies THE SAME
      // RULE here: the sleep day (day_cut, since 2026-11-08; the UTC
      // calendar day before), the day's last snapshot, stamped midnight, idle days carrying the previous value forward so the series
      // holds flat and steps rather than ramping across a gap. So the private
      // page's Days view is the public page's chart, point for point — one of
      // its views, not a different page. Change one rule, change both.
      //
      // One extension the server cannot make (2026-10-07): the grid runs
      // THROUGH TODAY, not just to the last snapshot's day. The carry-forward
      // argument does not stop at the last build — a day since then with no
      // build is the same kind of idle day, and the count really held — so
      // the Days view reaches the present and its 24h row reads a plain zero
      // there. A page is built by a build, so the server's grid already ends
      // on its own today and only goes stale afterwards; the points the two
      // share stay identical. Never past today: there is no value there.
      // Snapshots mode gets no such point — its points are real builds, and
      // a synthetic one at now would be the chart's one invented reading.
      //
      // Returns one entry per output point: the ts to show and the index of
      // the raw snapshot it reads. Snapshots mode is the identity.
      // The sleep day a timestamp falls in; a bare date is its own day.
      // Before day_cut has loaded, the UTC date — only ever for a moment.
      let dayCut = null;
      const dayKey = ts => {
        const t = String(ts);
        const ms = Date.parse(t);
        return dayCut && t.length > 10 && !isNaN(ms)
          ? dayCut.dayOf(ms, dayCut.DAY_CUT.SLEEP, TZ) : t.slice(0, 10);
      };
      const collapseDaily = raw => {
        const lastOf = new Map();   // 'YYYY-MM-DD' → index of that day's LAST snapshot
        raw.forEach((p, i) => {
          const day = dayKey(p.ts);
          const j = lastOf.get(day);
          // Not trusting payload order: a mis-ordered input would otherwise
          // stamp some other build's values onto the day.
          if (j === undefined || raw[j].ts <= p.ts) lastOf.set(day, i);
        });
        const days = [...lastOf.keys()].filter(d => !isNaN(Date.parse(d))).sort();
        if (!days.length) return raw.map((p, i) => ({ ts: p.ts, j: i }));
        const out = [];
        let carried = lastOf.get(days[0]);
        const end = Math.max(Date.parse(days[days.length - 1]),
                             Date.parse(dayKey(now.toISOString())));
        for (let ms = Date.parse(days[0]); ms <= end; ms += DAY_MS) {
          const day = new Date(ms).toISOString().slice(0, 10);
          if (lastOf.has(day)) carried = lastOf.get(day);
          out.push({ ts: `${day}T00:00:00Z`, j: carried });
        }
        return out;
      };
      const serverDaily = svg.dataset.chartDaily === '1';
      const daysMode = () => isOn('res-days');

      // ── One solstice year at a time (user decision 2026-10-18) ──────────
      // The December solstice day to the day before the next — the atlas
      // Pulse view's year (instants: source_stats/solstices.py). A day is the
      // reader's local date as UTC-midnight ms, the marks engine's convention.
      // Opens on today's year. No instants → `yr` null, whole history shown.
      let solMs = [];
      try {
        solMs = JSON.parse(svg.dataset.chartSolstices || '[]');
      } catch (e) { solMs = []; }
      const localDayMs = ms => {
        const d = new Date(ms);
        return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
      };
      const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
      const firstDataDay = localDayMs(Math.min(...rawPoints
        .map(p => Date.parse(p.ts)).filter(Number.isFinite)));
      const todayDay = localDayMs(+now);
      const starts = solMs.map(localDayMs).sort((a, b) => a - b);
      const years = [];
      for (let i = 0; i + 1 < starts.length; i++) {
        // From the first point's year to today's; named by its last day's
        // calendar year (Dec 21 2025 → Dec 20 2026 is 2026).
        if (starts[i + 1] <= firstDataDay || starts[i] > todayDay) continue;
        years.push({
          startMs: starts[i], endMs: starts[i + 1],
          name: isoOf(starts[i + 1] - DAY_MS).slice(0, 4),
        });
      }
      let yearIdx = years.findIndex(
        y => y.startMs <= todayDay && todayDay < y.endMs);
      if (yearIdx < 0) yearIdx = years.length - 1;
      let yr = years.length ? years[yearIdx] : null;

      // What `points` currently is, and everything derived from its shape.
      // All `let`: loadPoints() rebuilds the lot, and every function below
      // reads these bindings live rather than caching a value.
      let points, dates, idxMap, span24, spanToday, dayGranular;
      let dataEndMs, domainMinMs, domainMaxMs;
      // The current blocks' end once the engine has said where it is, so a
      // rebuilt domain keeps the window the axis was widened to (whole-history
      // fallback only).
      let winEndMs = 0;
      // ── Year | Zoom (user decision 2026-10-30) ──────────────────────────
      // Zoom shows the previous block and the current blocks — the start of
      // the block before them to the end of the window the axis already
      // closes on — and fits the linear axis to what that shows, floor and
      // all (measure). The window is the marks engine's, so it waits for it
      // (below); without blocks (data vault unmounted) the last
      // ZOOM_FALLBACK_DAYS. Every chart opens on Year.
      let zoomWin = null;                    // {startMs, endMs}
      const zoomOn = () => isOn('span-zoom');
      const ZOOM_FALLBACK_DAYS = 120;
      let syncSpanNav = () => {};            // the year arrows, once built
      function setDomain() {
        if (zoomOn()) {
          if (zoomWin) {
            domainMinMs = zoomWin.startMs; domainMaxMs = zoomWin.endMs;
          } else {
            domainMaxMs = Math.max(dataEndMs, +now);
            domainMinMs = domainMaxMs - ZOOM_FALLBACK_DAYS * DAY_MS;
          }
          return;
        }
        if (yr) { domainMinMs = yr.startMs; domainMaxMs = yr.endMs; return; }
        domainMinMs = +dates[0];
        domainMaxMs = Math.max(dataEndMs, winEndMs);
      }
      // One value per point out of a per-RAW-snapshot array — how a project's
      // series (indexed by the server against the raw payload) follows the
      // view: a day shows the value its last snapshot had.
      const pick = arr => idxMap.map(j => arr[j]);
      // ── Live ─────────────────────────────────────────────────────────────
      // A chart that names a live count (`data-chart-live`, source_stats.
      // chart `live` — user decisions 2026-10-30, the Backlog's open tasks)
      // gets it as one more point after its newest reading: the line runs on
      // to it, the readout and the 24h row read it. READ, NEVER RECORDED — the payload is untouched,
      // so the log stays one reading a day. Asked on open and every five
      // minutes (below). A series chart's lines get their live values too,
      // by key, where the live answer carries them (liveHook).
      const liveUrl = svg.dataset.chartLive || '';
      let live = null;                       // {ms, total[, line keys]}
      // A series chart's live values (filed / unfiled): its picker fills
      // them in, at the live point's own index (below).
      let liveHook = () => {};
      // ── Checked ──────────────────────────────────────────────────────────
      // A chart of commit-checked counts (`data-chart-checked`, source_stats
      // .chart `checked` — user decision 2026-11-13) learns when the counts
      // were last CHECKED. A reading is recorded only when a count changes,
      // so without this a quiet line stops at its last change; with it the
      // line runs on, flat, to the check — never further. Read on open and
      // every five minutes, like the live point.
      const checkedUrl = svg.dataset.chartChecked || '';
      let checkedMs = NaN;
      function loadPoints() {
        const view = daysMode() ? collapseDaily(rawPoints) : rawPoints.map((p, i) => ({ ts: p.ts, j: i }));
        idxMap = view.map(v => v.j);
        points = view.map(v => ({ ts: v.ts, total: rawPoints[v.j].total, words: rawPoints[v.j].words }));
        dates = points.map(p => new Date(p.ts));
        if (live && dates.length && live.ms > +dates[dates.length - 1]) {
          points.push({ ts: new Date(live.ms).toISOString(), total: live.total,
                        words: null, live: true });
          dates.push(new Date(live.ms));
          // Its own slot, one past the payload: a series' value there is the
          // live one (liveHook), never the last recorded reading.
          idxMap.push(rawPoints.length);
        }
        const tail = points[points.length - 1];
        // In Days, a check on the newest day adds nothing: that day's point
        // already stands for it.
        if (dates.length && checkedMs > +dates[dates.length - 1]
            && !(daysMode() && dayKey(new Date(checkedMs).toISOString())
                 === dayKey(tail.ts))) {
          points.push({ ts: new Date(checkedMs).toISOString(),
                        total: tail.total, words: tail.words, checked: true });
          dates.push(new Date(checkedMs));
          // The newest reading's slot again: every series holds its value.
          idxMap.push(idxMap[idxMap.length - 1]);
        }
        const last = dates[dates.length - 1];
        // Where the DATA ends: the newest snapshot, or now. The chart's
        // domain starts here too, and widens to the current blocks' end
        // once the engine can say where that is.
        dataEndMs = +(last > now ? last : now);
        setDomain();
        dayGranular = serverDaily || daysMode();
        // span24[i] / spanToday[i] — the [from, to] points whose difference
        // is point i's `24h` and `today` change (the readout, below), or
        // null where the history does not reach back that far.
        // DAYS (a day per point): `24h` is the day before's point to this
        // one — the change over its sleep day — and there is no `today`.
        // SNAPSHOTS: `24h` is the last whole sleep day before point i, 04:00
        // to 04:00, and `today` its own sleep day so far: from the last
        // snapshot BEFORE its 04:00 (a reading at 04:00 sharp is the new
        // day's) to i. Precomputed, so a hover is an array lookup.
        span24 = new Array(points.length).fill(null);
        spanToday = new Array(points.length).fill(null);
        const ms = dates.map(d => d.getTime());
        if (dayGranular) {
          let j = -1;
          for (let i = 0; i < points.length; i++) {
            const cutoff = ms[i] - DAY_MS;
            while (j + 1 < points.length && ms[j + 1] <= cutoff) j++;
            if (j >= 0) span24[i] = [j, i];
          }
        } else if (dayCut) {
          // The newest point strictly before `edge`, or -1.
          const before = edge => {
            let lo = 0, hi = ms.length;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (ms[mid] < edge) lo = mid + 1; else hi = mid;
            }
            return lo - 1;
          };
          const SLEEP = dayCut.DAY_CUT.SLEEP;
          for (let i = 0; i < points.length; i++) {
            const day = dayCut.dayOf(ms[i], SLEEP, TZ);
            const [start] = dayCut.dayWindow(day, SLEEP, TZ);
            const prev = new Date(Date.parse(day) - DAY_MS)
              .toISOString().slice(0, 10);
            const [prevStart] = dayCut.dayWindow(prev, SLEEP, TZ);
            const a = before(prevStart), b = before(start);
            if (a >= 0) span24[i] = [a, b];
            if (b >= 0) spanToday[i] = [b, i];
          }
        }
      }
      loadPoints();
      const xForMs = ms => padL + chartW * (ms - domainMinMs) / Math.max(1, domainMaxMs - domainMinMs);
      const xs = d => xForMs(+d);

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
      // Points inside the window plus one neighbour each side, whose segments
      // cross the (clipped) plot edges.
      function onScreen() {
        let before = -1, after = -1;
        const out = [];
        for (let i = 0; i < points.length; i++) {
          const t = +dates[i];
          if (t < domainMinMs) before = i;
          else if (t < domainMaxMs) out.push(i);
          else { after = i; break; }
        }
        if (before >= 0) out.unshift(before);
        if (after >= 0) out.push(after);
        return out;
      }
      // On-screen values without gaps (a project is null where it did not
      // exist). Filled by measure().
      let totals = [], wordVals = [];
      // Smallest 1-2-5 ladder value ≥ raw (…, 0.1, 0.2, 0.5, 1, 2, 5, 10, …).
      const niceStep = raw => {
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw - 1e-9) || 10 * p;
      };
      // A page's fixed floor, in ln units (data-chart-log-floor, source_stats
      // .chart render_svg `log_floor`; user decision 2026-11-05): the axis
      // starts no lower, so a young part's first readings run off the bottom
      // instead of squashing every other line. Ignored when nothing on
      // screen reaches above it, so the chart never goes blank.
      const logFloor = svg.dataset.chartLogFloor !== undefined
        ? +svg.dataset.chartLogFloor : null;
      const lnBounds = (vals, floor = null) => {
        if (!vals.length) return { lo: 0, hi: 2, step: 0.5 };
        let lo = Math.floor(ln(Math.min(...vals)));
        if (floor !== null && ln(Math.max(...vals)) > floor) {
          lo = Math.max(lo, floor);
        }
        const raw = Math.max(ln(Math.max(...vals)) - lo, 1e-6) / 4; // per-step to cover data
        const step = niceStep(raw);
        return { lo, hi: lo + step * 4, step };
      };
      let lnLines, lnWords;
      // Totals' axis top: mirrors source_stats.chart._round_up_axis_max.
      const roundUpAxisMax = vals => {
        const raw = vals.length ? Math.max(...vals) : 0;
        if (raw <= 0) return 4;
        const rawStep = raw / 4;
        const mag = rawStep >= 1
          ? Math.pow(10, Math.floor(Math.log10(rawStep))) : 1;
        const norm = rawStep / mag;
        return 4 * mag * (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10);
      };
      // One project's axis top: four equal whole-number steps, the smallest
      // that cover the project's own maximum. A FINER ladder than the 1-2-5
      // the totals axis is sized on: that one can leave a curve in the bottom
      // 40% of the plot — 8,677 lines would sit under a 20,000 axis — which
      // is tolerable for the one chart the page opens on and wrong for a view
      // whose whole point is this project's shape. Here the same count gets
      // 10,000.
      //
      // ROUND STEPS ONLY (user decision 2026-10-18): every gridline lands on
      // a 1 / 2 / 2.5 / 5 × power-of-ten multiple, the same rule the log
      // axis keeps. The ladder had 1.5, 3, 4, 6 and 8 too, which drew lines
      // every 80,000 or 150,000 — whole numbers, but not round ones. A curve
      // can now top out a little lower (at worst about half the height,
      // where it was two-thirds), which buys a grid that reads at a glance.
      const AXIS_STEPS = [1, 2, 2.5, 5, 10];
      const niceMax = vals => {
        const raw = Math.max(1, Math.max(0, ...vals) / 4);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        return 4 * AXIS_STEPS.map(m => m * mag)
          .find(step => Number.isInteger(step) && step >= raw - 1e-9);
      };
      // Zoom's linear axis: four round steps (AXIS_STEPS) from a floor at a
      // step multiple, the smallest that cover the window's values — so the
      // axis may start above 0, and its bottom label says where. `whole`
      // keeps counts on whole-number steps.
      let yMinLines = 0, yMinWords = 0;
      const fitBounds = (vals, whole) => {
        const lo0 = Math.min(...vals), hi0 = Math.max(...vals);
        const raw = Math.max((hi0 - lo0) / 4, Math.abs(hi0) * 0.005,
                             whole ? 1 : 1e-9);
        let mag = Math.pow(10, Math.floor(Math.log10(raw)));
        for (let t = 0; t < 3; t++, mag *= 10) {
          for (const m of AXIS_STEPS) {
            const step = m * mag;
            if (whole && !Number.isInteger(step)) continue;
            const lo = Math.max(0, Math.floor(lo0 / step) * step);
            if (lo + 4 * step >= hi0 - 1e-9) return { lo, hi: lo + 4 * step };
          }
        }
        return { lo: 0, hi: roundUpAxisMax(vals) };
      };
      let scoped = false;   // `points` holds one project, not the totals
      // OVERLAY (user decision 2026-10-18): two or more projects chosen at
      // once are drawn together, one line each, on one left axis. Each rides
      // `points` under its own key (o0, o1, …) — the same per-point shape the
      // totals and words use — so tracing, the 24h deltas, the pinned
      // columns and the log scale all serve every line with no second code
      // path. Empty = the single-series chart, exactly as before.
      let overlayKeys = [], overlayPaths = [], overlayDots = [], overlayInfo = [];
      // Nothing ticked in the picker (user decision 2026-10-24): an empty
      // frame, in Counts and Share alike.
      let emptyChart = false;
      // Size both axes to what the window shows.
      function measure() {
        const idx = onScreen();
        const lineKeys = overlayKeys.length ? overlayKeys : ['total'];
        totals = idx.flatMap(i => lineKeys.map(k => points[i][k])).filter(v => v != null);
        wordVals = idx.map(i => points[i].words).filter(v => v != null);
        lnLines = lnBounds(totals, logFloor);
        lnWords = wordVals.length
          ? lnBounds(wordVals) : { lo: 0, hi: 2, step: 0.5 };
        // An empty chart keeps the counts axis it had; a share axis is 100%.
        if (shareOn()) {
          yMaxLines = totals.length ? Math.min(100, niceMax(totals)) : 100;
        } else if (totals.length) {
          yMaxLines = unitScale !== 1
            ? niceMax(totals.map(v => v / unitScale)) * unitScale
            : scoped ? niceMax(totals) : roundUpAxisMax(totals);
        }
        yMaxWords = scoped ? niceMax(wordVals)
          : wordVals.length ? roundUpAxisMax(wordVals) : 0;
        yMinLines = 0; yMinWords = 0;
        if (zoomOn() && !shareOn() && totals.length) {
          const b = fitBounds(totals.map(v => v / unitScale), unitScale === 1);
          yMinLines = b.lo * unitScale; yMaxLines = b.hi * unitScale;
        }
        if (zoomOn() && wordVals.length) {
          const b = fitBounds(wordVals, true);
          yMinWords = b.lo; yMaxWords = b.hi;
        }
      }
      measure();
      // Label a tick with just enough decimals for its step (0.5→"9.5", 1→"9").
      const fmtStep = (v, step) => {
        const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
        return Number(v.toFixed(d)).toString();
      };
      const lnPos = (v, b) => (ln(v) - b.lo) / (b.hi - b.lo);
      // Counts on an axis reaching 10,000 read in thousands, "400k" (user
      // decision 2026-11-08); source_stats.chart `_shown` is the same rule.
      const kTick = (v, top) => {
        const r = Math.round(v);
        return top >= 10000 && r
          ? `${(r / 1000).toLocaleString(
            undefined, { maximumFractionDigits: 2 })}k`
          : r.toLocaleString();
      };

      const SCALES = {
        linear: {
          yl: v => padT + chartH * (1 - (v - yMinLines) / (yMaxLines - yMinLines)),
          yw: v => yMaxWords <= yMinWords ? padT + chartH
            : padT + chartH * (1 - (v - yMinWords) / (yMaxWords - yMinWords)),
          labL: i => {
            const v = yMinLines + (yMaxLines - yMinLines) * i / 4;
            return shareOn() ? `${Math.round(v)}%`
              : unitScale !== 1
              ? (v / unitScale).toLocaleString(
                undefined, { maximumFractionDigits: 2 })
              : kTick(v, yMaxLines);
          },
          labR: i => kTick(
            yMinWords + (yMaxWords - yMinWords) * i / 4, yMaxWords),
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
      // Clip the series to the plot's x-range: they run through the points
      // either side of the window.
      // Zoom too: its fitted axis leaves older values above the plot or
      // below its floor, so the clip closes top and bottom as well.
      let plotClip = null;          // its rect, which fitWidth resizes
      {
        const clipNS = 'http://www.w3.org/2000/svg';
        const clip = document.createElementNS(clipNS, 'clipPath');
        clip.id = 'stats-plot-clip-' + Math.random().toString(36).slice(2, 10);
        const rect = document.createElementNS(clipNS, 'rect');
        rect.setAttribute('x', padL); rect.setAttribute('y', padT - 2);
        rect.setAttribute('width', chartW);
        rect.setAttribute('height', chartH + 4);
        plotClip = rect;
        clip.appendChild(rect);
        svg.appendChild(clip);
        [linesPath, wordsPath].forEach(
          p => p && p.setAttribute('clip-path', `url(#${clip.id})`));
      }
      // A words curve needs two points to be a curve — the server's own rule
      // for emitting the path, asked again of whichever series is on screen.
      const hasWords = () => !!wordsPath && wordVals.length >= 2;
      const leftLabels = svg.querySelectorAll('.y-label-left');
      const rightLabels = svg.querySelectorAll('.y-label-right');
      const legendLines = svg.querySelector('.legend-lines');
      const legendWords = svg.querySelector('.legend-words');
      // What the left series IS, as the server named it in the legend — the
      // readout and the table say the same word the chart does, rather than
      // 'Lines' under a chart of open tasks.
      const seriesName = (legendLines && legendLines.textContent) || 'Lines';

      // One series as path data. The pen LIFTS over a null rather than
      // bridging it: a project that left the log and came back did not hold a
      // value in between, and a line across the gap would draw one.
      const trace = (key, y) => {
        let d = '', pen = false;
        points.forEach((p, i) => {
          if (p[key] == null) { pen = false; return; }
          d += `${pen ? ' L ' : ' M '}${xs(dates[i]).toFixed(1)},${y(p[key]).toFixed(1)}`;
          pen = true;
        });
        return d.trim();
      };
      // ── Today ────────────────────────────────────────────────────────────
      // A dashed red guide at now (stats.css .today-line — the atlas's anchor
      // red, user decision 2026-10-07), drawn only when the newest point is
      // more than 24 hours old (placeToday; user decision 2026-11-13). The
      // axis runs past now to the end of the current blocks; while the data
      // is fresh the series' own end shows where it stops, so the line is
      // kept for the stale case: no data since the series ends, or a page
      // not rebuilt since an earlier day. Behind the series like the
      // boundary lines, and placed by redraw(): the domain it sits in widens
      // once the marks engine says where the current blocks end. Drawn in
      // both resolutions — today is a fact of the clock, not of the series.
      // The strip beyond it reads the newest point (indexAt, user decision
      // 2026-11-08), as the strip before the first point reads the first.
      const SVGNS = 'http://www.w3.org/2000/svg';
      const STALE_AFTER_MS = 24 * 3600 * 1000;
      const todayLayer = document.createElementNS(SVGNS, 'g');
      todayLayer.setAttribute('class', 'today-layer');
      const todayLine = document.createElementNS(SVGNS, 'line');
      todayLine.setAttribute('class', 'today-line');
      todayLine.setAttribute('y1', padT);
      todayLine.setAttribute('y2', H - padB);
      const todayTip = document.createElementNS(SVGNS, 'title');
      todayTip.textContent = `Today · ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      todayLine.appendChild(todayTip);
      todayLayer.appendChild(todayLine);
      svg.insertBefore(todayLayer, svg.firstChild);
      // ── Marks ────────────────────────────────────────────────────────────
      // Dated guides the page asked for (source_stats.chart `marks`, user
      // decision 2026-10-23 — the day the repository was built): a quiet
      // dashed line behind the series with its label at the top, hidden
      // when its day falls outside the window. Placed with today's line.
      let markData = [];
      try { markData = JSON.parse(svg.dataset.chartMarks || '[]'); } catch (e) { markData = []; }
      const markEls = markData.map(([ts, label]) => {
        const g = document.createElementNS(SVGNS, 'g');
        g.setAttribute('class', 'mark-layer');
        const line = document.createElementNS(SVGNS, 'line');
        line.setAttribute('class', 'mark-line');
        line.setAttribute('y1', padT);
        line.setAttribute('y2', H - padB);
        const tip = document.createElementNS(SVGNS, 'title');
        tip.textContent = `${label} · ${ts.slice(0, 10)}`;
        line.appendChild(tip);
        const text = document.createElementNS(SVGNS, 'text');
        text.setAttribute('class', 'mark-label');
        text.setAttribute('y', padT + 10);
        text.textContent = label;
        g.appendChild(line);
        g.appendChild(text);
        svg.insertBefore(g, svg.firstChild);
        return { ms: +new Date(ts), g, line, text };
      });
      function placeMarks() {
        markEls.forEach(m => {
          const x = xForMs(m.ms);
          m.line.setAttribute('x1', x.toFixed(1));
          m.line.setAttribute('x2', x.toFixed(1));
          m.text.setAttribute('x', (x + 4).toFixed(1));
          m.g.style.display = x > padL + 0.5 && x < W - padR - 0.5 ? '' : 'none';
        });
      }
      function placeToday() {
        placeMarks();
        const x = xForMs(+now);
        todayLine.setAttribute('x1', x.toFixed(1));
        todayLine.setAttribute('x2', x.toFixed(1));
        // Only once the data is more than a day old (user decision
        // 2026-11-13): while it is fresh, where the series ends already says
        // where it stops, and the line only repeated it. `dates` carries the
        // live point and the last check too, so either counts as fresh.
        const newest = dates.length ? +dates[dates.length - 1] : -Infinity;
        const stale = +now - newest > STALE_AFTER_MS;
        // Only strictly inside the plot — on the right edge it would double
        // the frame's own line.
        todayLayer.style.display =
          stale && x > padL + 0.5 && x < W - padR - 0.5 ? '' : 'none';
      }

      function redraw(mode) {
        const s = SCALES[mode] || SCALES.linear;
        if (linesPath) linesPath.setAttribute('d', overlayKeys.length ? '' : trace('total', s.yl));
        overlayPaths.forEach((path, n) => path.setAttribute('d', trace(overlayKeys[n], s.yl)));
        if (wordsPath) wordsPath.setAttribute('d', trace('words', s.yw));
        leftLabels.forEach((el, i) => { el.textContent = s.labL(i); });
        rightLabels.forEach((el, i) => { el.textContent = s.labR(i); });
        placeToday();
        if (fitPadLeft()) { redraw(mode); refreshAxis(); onWidth(); }
      }

      // The left margin fits the left labels (source_stats.chart sizes it
      // the same way, for the full-history axis). It never goes below the
      // server's, so only a zoomed axis whose labels run longer ("19.975k")
      // moves the plot.
      function fitPadLeft() {
        const widest = Math.max(0, ...[...leftLabels]
          .map(el => el.textContent.length));
        const np = Math.max(basePadL, Math.round(widest * 5.7) + 10);
        if (np === padL) return false;
        svg.querySelectorAll('line').forEach(l => {
          if (+l.getAttribute('x1') === padL) l.setAttribute('x1', np);
        });
        leftLabels.forEach(el => el.setAttribute('x', np - 6));
        svg.querySelectorAll('.legend-lines')
          .forEach(el => el.setAttribute('x', np));
        padL = np;
        chartW = W - padL - padR;
        if (plotClip) {
          plotClip.setAttribute('x', padL);
          plotClip.setAttribute('width', chartW);
        }
        return true;
      }

      // Series visibility — two orthogonal checkboxes. Each hides its path, that
      // axis's labels, and its legend swatch; unchecking both leaves a bare
      // gridded frame.
      const showLines = ctl('series-lines');
      const showWords = ctl('series-words');
      const setVis = (els, on) => els.forEach(el => { if (el) el.style.display = on ? '' : 'none'; });
      function applyVisibility() {
        const lOn = !showLines || showLines.checked;
        if (emptyChart) {
          // Every line unticked: an empty frame, its axis kept.
          setVis([linesPath, legendLines, wordsPath, legendWords, ...rightLabels], false);
          setVis([...leftLabels], lOn);
          return;
        }
        if (overlayKeys.length) {
          // The picker's swatches are the legend while several lines show.
          setVis([linesPath, legendLines, wordsPath, legendWords, ...rightLabels], false);
          setVis([...overlayPaths, ...leftLabels], lOn);
          return;
        }
        setVis([linesPath, legendLines, ...leftLabels], lOn);
        setVis([wordsPath, legendWords, ...rightLabels], hasWords() && (!showWords || showWords.checked));
      }
      // No words series on this page → the Words checkbox controls nothing.
      if (!wordsPath && showWords) { showWords.checked = false; showWords.disabled = true; }

      // Initial y-scale draw + series visibility (Linear default), then wire the
      // scale + series controls to re-scale / re-filter in place.
      // A share is always drawn linear: the log radio keeps its state but
      // stands aside while Share shows.
      const currentMode = () => !shareOn() && isOn('scale-log') ? 'log' : 'linear';
      const syncScaleRadios = () => ctlGroup('chart-scale').forEach(r => {
        r.disabled = shareOn();
      });
      redraw(currentMode());
      applyVisibility();
      if (liveUrl) {
        const askLive = async () => {
          try {
            const r = await fetch(liveUrl, { cache: 'no-store' });
            if (!r.ok) return;
            const d = await r.json();
            const ms = Date.parse(d.at);
            if (typeof d.total !== 'number' || isNaN(ms)) return;
            if (live && live.ms === ms
                && JSON.stringify(live.values) === JSON.stringify(d)) return;
            live = { ms, total: d.total, values: d };
            liveHook();
            // The Snapshots / Days rebuild: the index space changed.
            loadPoints();
            activeIdx = -1;
            reapply();
            refreshAxis();
          } catch (e) { /* no live point; the line is unchanged */ }
        };
        askLive();
        setInterval(askLive, 300000);
      }
      if (checkedUrl) {
        const askChecked = async () => {
          try {
            const r = await fetch(checkedUrl, { cache: 'no-store' });
            if (!r.ok) return;
            const ms = Date.parse((await r.json()).ts);
            if (isNaN(ms) || ms === checkedMs) return;
            checkedMs = ms;
            loadPoints();
            activeIdx = -1;
            reapply();
            refreshAxis();
          } catch (e) { /* no check time; the line ends at its reading */ }
        };
        askChecked();
        setInterval(askChecked, 300000);
      }
      ctlGroup('chart-scale').forEach(radio => {
        radio.addEventListener('change', () => redraw(currentMode()));
      });
      [showLines, showWords].forEach(cb => cb && cb.addEventListener('change', applyVisibility));

      // Count / delta formatting, shared by the hover readout below and the
      // ledger table. U+2212 MINUS, not a hyphen: the deltas sit in the same
      // tabular-nums column as the counts, and a hyphen is narrower than a digit.
      const DASH = '—';
      // A share reads to one place, its movement in percentage POINTS — a
      // part going from 20% to 22% moved two points, not ten percent.
      const fmtDelta = d => {
        if (!shareOn()) {
          return (d > 0 ? '+' : d < 0 ? '−' : '') + fmtNum(Math.abs(d), decimals);
        }
        const r = Math.abs(d).toFixed(1);
        return (r === '0.0' ? '' : d > 0 ? '+' : '−') + r + ' pt';
      };
      const fmtCount = v => v == null ? DASH
        : shareOn() ? `${v.toFixed(1)}%` : fmtNum(v, decimals);

      // ── X-axis: block / month / week boundary labels ─────────────────────
      // Mirrors the lifespan-atlas clock view: a faint boundary gridline at each
      // period START + the unit label (block no. / month / ISO week no.) centred
      // at the period MIDPOINT. Blocks is the default. The math comes from the
      // shared event-marks engine (引擎 Engines/event-marks) — the SAME module the
      // Atlas uses — so the numbers agree. Loaded via dynamic import so an
      // engine-load failure disables only the x-axis, not the table sorting.
      const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const clampX = x => Math.max(padL, Math.min(W - padR, x));
      let boundaries = [];
      try { boundaries = JSON.parse(svg.dataset.chartBlockBoundaries || '[]'); } catch (e) { boundaries = []; }
      let phaseBnd = [];
      try { phaseBnd = JSON.parse(svg.dataset.chartPhaseBoundaries || '[]'); } catch (e) { phaseBnd = []; }

      // Likewise the unit axis: its boundary lines are placed against the
      // domain, which moves when the first point does (a day starts at
      // midnight, its first snapshot later). (`refreshAxis` is declared
      // beside padL: redraw may call it before this point runs.)

      // The ledger (event-marks/ledger.js) is the marks engine's sibling: it
      // slices the range into periods of one unit (the same walk the axis
      // labels use; user decision 2026-11-08 took away the Table view that
      // read the series at each period's close). One Promise.all, so both
      // fail together if the engine is unreachable.
      Promise.all([
        import('../../引擎 Engines/event-marks/marks.js'),
        import('../../引擎 Engines/event-marks/ledger.js'),
      ]).then(([marks, ledger]) => {
        // Engine loaded → the server date fallbacks give way to unit labels.
        svg.querySelectorAll('.x-date-fallback').forEach(el => el.remove());
        // Today, not the domain end: the context's synthetic current block is
        // sized off todayMs, exactly as the atlas Blocks view sizes it.
        // projLen and the day are the shared rules (2026-10-18): the
        // people.yaml projection, resolved server-side into
        // data-chart-block-proj (empty = the personal average), and TODAY
        // as the 04:00 sleep day on the block grid (since 2026-11-03) — not
        // the raw instant.
        const projLen = svg.dataset.chartBlockProj ? Number(svg.dataset.chartBlockProj) : undefined;
        const blockCtx = marks.computeBlockContext(boundaries, marks.localTodayDayMs(now), projLen);
        // Draw to the end of the current blocks (user decision 2026-09-30):
        // the engine's currentBlocks, the segmenting the atlas Blocks view's
        // Current section uses — the block containing today, or, when its end
        // is not recorded yet, today's slot N AND the projected N+1. So the
        // chart can never stop short of or run past what the atlas calls
        // current. Whatever unit the axis shows — the extent must not jump
        // when the reader toggles Blocks → Months. No blocks (an unmounted
        // data vault) → no window, and the axis ends at now as before.
        const current = marks.currentBlocks(blockCtx);
        const win = marks.currentBlocksWindow(blockCtx);
        if (win) winEndMs = win.endMs;
        // Zoom's window: the block before the current ones, through them.
        if (win && current.length) {
          const first = current[0].startMs;
          const below = (blockCtx.blockMs || []).filter(b => b < first);
          let prev = below.length ? Math.max(...below) : -Infinity;
          if (blockCtx.synthesized)
            prev = Math.max(prev, first - blockCtx.avgLen * DAY_MS);
          zoomWin = { startMs: isFinite(prev) ? prev : first, endMs: win.endMs };
          if (zoomOn()) applySpan();
        }
        if (!yr && winEndMs > domainMaxMs) {
          domainMaxMs = winEndMs;
          redraw(currentMode());
          refreshCrosshair();
        }
        // A period-boundary gridline at x: faint, solid, full plot height. ONE
        // style for every boundary — the axis layer's and the chart's end.
        const boundaryLine = x => {
          const line = document.createElementNS(SVGNS, 'line');
          line.setAttribute('x1', x.toFixed(1)); line.setAttribute('x2', x.toFixed(1));
          line.setAttribute('y1', padT); line.setAttribute('y2', H - padB);
          line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-opacity', '0.08');
          return line;
        };
        // …and, in Blocks mode only, closes on a boundary line like any
        // other: the right edge IS a block boundary, so the Blocks axis draws
        // it (drawXAxis, below). Under Phases / Months / Weeks that edge is
        // no boundary of theirs, so nothing is drawn there.
        const currentBlocksEndLine = () => {
          if (yr || !win || win.endMs < domainMaxMs) return null;
          const endLine = boundaryLine(xForMs(win.endMs));
          endLine.setAttribute('class', 'current-blocks-end');
          const last = current[current.length - 1];
          const tip = document.createElementNS(SVGNS, 'title');
          tip.textContent = `End of block ${last.blockIndex}`
            + ` · ${new Date(win.endMs).toISOString().slice(0, 10)}`
            + (last.recorded ? '' : ' (projected)');
          endLine.appendChild(tip);
          return endLine;
        };
        // Website version phases: [iso, label] pairs → { startMs, label }.
        const phases = phaseBnd.map(([iso, label]) => ({ startMs: marks.isoToDayMs(iso), label }));
        const labelY = H - padB + 16;
        // The engine returns numbers (month index, ISO week, block label);
        // naming is ours. `long` is the table's form, which must stand alone
        // in a column — "Sep" under an axis is fine, "Sep 2026" in a row is
        // needed — while the axis keeps the short form it always had.
        const p2 = n => String(n).padStart(2, '0');
        const labelFor = (p, long) => {
          if (p.unit === 'months') return long ? `${EN_MONTHS[p.monthIndex]} ${p.calendarYear}` : EN_MONTHS[p.monthIndex];
          if (p.unit === 'weeks') return long ? `${p.isoYear}-W${p2(p.isoWeek)}` : String(p.isoWeek);
          if (p.unit === 'blocks') {
            // The atlas's block syntax: "*23" for a projected block.
            const text = marks.formatBlockText(p.label);
            return long ? `Block ${text}` : text;
          }
          return p.label; // phases carry their own "p0.4"
        };
        // Periods of one unit overlapping the data range, already filtered to
        // those that overlap: the engine emits one period early (for the Atlas
        // ring's midpoint labels), which on a linear axis would otherwise clamp
        // a non-overlapping label (e.g. a month before the first snapshot)
        // onto the left edge.
        // `endMs` defaults to the chart's domain.
        const periodsFor = (mode, endMs = domainMaxMs) =>
          ledger.periodsFor(mode, domainMinMs, endMs, { blockCtx, phases });
        // The day count under a Blocks / Phases mark and in the table's Days
        // column — the engine's periodDays, printed the way the atlas Blocks
        // view prints its rows: "57d" a known length, "12d+" still running
        // (days so far), "~54d" a projected block. Months and weeks carry
        // none: their lengths are a given, and a week is too narrow anyway.
        const DAYS_UNITS = ['blocks', 'phases'];
        const fmtDays = p => {
          const r = marks.periodDays(p, +now);
          return r.kind === 'elapsed' ? `${r.days}d+` : r.kind === 'projected' ? `~${r.days}d` : `${r.days}d`;
        };
        const ticksFor = mode => periodsFor(mode).map(p => ({
          ...p, text: labelFor(p, false), days: DAYS_UNITS.includes(mode) ? fmtDays(p) : '',
        }));
        function drawXAxis(mode) {
          const existing = svg.querySelector('.x-axis-layer');
          if (existing) existing.remove();
          const layer = document.createElementNS(SVGNS, 'g');
          layer.setAttribute('class', 'x-axis-layer');
          if (mode === 'blocks') {
            const endLine = currentBlocksEndLine();
            if (endLine) layer.appendChild(endLine);
          }
          for (const t of ticksFor(mode)) {
            const bx = xForMs(t.startMs);
            // Boundary gridline — only when it lands strictly inside the plot,
            // and, for blocks, only where the Clock ring would draw its tick
            // (event-marks boundaryTickShown — one rule for both surfaces):
            // the boundary between today's block and the next is not drawn
            // while it is a projection, so the chart never rules a line at a
            // transition nobody has dated.
            const drawn = mode !== 'blocks' || marks.boundaryTickShown(t.blockIndex, blockCtx);
            if (drawn && bx > padL + 0.5 && bx < W - padR - 0.5) {
              layer.appendChild(boundaryLine(bx));
            }
            // Label centred at the period midpoint, clamped into the plot so an
            // edge period whose midpoint is off-range still shows its number.
            if (t.text) {
              const txt = document.createElementNS(SVGNS, 'text');
              txt.setAttribute('x', clampX(xForMs(t.midMs)).toFixed(1));
              txt.setAttribute('y', labelY);
              txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '10');
              txt.setAttribute('fill', 'currentColor'); txt.setAttribute('fill-opacity', '0.75');
              txt.textContent = t.text;
              layer.appendChild(txt);
            }
            // Its length, smaller and fainter, on a second line — only where
            // the period is wide enough to hold the text (a three-day phase
            // at the start of the log is not), so counts never collide
            // before the labels above them do.
            if (t.days) {
              const visW = xForMs(Math.min(t.endMs, domainMaxMs)) - xForMs(Math.max(t.startMs, domainMinMs));
              if (visW >= t.days.length * 5 + 6) {
                const sub = document.createElementNS(SVGNS, 'text');
                sub.setAttribute('class', 'x-days');
                sub.setAttribute('x', clampX(xForMs(t.midMs)).toFixed(1));
                sub.setAttribute('y', labelY + 10);
                sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('font-size', '9');
                sub.setAttribute('fill', 'currentColor'); sub.setAttribute('fill-opacity', '0.65');
                sub.textContent = t.days;
                layer.appendChild(sub);
              }
            }
          }
          // Behind the series paths (first child) so gridlines don't cross them.
          svg.insertBefore(layer, svg.firstChild);
        }
        const xMode = () =>
          isOn('xaxis-months') ? 'months' :
          isOn('xaxis-weeks') ? 'weeks' :
          isOn('xaxis-phases') ? 'phases' :
          isOn('xaxis-blocks') ? 'blocks' :
          'months';  // no toggle present (e.g. app-stats) → sensible month labels
        drawXAxis(xMode());
        ctlGroup('chart-xaxis').forEach(radio => {
          radio.addEventListener('change', () => drawXAxis(xMode()));
        });
        refreshAxis = () => drawXAxis(xMode());
      }).catch(err => {
        // Log it: a throw anywhere in the axis setup lands here too,
        // and silence once hid a dead axis behind the fallback dates.
        console.error('stats-table: event-marks engine step failed', err);
        // Engine unavailable → keep the server date fallbacks; refresh the
        // right-edge label to the live "now" (its old build-time behaviour).
        const lbl = svg.querySelector('text.x-label-right');
        if (lbl) {
          const yyyy = now.getUTCFullYear();
          const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(now.getUTCDate()).padStart(2, '0');
          lbl.textContent = `${yyyy}-${mm}-${dd}`;
        }
      }).finally(() => {
        // NO FLASH (user decision 2026-10-19). The server draws the whole
        // history; this script narrows it to the year and redraws the axis.
        // stats.css keeps the plot hidden until this attribute is set, so
        // the full-length line is never painted first. Set once the axis
        // is settled either way — engine loaded or not.
        svg.dataset.chartReady = '1';
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
      // ch-grid: the column-aligned, row-per-series readout (stats.css).
      // The other consumer of .chart-readout (site-log-rings) emits a single
      // line of prose and keeps the plain flex layout.
      readout.className = 'chart-readout ch-grid';
      wrap.appendChild(readout);
      // BESIDE THE GRAPH, INSIDE THE COLUMN (user decision 2026-11-05): the
      // graph narrows and the readout takes a fixed column on its right, so
      // the pair is as wide as the rest of the page (stats.css .ch-side). The
      // SVG scales with its box, so its text shrinks with it — accepted. On
      // a column under 35rem (a phone) the readout goes back underneath. The
      // test reads only the column's width, never the readout's content, so
      // ticking a line cannot flip it. (In the margin beyond the column, on
      // wide windows only, earlier the same day.)
      // Beside it, the bars split too (user decision 2026-11-08): the pills
      // over the graph alone, the year and the picker over the readout —
      // both moved into the wrap's grid (stats.css .ch-side areas). Under
      // it, they go back above the wrap as before.
      let navRow = null;
      // Only the bar render_section put right ahead of this chart moves; a
      // lone bar a page placed elsewhere by hand stays where it was put.
      const ownBar = !!controls && wrap.previousElementSibling === controls;
      const placeBars = () => {
        const side = wrap.classList.contains('ch-side');
        if (side) {
          if (navRow) wrap.prepend(navRow);
          if (ownBar) wrap.prepend(controls);
        } else {
          if (navRow) wrap.before(navRow);
          if (ownBar) (navRow || wrap).after(controls);
        }
      };
      const placeReadout = () => {
        const w = wrap.getBoundingClientRect().width;
        if (!w) return;                  // a hidden chart: keep the last place
        const rem = parseFloat(
          getComputedStyle(document.documentElement).fontSize);
        const side = w >= 35 * rem;
        if (side === wrap.classList.contains('ch-side') && wrap.dataset.placed)
          return;
        wrap.dataset.placed = '1';
        wrap.classList.toggle('ch-side', side);
        placeBars();
      };
      placeReadout();
      window.addEventListener('resize', placeReadout);

      // ── DRAWN AT ITS OWN WIDTH (user decision 2026-11-05) ───────────────
      // The server draws at a nominal 800 wide; here the drawing takes the
      // box's real width, one unit per CSS pixel, so its text is the same
      // size in a full column, beside the readout and on a phone, and its
      // height never changes — it is not a picture scaled to fit. Until
      // then the whole drawing scaled with its box. What sits against the
      // right edge moves with it: the server's horizontal gridlines, the
      // Words labels and legend, the last date, the plot's clip; the rest
      // (paths, axis, marks, crosshair) is redrawn from W.
      function setChartWidth(nw) {
        nw = Math.round(nw);
        if (!(nw > padL + padR) || nw === W) return false;
        const old = W, d = nw - old;
        svg.querySelectorAll('line').forEach(l => {
          if (+l.getAttribute('x1') === padL
              && +l.getAttribute('x2') === old - padR) {
            l.setAttribute('x2', nw - padR);
          }
        });
        svg.querySelectorAll('.y-label-right, .legend-words, .x-label-right')
          .forEach(el => el.setAttribute('x', +el.getAttribute('x') + d));
        W = nw;
        chartW = W - padL - padR;
        if (plotClip) plotClip.setAttribute('width', chartW);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        return true;
      }
      function fitWidth() {
        const cs = getComputedStyle(svg);
        const box = svg.getBoundingClientRect().width;
        if (!box) return;               // a hidden chart: drawn when shown
        const inner = box - parseFloat(cs.paddingLeft)
          - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth)
          - parseFloat(cs.borderRightWidth);
        if (!setChartWidth(inner)) return;
        redraw(currentMode());
        refreshAxis();
        onWidth();
      }
      fitWidth();
      // Any change of the box's width — the window, the readout moving
      // beside it or back, a fold opening, a chart taking its turn — redraws.
      // On the next frame: redrawing inside the observer's own callback
      // resizes what it watches, the loop browsers warn about.
      if (window.ResizeObserver) new ResizeObserver(() => {
        requestAnimationFrame(() => { placeReadout(); fitWidth(); });
      }).observe(wrap);

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
      const wordsOn = () => hasWords() && (!showWords || showWords.checked);

      const p2 = n => String(n).padStart(2, '0');
      // Two labelling modes, set by the server or by the Days radio
      // (loadPoints):
      //   • full  — snapshots are stored UTC and rendered in LOCAL time, which
      //     is what "when was I working" means to the reader. Unlabelled.
      //   • daily — the points are one per day and stamped midnight UTC, so
      //     they carry no real clock. Read the ISO date straight off the
      //     string: passing it through Date would print an invented 00:00 and,
      //     for any reader west of UTC, roll the date back a day.
      const fmtWhen = i => {
        if (dayGranular && !points[i].live && !points[i].checked) {
          return points[i].ts.slice(0, 10);
        }
        const d = dates[i];
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
               `${p2(d.getHours())}:${p2(d.getMinutes())}`;
      };

      // Only points inside the window answer the pointer.
      function nearestIndex(vbX) {
        let best = -1, bestD = Infinity;
        for (let i = 0; i < points.length; i++) {
          const t = +dates[i];
          if (t < domainMinMs || t >= domainMaxMs) continue;
          const d = Math.abs(xs(dates[i]) - vbX);
          if (d < bestD) { bestD = d; best = i; }
        }
        return best;
      }

      // ── The 24h and today columns ───────────────────────────────────────
      // The readout's last columns (user decision 2026-11-08; one rolling
      // 24h before): `24h`, how much each count moved over the last whole
      // SLEEP day, 04:00 to 04:00, and `today`, over its own sleep day so
      // far — both read from the moment the heading reports, the hovered
      // snapshot or the newest build at rest, never the reader's clock: a
      // "today" under a line reporting a build from March would be two
      // moments stacked in one box.
      //
      // The figure at an edge is the newest snapshot before it, and that is
      // EXACT: the counts are a step function, changing only where a build
      // recorded a snapshot. A quiet fortnight means that snapshot is a
      // fortnight old and the change is correctly zero. In Days mode every
      // point is a sleep day, so `24h` is the day's change over the day
      // before, and `today` is not drawn. The [from, to] pair per point
      // (span24, spanToday) is built with the points, in loadPoints.
      const change = (span, key) => {
        if (!span) return null;
        const a = points[span[0]][key], b = points[span[1]][key];
        return a == null || b == null ? null : b - a;
      };
      const deltaAt = (i, key) => change(span24[i], key);
      const todayAt = (i, key) => change(spanToday[i], key);
      // The `today` column: snapshots only — a day per point (the Days
      // view, a public page) has no today (user decision 2026-11-08).
      const todayOn = () => !dayGranular;
      const fmtTodayText = (i, k) => {
        const d = todayAt(i, k);
        return d === null ? DASH : fmtDelta(d);
      };

      // ── Pinned value columns ──────────────────────────────────
      // Counts are not all the same width (41,578 → 115,793), so an auto track
      // resizes as the pointer moves and shunts everything to its right along
      // with it — on a series this dense, a permanent shimmer under the cursor.
      // Each value column is measured ONCE against the widest string it will
      // ever hold — its longest count, its longest delta, or the dash — and
      // pinned there, so only the digits change while the layout holds still.
      // Measured with a probe carrying .ch-val rather than with a canvas, so it
      // inherits the real font and tabular-nums instead of a reconstruction.
      // Per series and per column (count, exponent, delta): the readout pins
      // each column to the widest of the series it is showing.
      const colW = {};
      // THE FLOOR EVERY SELECTION SHARES (user request 2026-11-08: ticking
      // `total` moved the key column). The key and count tracks are never
      // narrower than the widest key any series may show — `total` and
      // every part's code, set by the line picker (keyFloorHtml) — and the
      // widest count of the totals, which no part exceeds. The readout sits
      // flush right beside the graph, so a track that grew with the rows
      // showing pushed everything left of it.
      let keyFloorHtml = [];
      const floor = { key: 0, count: 0 };
      // Logarithmic shows each count as its natural log, `e^10.000`, in the
      // count's place, the `e^` grey (user decisions 2026-11-05; it ran
      // after the count, `· e^10.00`, earlier the same day): the axis is in
      // ln steps, so this is the reading in the axis's own terms. Three
      // places (user decision 2026-11-05; two earlier that day): 0.001 is
      // 0.1% growth, so a quiet day still moves it. The column is pinned to the wider of the two forms, so
      // switching scale never moves the readout or the graph beside it.
      const lnOn = () => currentMode() === 'log';
      const lnText = v => v > 0 ? `e^${Math.log(v).toFixed(3)}` : DASH;
      const lnHtml = v => v > 0
        ? `<span class="ch-e">e^</span>${Math.log(v).toFixed(3)}` : DASH;
      // Its 24h change is the exponent's — ln now − ln 24h ago, no `e^`
      // again — in thousandths, always: `+12`, under a `24h (×10⁻³)` heading
      // (user decisions 2026-11-05; `+0.012`, then `+12×10⁻³` on every row,
      // earlier the same day). 1×10⁻³ is about 0.1% growth. The heading's
      // `(×10⁻³)` is grey like the `e^` — bracketed, the usual form for a
      // heading's multiplier, so it cannot read as "24h times" — and a
      // change that rounds to nothing is a bare 0, as the counts' is.
      // `today` takes the same multiplier. Since 2026-11-08 each change
      // column has its own, on a line of its own under its heading (user
      // requests: narrower columns — `today (×10⁻³)` set the column's
      // width on the linear scale too — then one under 24h as well; a
      // single one spanning both read as today's alone).
      const LN_MULT = '(×10⁻³)';
      const lnChange = (span, key) => {
        if (!span) return DASH;
        const u = points[span[0]][key], v = points[span[1]][key];
        if (!(v > 0) || !(u > 0)) return DASH;
        const n = Math.round(1000 * (Math.log(v) - Math.log(u)));
        return n === 0 ? '0' : (n > 0 ? '+' : '−') + Math.abs(n);
      };
      const lnDeltaText = (i, key) => lnChange(span24[i], key);
      const lnTodayText = (i, key) => lnChange(spanToday[i], key);
      function pinColumns() {
        const probe = document.createElement('span');
        probe.className = 'ch-val';
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        readout.appendChild(probe);
        const longest = strs => strs.reduce((a, b) => b.length > a.length ? b : a, '');
        const width = (strs, cls = 'ch-val') => {
          probe.className = cls;
          let w = 0;
          for (const str of strs) {
            probe.textContent = str;
            w = Math.max(w, probe.getBoundingClientRect().width);
          }
          return Math.ceil(w);
        };
        // A change column is as wide as a change of four digits (−9,999;
        // −9.99 on a chart with decimals, −99.9 pt for a share), whatever
        // the history holds (user requests 2026-11-08: "24h and today would
        // ever only likely be 4 digits", and the width must not move): the
        // same before day_cut has landed, when every change is a dash, as
        // after. A rarer, bigger change runs into the gap beside it.
        const unit = (plain ? 9999 : 10 - 10 ** -decimals) * unitScale;
        const wide = [`−${fmtNum(unit, decimals)}`, DASH];
        if (shareKeys.length) wide.push('−99.9 pt');
        for (const key of ['total', 'words', ...overlayKeys]) {
          colW[key] = {
            count: width([longest(points.map(q => fmtCount(q[key]))),
                          longest(points.map(q => lnText(q[key]))), DASH]),
            delta: width([...wide, '24h'], 'ch-val ch-d'),
            today: width([...wide, 'today'], 'ch-val ch-d'),
          };
        }
        probe.className = 'ch-key';
        floor.key = 0;
        for (const h of keyFloorHtml) {
          probe.innerHTML = h;
          floor.key = Math.max(floor.key, probe.getBoundingClientRect().width);
        }
        floor.key = Math.ceil(floor.key);
        floor.count = shareOn() ? 0 : width([
          longest(rawPoints.map(q => fmtCount(q.total))),
          longest(rawPoints.map(q => lnText(q.total)))]);
        probe.remove();
      }

      // ONE ROW PER SERIES (user decision 2026-11-05): a heading row — the
      // moment being read, and `24h` over the change column — then each
      // visible series as key · count · exponent (Logarithmic only) · 24h
      // change. Series ran side by side, the changes on a second row, until
      // then; with several parts and their exponents that row ran off the
      // box. Ticking a series now adds a row, so the page below moves on a
      // tick, never on a hover.
      // Counts are always the raw values: the Log toggle changes the axis, not
      // what the number is — except that Logarithmic writes it as its
      // exponent (lnHtml).
      // A point predating word tracking has words == null and reads as a dash
      // rather than dropping its row.
      function renderReadout(i) {
        const p = points[i];
        const ln = lnOn();
        // A part's share on its name line: whole percent, always — 0.3%
        // reads 0% (user decision 2026-11-05). Its own cell in the change's
        // column, right-aligned so the percentages line up; no dot before
        // it — the column already sets it apart from the name (user
        // decisions 2026-11-05).
        const fmtShare = v => v == null ? ''
          : `<span class="ch-pct">${Math.round(v)}%</span>`;
        // [css class, key html, series key, name line beneath or '']
        const rows = [];
        if (linesOn() && overlayKeys.length) {
          overlayKeys.forEach((k, n) => {
            const o = overlayInfo[n];
            const sw = `<span class="ch-swatch" style="background:${o.color}"></span>`;
            rows.push(o.code
              ? ['ch-f-overlay', `${sw}<span class="ch-code">${o.code}</span>`,
                 k, o.key === '' ? '' : [o.label, fmtShare(p[o.share])]]
              : ['ch-f-overlay', sw + o.label, k, '']);
          });
          // The totals last, under a grey rule, as the Noticeboard widget
          // has them (user decision 2026-11-05) — but only beneath parts.
          const t = overlayInfo.findIndex(o => o.key === '');
          if (t >= 0 && rows.length > 1) {
            const [tot] = rows.splice(t, 1);
            rows.push(['rule'], tot);
          }
        } else if (!overlayKeys.length) {
          if (linesOn()) rows.push(['ch-f-lines', seriesName, 'total']);
          if (wordsOn()) rows.push(['ch-f-words', 'Words', 'words']);
        }
        const two = todayOn();
        let html = `<span class="ch-when ch-head">${fmtWhen(i)}</span>` +
          '<span class="ch-when ch-since">24h</span>' +
          (two ? '<span class="ch-when ch-since">today</span>' : '') +
          (ln ? `<span class="ch-e ch-mult ch-mult-24">${LN_MULT}</span>`
            + (two ? `<span class="ch-e ch-mult">${LN_MULT}</span>` : '')
            : '');
        for (const [cls, label, k, name] of rows) {
          if (cls === 'rule') { html += '<span class="ch-rule"></span>'; continue; }
          const d = deltaAt(i, k);
          html += `<span class="ch-field ${cls}">` +
            `<span class="ch-key">${label}</span>` +
            `<span class="ch-val">${ln ? lnHtml(p[k]) : fmtCount(p[k])}` +
            '</span>' +
            `<span class="ch-val ch-d">${ln ? lnDeltaText(i, k)
              : d === null ? DASH : fmtDelta(d)}` +
            '</span>' +
            (two ? `<span class="ch-val ch-d">${ln ? lnTodayText(i, k)
              : fmtTodayText(i, k)}</span>` : '') +
            (name ? `<span class="ch-name">${name[0]}</span>` +
              `<span class="ch-name ch-name-share">${name[1]}</span>` : '') +
            '</span>';
        }
        // Key, count, [exponent], change — each value track pinned to the
        // widest of the rows showing. A pinned width of 0 means the probe
        // measured inside a hidden box: fall back to an auto track rather
        // than clamping the column shut.
        const track = part => {
          const w = Math.max(floor[part] || 0, ...rows.filter(r => r[2])
            .map(r => (colW[r[2]] || {})[part] || 0));
          return w ? `${w}px` : 'auto';
        };
        const keyTrack = floor.key ? `minmax(${floor.key}px, auto)` : 'auto';
        readout.style.gridTemplateColumns = `${keyTrack} ${track('count')}`
          + ` ${track('delta')}` + (two ? ` ${track('today')}` : '');
        readout.classList.toggle('ch-today', two);
        readout.innerHTML = html;
        // Beside the graph, the readout's column only ever grows: measured
        // when the set of lines changes, never on a mere move.
        const shape = (ln ? 'ln|' : '') + (two ? 'today|' : '') + rows.map(r => r[2]).join(',');
        if (shape !== readoutShape && wrap.classList.contains('ch-side')) {
          readoutShape = shape;
          readout.style.minWidth = '';
          const w = Math.ceil(readout.getBoundingClientRect().width);
          readoutW = Math.max(readoutW, w);
          readout.style.minWidth = `${readoutW}px`;
        }
      }
      let readoutShape = '', readoutW = 0;

      let activeIdx = -1;
      function showAt(i) {
        activeIdx = i;
        const s = SCALES[currentMode()] || SCALES.linear;
        const p = points[i];
        const x = xs(dates[i]);
        chLine.setAttribute('x1', x.toFixed(1));
        chLine.setAttribute('x2', x.toFixed(1));
        // A reading below the axis's bottom (a log floor, or Zoom's fitted
        // axis) gets no dot (user decision 2026-11-05): its line is clipped
        // there, so a dot under the plot would point at nothing.
        const above = y => y <= padT + chartH + 0.5;
        const lOn = linesOn() && p.total != null
          && above(s.yl(p.total));
        const wOn = wordsOn() && p.words != null && above(s.yw(p.words));
        if (lOn) {
          chDotLines.setAttribute('cx', x.toFixed(1));
          chDotLines.setAttribute('cy', s.yl(p.total).toFixed(1));
        }
        if (wOn) {
          chDotWords.setAttribute('cx', x.toFixed(1));
          chDotWords.setAttribute('cy', s.yw(p.words).toFixed(1));
        }
        chDotLines.style.display = lOn && !overlayKeys.length ? '' : 'none';
        chDotWords.style.display = wOn && !overlayKeys.length ? '' : 'none';
        overlayDots.forEach((dot, n) => {
          const v = points[i][overlayKeys[n]];
          const on = linesOn() && v != null && above(s.yl(v));
          if (on) {
            dot.setAttribute('cx', x.toFixed(1));
            dot.setAttribute('cy', s.yl(v).toFixed(1));
          }
          dot.style.display = on ? '' : 'none';
        });
        chLayer.style.display = '';
        renderReadout(i);
      }

      // Resting state: no guide (nothing is being pointed at), but the line
      // still reports the most recent build rather than going blank — the
      // number a visitor most likely wants is the current one (in a past
      // year, its last reading).
      function restIndex() {
        for (let i = points.length - 1; i >= 0; i--) {
          if (+dates[i] < domainMaxMs) return i;
        }
        return points.length - 1;
      }
      // ── Pinning (user decision 2026-10-18) ──────────────────────────────
      // A click PINS the crosshair at the moment under the pointer: the guide
      // and the readout — every line's count at that point — stay there while
      // the pointer moves on, and a click elsewhere moves the pin. A
      // right-click lets go (and is left to the browser's own menu when
      // nothing is pinned). Pinning never changes WHICH lines are drawn; a
      // change of lines keeps the pin, and its readout follows them. Anything
      // that rebuilds the time index (year, Snapshots/Days) lets go, through
      // restCrosshair.
      let pinned = false;
      const setPinned = on => {
        pinned = on;
        chLayer.classList.toggle('pinned', on);
      };
      function restCrosshair() {
        activeIdx = -1;
        setPinned(false);
        chLayer.style.display = 'none';
        renderReadout(restIndex());
      }

      // The snapshot under a pointer event, or -1 for "pointing at nothing".
      function indexAt(evt) {
        const ctm = svg.getScreenCTM();
        if (!ctm) return -1;
        const q = svg.createSVGPoint();
        q.x = evt.clientX; q.y = evt.clientY;
        // Screen → viewBox units: the SVG is width:100% with a fixed viewBox,
        // so the CTM is the only reliable way to undo the responsive scaling.
        const v = q.matrixTransform(ctm.inverse());
        if (v.x < padL - 8 || v.x > W - padR + 8) return -1;
        // Past now the series has no value yet, so the strip beyond the
        // today guide snaps to the newest point, as the strip before the
        // first point snaps to the first (user decision 2026-11-08; inert
        // since 2026-10-07 before). No points lie past now, so the nearest
        // one is already the newest.
        return nearestIndex(v.x);
      }

      svg.addEventListener('pointermove', evt => {
        if (pinned) return;
        const i = indexAt(evt);
        if (i < 0) { restCrosshair(); return; }
        showAt(i);
      });
      svg.addEventListener('pointerleave', () => { if (!pinned) restCrosshair(); });
      svg.addEventListener('click', evt => {
        const i = indexAt(evt);
        if (i < 0) return;
        showAt(i);
        setPinned(true);
      });
      svg.addEventListener('contextmenu', evt => {
        if (!pinned) return;
        evt.preventDefault();
        restCrosshair();
      });
      pinColumns();
      restCrosshair();

      // Re-render whatever the line is currently showing when a toggle moves
      // the geometry or changes which series count. Registered after the
      // redraw()/applyVisibility() listeners above, so the paths and visibility
      // are already settled by the time this runs.
      const refreshCrosshair = () =>
        activeIdx >= 0 ? showAt(activeIdx) : restCrosshair();
      onWidth = refreshCrosshair;
      ctlGroup('chart-scale').forEach(radio => {
        radio.addEventListener('change', refreshCrosshair);
      });
      [showLines, showWords].forEach(cb => cb && cb.addEventListener('change', refreshCrosshair));
      // ── One project at a time ──────────────────────────────────────────
      // The chart opens on the totals. Where the server also published
      // per-project series (data-chart-series — source_stats.chart's
      // `breakdown`), a table row carrying the matching data-series is a
      // click target: the SAME chart redraws for that project alone — its own
      // axes, readout, 24h row and ledger. A second click on the row, the
      // Total row, or the picker's first option goes back to everything.
      //
      // Nothing above knows a selection exists. show() rewrites
      // points[i].total / .words in place — `points` always holds the series
      // ON SCREEN — then re-runs the measure → redraw → readout steps the
      // page load ran, so the paths, the crosshair and the ledger all follow
      // without a second code path. The time axis does NOT move: every
      // project is drawn against the same year window, so a project begun in
      // August starts two-thirds of the way across, where August is.
      // Re-run the measure → redraw → readout steps for whatever `points` now
      // holds. The default is the totals' path; where per-project series
      // exist (below) it becomes show(shown), which does the same for the
      // selected project.
      let reapply = () => {
        measure();
        redraw(currentMode());
        applyVisibility();
        pinColumns();
        refreshCrosshair();
      };

      // The row above the pills: year arrows left, project picker right —
      // or, beside the graph, the two stacked over the readout (placeBars).
      const navRowEl = () => {
        if (!navRow) {
          navRow = document.createElement('div');
          navRow.className = 'chart-nav-row';
          (controls || wrap).before(navRow);
          placeBars();
        }
        return navRow;
      };

      let series = {};
      try { series = JSON.parse(svg.dataset.chartSeries || '{}'); } catch (e) { series = {}; }
      if (Object.keys(series).length) {
        // Steps back to one value per RAW snapshot: [[i, v], …] says v holds
        // from snapshot i until the next step, and nothing (null) before the
        // first. The server indexed the steps against its payload, so they
        // expand against rawPoints, and pick() carries the result into
        // whatever view `points` is.
        const expand = steps => {
          const out = new Array(rawPoints.length).fill(null);
          (steps || []).forEach(([from, v], k) => {
            out.fill(v, from, k + 1 < steps.length ? steps[k + 1][0] : rawPoints.length);
          });
          return out;
        };
        const all = { total: rawPoints.map(p => p.total), words: rawPoints.map(p => p.words) };
        const expanded = {};
        for (const key of Object.keys(series)) {
          expanded[key] = { total: expand(series[key].lines), words: expand(series[key].words) };
        }
        // Each shared part's percentage of the totals at every raw snapshot:
        // null where the part has no reading or the totals none yet (a
        // merged chart's Total starts once every part is recorded).
        const shareSet = new Set(shareKeys.filter(k => expanded[k]));
        const shares = {};
        shareSet.forEach(key => {
          shares[key] = expanded[key].total.map((v, i) => {
            const t = all.total[i];
            return v == null || !t ? null : 100 * v / t;
          });
        });
        // A project's axes are sized by niceMax (measure(), above) — a finer
        // ladder than the totals' 1-2-5.

        // Rows that answer to this chart: a project it has a series for, or
        // the empty key — the Total row, which IS the totals.
        const rows = Array.from(document.querySelectorAll('tr[data-series]'))
          .filter(r => r.dataset.series === '' || series[r.dataset.series]);
        const rowOf = key => rows.find(r => r.dataset.series === key);
        // The picker: the same choice from beside the chart, so comparing
        // projects is not a scroll back up to the table for each. A
        // MULTI-SELECT since 2026-10-18 (user decision): tick several and
        // they are drawn together (the overlay above); one alone is the
        // single-series chart as before; none is the totals. Each ticked
        // project wears the colour of its line, so the list is the legend.
        const picker = document.createElement('details');
        picker.className = 'chart-scope chart-multi';
        const summary = document.createElement('summary');
        summary.setAttribute('aria-label', 'Which projects to chart');
        const panel = document.createElement('div');
        panel.className = 'chart-multi__panel';
        picker.append(summary, panel);
        // ONE FIXED COLOUR PER LINE (user decision 2026-10-18): a line's
        // colour belongs to its series, not to the order it was ticked in,
        // so a project wears the same colour alone and beside others. The
        // totals keep the page accent.
        // A chart that names its colours (data-chart-colours, chosen on
        // the server by source_stats.series_colours — the same rule as
        // assignSeriesColours) keeps them: the Status Board's Workshop
        // Stats card wears the same ones (user decision 2026-11-08).
        try {
          const given = JSON.parse(svg.dataset.chartColours || '{}');
          for (const [k, c] of Object.entries(given)) {
            if (!_pageSeriesColours[k]) _pageSeriesColours[k] = c;
          }
        } catch (e) { /* none given: the widget chooses */ }
        const seriesColour = assignSeriesColours(expanded);
        const colourOf = key =>
          seriesColour[key] || 'var(--accent, #7c9ef5)';

        let shown = '';
        // The lines on screen, in tick order. '' is the TOTALS — a line like
        // any other since 2026-10-18 (user decision), so a project can be
        // drawn against the whole. [''] alone is the default chart.
        let chosen = [''];
        const valuesOf = key => shareOn() && shares[key] ? shares[key]
          : key === '' ? all.total : expanded[key].total;
        // The lines actually drawn. Counts: the choice. Share: the shared
        // parts in it — the totals would be a flat 100% and a part outside
        // the total has no share — or, when it names none, every shared
        // part, so switching to Share on the default chart shows the split.
        // An EMPTY choice — None, or the last line unticked — draws an empty
        // frame in either measure (user decision 2026-10-24).
        const sharedParts = () =>
          Object.keys(series).filter(k => shareSet.has(k) && listed(k));
        const drawnKeys = () => {
          if (!shareOn()) return chosen;
          if (!chosen.length) return [];
          const ks = chosen.filter(k => shareSet.has(k) && listed(k));
          return ks.length ? ks : sharedParts();
        };
        // A page with no table of rows names its lines on the chart itself
        // (data-chart-series-labels, source_stats.chart `series_labels` —
        // the Backlog's All / Filed / Unfiled, 2026-10-30).
        let seriesLabels = {};
        try { seriesLabels = JSON.parse(svg.dataset.chartSeriesLabels || '{}'); } catch (e) { seriesLabels = {}; }
        const labelOf = key => {
          // The totals row may name the whole (data-series-label on its
          // `data-series=""` row: Repository Size's `All folders`); a page
          // that does not says `All projects`, as before.
          if (key === '') {
            const t = rowOf('');
            return (t && t.dataset.seriesLabel) || seriesLabels[''] || 'All projects';
          }
          const r = rowOf(key);
          // data-series-label: the row's name where the table's own cell is
          // ambiguous out of its section (two `Scripts` rows, say).
          return r ? (r.dataset.seriesLabel || r.cells[0].textContent.trim())
            : seriesLabels[key] || key;
        };
        // A part's three-letter code, where its row shows one (Workshop
        // Stats' `atl`, the .part-key span) — the readout's key, with the
        // name beneath it (user decision 2026-11-05). '' elsewhere.
        // The totals line, on such a page, is `total`, with no name beneath
        // (the widget's own word for it; user decision 2026-11-05).
        const coded = rows.some(r => r.querySelector('.part-key'));
        if (coded) {
          keyFloorHtml = [...rows.map(r => {
            const k = r.querySelector('.part-key');
            return k ? k.textContent.trim() : '';
          }).filter(Boolean), 'total'].map(c =>
            `<span class="ch-swatch"></span><span class="ch-code">${c}</span>`);
          pinColumns();
        }
        const codeOf = key => {
          if (key === '') return coded ? 'total' : '';
          const k = rowOf(key) && rowOf(key).querySelector('.part-key');
          return k ? k.textContent.trim() : '';
        };
        // The live point's slot (loadPoints): the totals and each series at
        // index rawPoints.length, from the live answer's same-named fields.
        liveHook = () => {
          const L = rawPoints.length;
          const v = live ? live.values : {};
          all.total[L] = live ? live.total : null;
          all.words[L] = null;
          for (const key of Object.keys(expanded)) {
            expanded[key].total[L] = typeof v[key] === 'number' ? v[key] : null;
            expanded[key].words[L] = null;
          }
        };
        function show(key) {
          const s = expanded[key];
          shown = s ? key : '';
          const t = pick(s ? s.total : all.total);
          const w = pick(s ? s.words : all.words);
          points.forEach((p, i) => { p.total = t[i]; p.words = w[i]; });
          scoped = !!s;
          // The single line wears its series' fixed colour; the totals the
          // stylesheet's accent.
          if (linesPath) linesPath.style.stroke = s ? colourOf(key) : '';
          chDotLines.style.fill = s ? colourOf(key) : '';
          measure();
          // A project with no prose has no words curve. Its checkbox goes
          // inert rather than unchecked, so the choice it held is still the
          // reader's when the totals come back.
          if (showWords && wordsPath) showWords.disabled = !hasWords();
          redraw(currentMode());
          applyVisibility();
          pinColumns();
          refreshCrosshair();
        }
        function clearOverlay() {
          overlayPaths.forEach(el => el.remove());
          overlayDots.forEach(el => el.remove());
          overlayKeys = []; overlayPaths = []; overlayDots = []; overlayInfo = [];
        }
        function showOverlay(keys) {
          clearOverlay();
          shown = '';
          // `total` follows the first line (the ledger reads it); words are
          // off — several projects' prose on one right axis would say
          // nothing.
          const first = pick(valuesOf(keys[0]));
          points.forEach((p, i) => { p.total = first[i]; p.words = null; });
          // Each part's share of the Total at every point, for its name
          // line in the readout (user decision 2026-11-05): only where the
          // page offers that part a Share, and not while Share is drawn —
          // the count is the share then.
          const grand = pick(all.total);
          keys.forEach((key, n) => {
            const k = 'o' + n;
            const vals = pick(valuesOf(key));
            points.forEach((p, i) => { p[k] = vals[i]; });
            const share = !shareOn() && shareSet.has(key) ? 's' + n : '';
            if (share) points.forEach((p, i) => {
              p[share] = vals[i] == null || !grand[i] ? null
                : 100 * vals[i] / grand[i];
            });
            overlayKeys.push(k);
            overlayInfo.push({ key, label: labelOf(key), code: codeOf(key),
                               share, color: colourOf(key) });
            const path = linesPath.cloneNode(false);
            path.removeAttribute('d');
            path.classList.add('overlay-series');
            path.style.stroke = colourOf(key);
            linesPath.after(path);
            overlayPaths.push(path);
            const dot = mkDot('ch-dot-overlay');
            dot.style.fill = colourOf(key);
            overlayDots.push(dot);
          });
          scoped = true;
          measure();
          if (showWords && wordsPath) showWords.disabled = true;
          redraw(currentMode());
          applyVisibility();
          pinColumns();
          refreshCrosshair();
        }
        // THE CHOICE SURVIVES A RELOAD (user request 2026-10-28): kept per
        // page and per chart in this tab's sessionStorage, so F5 — or the
        // live render replacing the baked page — redraws the same lines.
        // Charts that take turns in one place (data-chart-alts, below) keep
        // ONE choice between them, so a switch or a reload keeps the lines.
        const choiceKey = svg.closest('[data-chart-alts]')
          ? `chart-choice:${location.pathname}:alts`
          : `chart-choice:${location.pathname}:${chartIdx}`;
        const saveChoice = () => {
          try { sessionStorage.setItem(choiceKey, JSON.stringify(chosen)); }
          catch (e) { /* storage off: the choice just doesn't persist */ }
        };
        const savedChoice = () => {
          try {
            const v = JSON.parse(sessionStorage.getItem(choiceKey));
            return Array.isArray(v) ? v : null;
          } catch (e) { return null; }
        };
        function setChosen(keys) {
          chosen = keys.filter(k => k === '' || (expanded[k] && listed(k)));
          saveChoice();
          // Nothing ticked IS an empty chart (user decision 2026-10-24; until
          // then the totals came back, so unticking the last line looked like
          // a reset). The page still opens on the totals.
          const drawn = drawnKeys();
          emptyChart = !drawn.length;
          if (emptyChart) {
            clearOverlay();
            shown = '';
            points.forEach(p => { p.total = null; p.words = null; });
            scoped = true;
            measure();
            redraw(currentMode());
            applyVisibility();
            pinColumns();
            refreshCrosshair();
          } else if (drawn.length > 1 || shareOn()) {
            // Share is always the overlay, even for one part: its line
            // wears the part's colour and its readout the part's name.
            showOverlay(drawn);
          } else {
            clearOverlay();
            show(drawn[0]);
          }
          syncChoice();
        }
        function syncChoice() {
          const drawn = drawnKeys();
          summary.textContent = !drawn.length ? 'No lines ▾'
            : drawn.length === 1 ? labelOf(drawn[0]) + ' ▾'
            : `${drawn.length} lines ▾`;
          picker.classList.toggle('scoped', !(drawn.length === 1 && drawn[0] === ''));
          panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
            const key = cb.dataset.key;
            const n = drawn.indexOf(key);
            cb.checked = n >= 0;
            // Under Share only the shared parts can be ticked.
            cb.disabled = shareOn() && !shareSet.has(key);
            const sw = cb.parentElement.querySelector('.chart-multi__swatch');
            if (sw) sw.style.background = n >= 0 ? colourOf(key) : 'transparent';
          });
          rows.forEach(r => {
            const n = drawn.indexOf(r.dataset.series);
            // Every drawn line's row lights, the Total's alone too (user
            // decision 2026-11-08; dark while alone from 2026-10-18).
            const on = n >= 0;
            r.classList.toggle('series-selected', on);
            if (on) {
              r.setAttribute('aria-current', 'true');
              r.style.setProperty('--series-colour', colourOf(r.dataset.series));
            } else {
              r.removeAttribute('aria-current');
              r.style.removeProperty('--series-colour');
            }
          });
        }
        // Toggles against what is DRAWN: under Share the default chart shows
        // every part, so a click on one part takes it away rather than
        // narrowing the chart to it. A row with no share does nothing there.
        const toggle = key => {
          if (shareOn() && !shareSet.has(key)) return;
          const base = drawnKeys();
          const n = base.indexOf(key);
          setChosen(n >= 0 ? base.filter(k => k !== key) : [...base, key]);
        };

        // A row behind an off Settings switch (data-unlist — the site's
        // "Unlisted projects" fold) is not named in the table, so it is not
        // named in the picker either; and if the switch goes off under a
        // project being shown, it leaves the chart. Refilled on the events
        // the fold itself re-reads the switches on — its listeners are
        // registered ahead of this module's, so <html> is already re-stamped
        // by the time these run.
        const listed = key => {
          const r = rowOf(key);
          return !r || !r.dataset.unlist
            || document.documentElement.hasAttribute('data-show-' + r.dataset.unlist);
        };
        // All / None (user request 2026-10-24), above the list. All ticks
        // every project — not the totals, which would flatten them against
        // the whole; tick that row too to draw it. Where the chart names the
        // parts that make up its Total (data-chart-share), All is those, in
        // Counts as in Share: Workshop Stats' Raw Code, outside the Total,
        // stays unticked (user decision 2026-11-08). None empties the
        // chart, ready for the lines you tick next.
        const bulk = (label, keys) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chart-multi__bulk-btn';
          b.textContent = label;
          b.addEventListener('click', () => setChosen(keys()));
          return b;
        };
        function fillPicker() {
          panel.textContent = '';
          const bulkRow = document.createElement('div');
          bulkRow.className = 'chart-multi__bulk';
          bulkRow.append(
            bulk('All', () => shareSet.size ? sharedParts()
              : Object.keys(series).filter(listed)),
            bulk('None', () => []));
          panel.appendChild(bulkRow);
          const option = (key, label) => {
            const l = document.createElement('label');
            l.className = 'chart-multi__option';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.key = key;
            cb.addEventListener('change', () => toggle(key));
            const sw = document.createElement('span');
            sw.className = 'chart-multi__swatch';
            l.append(cb, sw, document.createTextNode(label));
            panel.appendChild(l);
          };
          option('', labelOf(''));
          Object.keys(series).filter(listed).forEach(key => option(key, labelOf(key)));
          if (chosen.some(k => !listed(k))) setChosen(chosen); else syncChoice();
        }
        fillPicker();
        window.addEventListener('storage', fillPicker);
        window.addEventListener('pageshow', e => { if (e.persisted) fillPicker(); });
        // A click anywhere else folds the list away.
        document.addEventListener('click', e => {
          if (picker.open && !picker.contains(e.target)) picker.open = false;
        });
        navRowEl().appendChild(picker);

        const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
        rows.forEach(r => {
          const key = r.dataset.series;
          r.classList.add('series-row');
          r.tabIndex = 0;
          // A row TOGGLES its line in the choice — click two rows and both
          // are drawn; click one again and it leaves. The Total row is the
          // totals' line, toggled the same way.
          const choose = () => {
            const adding = !drawnKeys().includes(key);
            toggle(key);
            if (!adding) return;
            // The chart sits below the table and may be folded: open it and
            // bring it into view, or the click appears to have done nothing.
            const fold = svg.closest('details');
            if (fold) fold.open = true;
            (fold || wrap).scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' });
          };
          r.addEventListener('click', e => {
            if (e.target.closest('a, button, input, label, select')) return;
            // The end of a drag across the row's text is a selection, not a click.
            if (String(window.getSelection())) return;
            choose();
          });
          r.addEventListener('keydown', e => {
            if (e.target !== r || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            choose();
          });
        });
        // A resolution change rebuilds `points` on the totals; re-apply the
        // choice so the view, not the selection, is what changed.
        reapply = () => setChosen(chosen);
        const saved = savedChoice();
        if (saved) setChosen(saved);
        svg.chartApi.getChoice = () => chosen.slice();
        svg.chartApi.setChoice = keys => setChosen(keys);
      }

      // Counts ⇄ Share: the same choice, redrawn in the other measure — the
      // axis, the readout, its 24h row and the ledger all follow reapply().
      // A browser restoring the radios on Back may open on Share, so the
      // first state is applied here too.
      if (shareKeys.length) {
        ctlGroup('chart-measure').forEach(radio => {
          radio.addEventListener('change', () => { syncScaleRadios(); reapply(); });
        });
        syncScaleRadios();
        if (shareOn()) reapply();
      }

      // ── Year navigation: ‹ 2026 › ─────────────────────────────────────
      // Steps `years`; each arrow greys out at the first/last year with data.
      if (yr) {
        // The server's whole-history date labels would mislabel a year.
        svg.querySelectorAll('.x-date-fallback').forEach(el => el.remove());
        const nav = document.createElement('div');
        nav.className = 'year-nav';
        nav.setAttribute('role', 'group');
        nav.setAttribute('aria-label', 'Year shown');
        const step = (txt, label) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'year-step';
          b.textContent = txt;
          b.setAttribute('aria-label', label);
          return b;
        };
        const prevBtn = step('‹', 'Previous year');
        const nextBtn = step('›', 'Next year');
        const label = document.createElement('span');
        label.className = 'year-label';
        label.setAttribute('aria-live', 'polite');
        nav.append(prevBtn, label, nextBtn);
        navRowEl().prepend(nav);

        function applyYear() {
          yr = years[yearIdx];
          const lastDay = isoOf(yr.endMs - DAY_MS);
          label.innerHTML = `<span class="year-name">${yr.name}</span>`
            + `<span class="year-span">${isoOf(yr.startMs)} – `
            + `${lastDay}</span>`;
          prevBtn.disabled = yearIdx <= 0;
          nextBtn.disabled = yearIdx >= years.length - 1;
          setDomain();
          activeIdx = -1;
          reapply();
          refreshAxis();
          syncSpanNav();
        }
        // Zoomed, the arrows stand aside (they step years) and the label
        // says the window; back on Year, the year again.
        const yearLabel = () => label.innerHTML;
        let savedLabel = '';
        syncSpanNav = () => {
          const z = zoomOn();
          prevBtn.disabled = z || yearIdx <= 0;
          nextBtn.disabled = z || yearIdx >= years.length - 1;
          if (z) {
            if (!savedLabel) savedLabel = yearLabel();
            label.innerHTML = '<span class="year-name">Zoom</span>'
              + `<span class="year-span">${isoOf(domainMinMs)} – `
              + `${isoOf(domainMaxMs - DAY_MS)}</span>`;
          } else if (savedLabel) {
            label.innerHTML = savedLabel;
            savedLabel = '';
          }
        };
        const stepYear = d => {
          const i = yearIdx + d;
          if (i >= 0 && i < years.length) { yearIdx = i; applyYear(); }
        };
        prevBtn.addEventListener('click', () => stepYear(-1));
        nextBtn.addEventListener('click', () => stepYear(1));
        applyYear();
        // The year on screen, by name, for the alternates switch: two
        // charts may not start in the same year, so the index won't do.
        svg.chartApi.getYear = () => yr && yr.name;
        svg.chartApi.setYear = name => {
          const i = years.findIndex(y => y.name === name);
          if (i >= 0 && i !== yearIdx) { yearIdx = i; applyYear(); }
        };
      }

      // ── Year | Zoom ─────────────────────────────────────────────────────
      function applySpan() {
        setDomain();
        activeIdx = -1;
        reapply();
        refreshAxis();
        syncSpanNav();
      }
      ctlGroup('chart-span').forEach(radio => {
        radio.addEventListener('change', applySpan);
      });

      // ── Snapshots / Days ────────────────────────────────────────────────
      // Rebuild the view, then everything that was measured against it: the
      // paths and axes, the readout (its index space changed, so the hover
      // state is dropped), the ledger and the unit axis. Only where the
      // control bar offers the radio — a server-collapsed page has nothing to
      // switch (see collapseDaily above).
      ctlGroup('chart-res').forEach(radio => {
        radio.addEventListener('change', () => {
          loadPoints();
          activeIdx = -1;
          reapply();
          refreshAxis();
        });
      });
      // day_cut landed: the days and the changes can be placed now.
      if (dayCutLoad) dayCutLoad.then(m => {
        dayCut = m;
        loadPoints();
        activeIdx = -1;
        pinColumns();
        reapply();
        refreshAxis();
      }).catch(() => { /* no day_cut: the changes stay dashes */ });

      // Re-pin once webfonts land: widths first measured against the fallback
      // face would sit a few pixels off the text that finally renders.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { pinColumns(); refreshCrosshair(); });
      }
      // Same again when a collapsed chart section opens: inside a closed
      // <details> the probe has no layout, so every width above measured 0.
      const fold = svg.closest('details');
      if (fold) fold.addEventListener('toggle', () => {
        if (fold.open) { placeReadout(); pinColumns(); refreshCrosshair(); }
      });
      // The same re-measure for a chart shown by the alternates switch.
      svg.chartApi.relayout = () => {
        placeReadout(); pinColumns(); refreshCrosshair();
      };
    }
  });

  // ── Alternate charts: one place, a toggle between them ────────────────
  // A [data-chart-alts] block holds chart sections ([data-chart-alt=
  // "<label>"]) that take turns (user decision 2026-10-28: Workshop
  // Stats' Lines and Tracked size, "one graph with a toggle"). Each bar
  // gains the same toggle, first; a switch hides the old section, carries
  // its choice of lines and its control settings to the new one, and
  // re-measures it. Which one is shown survives a reload, and an address
  // naming a section (#size) opens on it.
  document.querySelectorAll('[data-chart-alts]').forEach((group, g) => {
    const alts = Array.from(group.querySelectorAll('[data-chart-alt]'));
    if (alts.length < 2) return;
    const svgOf = sec => sec.querySelector('.line-history-svg');
    const barOf = sec => sec.querySelector('.chart-controls');
    const store = `chart-alt:${location.pathname}:${g}`;
    // A control's id without its bar's suffix: the same control in the
    // other bar is that base plus the other suffix.
    const base = (el, bar) => {
      const k = bar.dataset.key ? '-' + bar.dataset.key : '';
      return k && el.id.endsWith(k) ? el.id.slice(0, -k.length) : el.id;
    };
    const twin = (el, from, to) => {
      const id = base(el, from) + (to.dataset.key ? '-' + to.dataset.key : '');
      return to.querySelector(`#${CSS.escape(id)}`);
    };
    let shown = -1;
    function show(i, carry) {
      if (i === shown) return;
      const old = shown >= 0 ? alts[shown] : null;
      alts.forEach((sec, n) => { sec.hidden = n !== i; });
      shown = i;
      try { sessionStorage.setItem(store, String(i)); } catch (e) { /* */ }
      group.querySelectorAll('.chart-alt-toggle input').forEach(r => {
        r.checked = Number(r.dataset.alt) === i;
      });
      const sec = alts[i];
      const svg = svgOf(sec);
      const api = svg && svg.chartApi;
      if (carry && old && barOf(old) && barOf(sec)) {
        const from = barOf(old), to = barOf(sec);
        from.querySelectorAll('input').forEach(el => {
          if (el.closest('.chart-alt-toggle')) return;
          const t = twin(el, from, to);
          if (!t || t.checked === el.checked) return;
          if (t.type === 'radio' && !el.checked) return;
          t.checked = el.checked;
          t.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const oldApi = svgOf(old) && svgOf(old).chartApi;
        const keys = oldApi && oldApi.getChoice && oldApi.getChoice();
        if (keys && api && api.setChoice) api.setChoice(keys);
        const year = oldApi && oldApi.getYear && oldApi.getYear();
        if (year && api && api.setYear) api.setYear(year);
      }
      if (api && api.relayout) api.relayout();
    }
    alts.forEach((sec, s) => {
      const bar = barOf(sec);
      if (!bar) return;
      const box = document.createElement('div');
      box.className = 'view-toggle chart-alt-toggle';
      box.setAttribute('role', 'radiogroup');
      box.setAttribute('aria-label', 'Which chart');
      alts.forEach((alt, i) => {
        const r = document.createElement('input');
        r.type = 'radio';
        r.id = `chart-alt-${g}-${s}-${i}`;
        r.name = `chart-alt-${g}-${s}`;
        r.dataset.alt = String(i);
        r.addEventListener('change', () => { if (r.checked) show(i, true); });
        const l = document.createElement('label');
        l.htmlFor = r.id;
        l.textContent = alt.dataset.chartAlt;
        box.append(r, l);
      });
      bar.prepend(box);
    });
    const named = alts.findIndex(
      sec => sec.id && '#' + sec.id === location.hash);
    let saved = -1;
    try { saved = Number(sessionStorage.getItem(store) ?? -1); }
    catch (e) { /* storage off: open on the first */ }
    show(named >= 0 ? named : (saved >= 0 && saved < alts.length ? saved : 0),
         false);
  });
});
