// Site Log rings — the roadmap page's tree-log view: one growth ring per
// year of the site's life, the ring spans shaded by the site's version
// PHASES, and one tick per dated milestone (a "log" both as a record and as
// the trunk where growth rings live). Pairs with the mount div rendered by
// site_roadmap/roadmap_page.py::_render_site_log() (data-ringlog-events /
// -phases / -today / -size) and draws on the shared ring-log engine
// (引擎 Engines/ring-log/) — the SAME spiral geometry AND the same
// deterministic phase colours as the lifespan-atlas app — loaded via dynamic
// import by relative path, exactly like stats-table.js loads the event-marks
// engine. Progressive enhancement throughout: with JS off, or if the engine
// fails to load, the server-rendered muted note simply stays.
(function () {
  const mount = document.querySelector('.site-log-rings[data-ringlog-events]');
  if (!mount) return;
  const parse = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };
  const items = parse(mount.dataset.ringlogEvents);
  if (!items.length) return;
  const phases = parse(mount.dataset.ringlogPhases);
  const todayIso = mount.dataset.ringlogToday;
  const size = +mount.dataset.ringlogSize || 320;

  Promise.all([
    import('../../引擎 Engines/ring-log/rings.js'),
    import('../../引擎 Engines/ring-log/phase-color.js'),
  ]).then(([rings, phasePalette]) => {
    // Frame: the atlas Rings view's proportions — band 0.02·size, rim inset
    // 0.07·size, gap = one band width, no extra revolutions.
    const frame = rings.makeRingFrame({
      size,
      bandWidth: 0.02 * size,
      markerMargin: 0.07 * size,
      gapMultiplier: 1,
      rimExtraRevs: 0,
    });

    // Calendar-fixed rim orientation (the engine's pinned convention): the
    // reference December solstice sits at 12 o'clock and the rim lands
    // RIM_LEAD_FRAC (120 days) later. originMs is an arbitrary December
    // solstice — whole fracs are its anniversaries — and refFrac is the NEXT
    // solstice after the build-time today (+ half a day so the day's middle,
    // not its start, sits on the axis — the atlas's HALF_DAY_FRAC), which
    // puts the current year on the outermost ring.
    const DAY_FRAC = 1 / rings.DAYS_PER_YEAR;
    const HALF_DAY_FRAC = 0.5 * DAY_FRAC;
    const originMs = Date.parse('2000-12-21T00:00:00Z');
    const todayFrac = rings.msToFrac(Date.parse(todayIso + 'T00:00:00Z'), originMs);
    const refFrac = Math.floor(todayFrac) + 1 + rings.RIM_LEAD_FRAC + HALF_DAY_FRAC;

    const cfg = {
      cx: frame.cx, cy: frame.cy, b: frame.b,
      PHASE_DIFF: frame.PHASE_DIFF, PHASE_ABS: frame.PHASE_ABS,
      t_ref: frame.t_ref, refFrac, originMs,
    };

    // Place every dated event ([iso, label, definingFlag] triples from the
    // server), then size the log: enough rings to reach the earliest
    // milestone, and at least the current year's ring — a young site shows
    // few rings; that IS the concept. Anything beyond the rim (ring < 0, a
    // far-future date) can't sit on the log yet and is dropped.
    const placed = rings.placeEvents(
      items.map(it => ({ iso: it[0], label: it[1], kind: it[2] ? 'defining' : 'minor' })),
      cfg,
    ).filter(ev => ev.ring >= 0);
    const numRings = Math.max(1, ...placed.map(ev => ev.ring + 1));

    const proj = rings.makeSpiralProjection(cfg);
    const SVGNS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
      // Everything in this SVG is created with createElementNS — an
      // HTML-namespaced element (document.createElement) inside an <svg>
      // silently fails to render, hit-test, or show its <title> tooltip.
      const node = document.createElementNS(SVGNS, tag);
      for (const k in attrs) node.setAttribute(k, attrs[k]);
      return node;
    };
    const svg = el('svg', {
      viewBox: `0 0 ${size} ${size}`,
      class: 'site-log-rings-svg',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'Site log — one growth ring per year, one tick per milestone',
      // Sized like the stats chart (fluid width + capped height, see
      // .line-history-svg); currentColor rides the page text colour and the
      // phase hexes read at band opacity in both themes.
      style: 'width:100%;height:auto;display:block;max-height:340px;margin-top:0.5rem;color:var(--text);',
    });

    // ── Layer 1 (bottom): website-phase shading ─────────────────────────
    // The website's analog of the Atlas rings' epoch shading: each version
    // phase's [start → next start) span painted along the spiral band with
    // the engine's buildSegmentPath, in the SHARED deterministic phase
    // colour (ring-log/phase-color.js — the exact function the app's
    // Projects shading uses, relocated there as the SSOT). Phases come as
    // [startIso, major, minor] triples; the LAST reached phase runs to
    // build-time today; a phase dated in the future isn't reached yet and
    // stays unpainted, as does the span before the first phase. Absolute
    // hexes at low opacity so both themes read; drawn FIRST so the ring
    // strokes and event ticks stay crisp on top.
    const winLo = refFrac - numRings;
    const reached = phases
      .map(p => ({ frac: rings.msToFrac(Date.parse(p[0] + 'T00:00:00Z'), originMs), major: p[1], minor: p[2] }))
      .filter(p => Number.isFinite(p.frac) && p.frac <= todayFrac)
      .sort((a, b) => a.frac - b.frac);
    reached.forEach((p, i) => {
      const lo = Math.max(p.frac, winLo);
      const hi = Math.min(i + 1 < reached.length ? reached[i + 1].frac : todayFrac, refFrac);
      if (hi <= lo) return;
      svg.appendChild(el('path', {
        d: proj.buildSegmentPath(proj.fracToT(lo), proj.fracToT(hi)),
        fill: phasePalette.phaseColor(p.major, p.minor),
        'fill-opacity': '0.22',
        stroke: 'none',
      }));
    });

    // ── Layer 2: the year rings ─────────────────────────────────────────
    // One full-year band per ring, current year at the rim — ring k's band
    // spans spiral parameters [t_ref − (k+1)·2π, t_ref − k·2π]. Muted
    // currentColor fill + hairline edges give the tree-ring read in both
    // themes; the faint fill doubles as a wash over the phase shading.
    const TWO_PI = 2 * Math.PI;
    for (let k = numRings - 1; k >= 0; k--) {
      svg.appendChild(el('path', {
        d: proj.buildSegmentPath(frame.t_ref - (k + 1) * TWO_PI, frame.t_ref - k * TWO_PI),
        fill: 'currentColor',
        'fill-opacity': '0.06',
        stroke: 'currentColor',
        'stroke-opacity': '0.3',
        'stroke-width': '1',
      }));
    }

    // ── Layer 3 (top): event ticks — the Atlas event-mark shape ─────────
    // The SAME mark the app's Rings view draws for a single-day event:
    // a concave "dart" arrowhead below the band's inner edge (its two sides
    // quarter ellipses carved inward) plus one straight-sided triangle
    // pointing outward into the band — full band height for a defining
    // (major) event, half for a minor. REPLICATED from the app's
    // src/lib/eventMarkShape.ts `eventMarkPath` (single-day n=1, inRing
    // "discrete"; triangleHeight = ringWidth/2, intrusionHeight = ringWidth
    // major / ringWidth/2 minor — the exact call EventMarkLayer.tsx's
    // `tickD` makes). The full eventMarkPath is entangled with the app's
    // multi-day u-arcs, invert/marker and hit-zone machinery, so relocating
    // it wholesale into the plain-JS engine was disproportionate; only the
    // single-day discrete case is mirrored here. If eventMarkPath's
    // single-day geometry ever changes, CHANGE THIS TOO (and vice versa).
    const singleDayMarkPath = (f0, h, intrusion) => {
      const pts = [];
      const push = (frac, y) => {
        const p = proj.project(frac, y);
        pts.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
      };
      const ARROW = 12;   // quarter-ellipse samples (eventMarkPath arrowSamples)
      const EDGE = 3;     // triangle edge samples (eventMarkPath edgeSamples)
      const INNER = 6;    // inner-edge closing samples (outerEdgeSamplesPerDay)
      // Tooth: inner-edge left corner → concave left side down to the apex
      // (0.5 day, −h) → concave right side back up to the right corner →
      // close along the inner edge (sampled so it follows the ring's arc).
      push(f0, 0);
      for (let i = 1; i <= ARROW; i++) {
        const phi = (Math.PI / 2) * (1 - i / ARROW);
        push(f0 + 0.5 * Math.cos(phi) * DAY_FRAC, -h + h * Math.sin(phi));
      }
      for (let i = 1; i <= ARROW; i++) {
        const phi = Math.PI - (Math.PI / 2) * (i / ARROW);
        push(f0 + (1 + 0.5 * Math.cos(phi)) * DAY_FRAC, -h + h * Math.sin(phi));
      }
      for (let i = 1; i < INNER; i++) push(f0 + (1 - i / INNER) * DAY_FRAC, 0);
      const tooth = 'M ' + pts.join(' L ') + ' Z';
      // In-ring triangle: base one day along the inner edge, apex at
      // (mid-day, +intrusion).
      const tri = [];
      const pushT = (frac, y) => {
        const p = proj.project(frac, y);
        tri.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
      };
      for (let i = 0; i <= EDGE; i++) pushT(f0 + (i / EDGE) * DAY_FRAC, 0);
      for (let i = 1; i <= EDGE; i++) {
        const t = i / EDGE;
        pushT(f0 + (1 - 0.5 * t) * DAY_FRAC, intrusion * t);
      }
      for (let i = 1; i <= EDGE; i++) {
        const t = i / EDGE;
        pushT(f0 + (0.5 - 0.5 * t) * DAY_FRAC, intrusion * (1 - t));
      }
      return tooth + ' M ' + tri.join(' L ') + ' Z';
    };

    // THE READOUT — the site's own hover-tooltip idiom (chart-hover-wrap /
    // chart-readout from stats.css, already loaded by the roadmap page):
    // a reserved line BELOW the chart in normal flow, visibility via content
    // swap, never floating over the rings. Mirrors stats-table.js's chart
    // readout so the two hover systems read as one. Native <title> tooltips
    // were replaced by this (both at once = a double tooltip); each tick
    // keeps an aria-label so the names stay reachable to assistive tech.
    const readout = document.createElement('div');
    readout.className = 'chart-readout';
    const showReadout = (ev, defining) => {
      readout.innerHTML =
        `<span class="ch-when">${ev.iso}</span>` +
        `<span class="ch-field${defining ? ' ch-f-lines' : ''}">` +
        `<span class="ch-key">${defining ? 'Defining' : 'Event'}</span>` +
        `<span class="ch-val" style="font-variant-numeric:normal">${ev.label}</span></span>`;
    };
    const clearReadout = () => { readout.innerHTML = ''; };

    // Each tick is a <g> with a TRANSPARENT hit circle (r 7 viewBox units,
    // centred mid-band on the event's day) — the visible mark alone is only
    // a few px wide, far too small a hover target; the circle mirrors how
    // the app gives its marks a generous continuous hit zone separate from
    // the visible shape. Defining (version-launch) milestones fill in the
    // accent colour with the full-band triangle; minors muted currentColor
    // with the half-band one.
    const rw = proj.ringWidth;
    for (const ev of placed) {
      const defining = ev.kind === 'defining';
      const g = el('g', {
        role: 'img',
        'aria-label': `${ev.label} — ${ev.iso}`,
      });
      g.appendChild(el('path', {
        d: singleDayMarkPath(ev.frac, rw / 2, defining ? rw : rw / 2),
        fill: defining ? 'var(--accent)' : 'currentColor',
        'fill-opacity': defining ? '0.95' : '0.55',
        stroke: 'none',
      }));
      const mid = proj.project(ev.frac + HALF_DAY_FRAC, rw / 2);
      g.appendChild(el('circle', {
        cx: mid.x.toFixed(2),
        cy: mid.y.toFixed(2),
        r: '7',
        fill: 'transparent',
        'pointer-events': 'all',
      }));
      g.addEventListener('mouseover', () => showReadout(ev, defining));
      g.addEventListener('mouseout', clearReadout);
      svg.appendChild(g);
    }

    // Rendered — the muted fallback note gives way to the drawing, wrapped
    // in the hover-wrap with the readout line beneath (stats-chart idiom;
    // .chart-readout's min-height reserves the line so hover never reflows).
    const wrap = document.createElement('div');
    wrap.className = 'chart-hover-wrap';
    wrap.appendChild(svg);
    wrap.appendChild(readout);
    mount.replaceChildren(wrap);
  }).catch(() => { /* engine unreachable — keep the server-rendered note */ });
})();
