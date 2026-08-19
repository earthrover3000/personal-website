// Site Log rings — the roadmap page's Life Log view: the dense growth-ring
// SPIRAL from the lifespan-atlas Log page's 🌀 Rings subview (its dense
// window frozen at build-time today), one revolution per year with enough
// revolutions to reach the site's earliest dated milestone (user call
// 2026-08-19: dense/Life Log mode, not the sparse Waterwheel — the log
// covers the whole number of years that covers every website event). The
// band's span is shaded by the site's version PHASES; one tick per dated
// milestone. Pairs with the mount div rendered by
// site_roadmap/roadmap_page.py::_render_site_log() (data-ringlog-events /
// -phases / -today / -size) and draws on the shared ring-log engine
// (引擎 Engines/ring-log/) — the SAME dense-window geometry AND the same
// deterministic phase colours as the lifespan-atlas app (the app's
// denseWindow policy delegates to the very same engine function) — loaded
// via dynamic import by relative path, exactly like stats-table.js. The
// app's label tiers (engine placeLabelMarks) are deliberately NOT drawn
// here — labelsMode "none", a bare wheel (user call 2026-08-19). Progressive
// enhancement throughout: with JS off, or if an engine fails to load, the
// server-rendered muted note simply stays.
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
    // 0.07·size, gap = one band width; sparse rimExtraRevs 0.
    const frame = rings.makeRingFrame({
      size,
      bandWidth: 0.02 * size,
      markerMargin: 0.07 * size,
      gapMultiplier: 1,
      rimExtraRevs: 0,
    });

    // Calendar-fixed rim orientation (the engine's drifting convention, the
    // dense policy's rimYearOffset 0): the reference December solstice sits
    // at 12 o'clock and the rim lands RIM_LEAD_FRAC (120 days) later.
    // originMs is an arbitrary December solstice — whole fracs are its
    // anniversaries — and refFrac is the NEXT solstice after the build-time
    // today (+ half a day so the day's middle, not its start, sits on the
    // axis — the atlas's HALF_DAY_FRAC), which puts the current year on the
    // outermost ring.
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
    const proj = rings.makeSpiralProjection(cfg);

    // The dense window, pinned to the rim (the app's denseWindow policy:
    // tSolidS1 = t_ref) and reaching N whole revolutions inward — N sized so
    // the spiral covers every dated milestone: an event's ring is its whole
    // years inward from the rim (floor(refFrac − frac)), so the deepest
    // ring + 1 is the whole number of years that covers all events. At
    // least the current year's ring — a young site shows few rings; that IS
    // the concept. SSOT window math (engine visibleRingWindow), shared with
    // the app's policy. Anything beyond the rim (ring < 0, a far-future
    // date) can't sit on the log yet and is dropped below.
    const allPlaced = rings.placeEvents(
      items.map(it => ({ iso: it[0], label: it[1], kind: it[2] ? 'defining' : 'minor' })),
      cfg,
    ).filter(ev => ev.ring >= 0);
    const N = Math.max(1, ...allPlaced.map(ev => ev.ring + 1));
    const win = Object.assign(
      { tSolidS1: frame.t_ref },
      rings.visibleRingWindow({ tSolidS1: frame.t_ref, refFrac, N }),
    );
    // Fade tails past each cap, the scene's FADE_DT.
    const FADE_DT = (rings.FADE_DAYS / rings.DAYS_PER_YEAR) * 2 * Math.PI;
    const tOuterEndS1 = win.tSolidS1 + FADE_DT;
    const tInnerEndS1 = win.tInnerS1 - FADE_DT;

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

    // ── Layers 1+2: the band's shading segments ─────────────────────────
    // The app's website-shading recipe EXACTLY (ringSegments.ts projects
    // branch + projectPhases.phaseBandSegments), so the two wheels read the
    // same colours: a muted grey base at LOCATION_GAP_OPACITY (0.2) across
    // the whole window (regions no version covers — before the first phase,
    // and the far future — read as "no info" grey), then each version
    // phase's [start → next start) span in the SHARED deterministic phase
    // colour (ring-log/phase-color.js — the exact function the app's
    // Projects shading uses) at shadingFillOpacity("projects") (0.5). The
    // CURRENT phase runs solid to build-time today and then FADES FORWARD
    // over FADE_YEARS (0.25y) in PHASE_FADE_STEPS staircase sub-segments
    // (fadeOpacityMul) — the app's forward fade into the future. Base grey
    // uses var(--muted) (theme-aware, the site's analog of the app's
    // t.labelMuted) — set via style: CSS var() doesn't resolve in a bare
    // fill attribute.
    const PROJECTS_OPACITY = 0.5;   // eventManifoldSpec SHADING_FILL_OPACITY.projects
    const BASE_OPACITY = 0.2;       // eventManifoldSpec LOCATION_GAP_OPACITY
    const PHASE_FADE_STEPS = 20;    // projectPhases.PHASE_FADE_STEPS
    const FADE_YEARS = 0.25;        // projectPhases.FADE_YEARS
    // Segments in paint order (base first); fLo/fHi in frac space, clipped
    // to the window. `varColor` fills via style so var(--muted) resolves.
    const segments = [{
      fLo: win.winLoFrac, fHi: win.winHiFrac,
      color: 'var(--muted)', opacity: BASE_OPACITY, varColor: true,
    }];
    const reached = phases
      .map(p => ({ frac: rings.msToFrac(Date.parse(p[0] + 'T00:00:00Z'), originMs), major: p[1], minor: p[2] }))
      .filter(p => Number.isFinite(p.frac) && p.frac <= todayFrac)
      .sort((a, b) => a.frac - b.frac);
    const pushSeg = (fLo, fHi, color, opacity) => {
      const lo = Math.max(fLo, win.winLoFrac);
      const hi = Math.min(fHi, win.winHiFrac);
      if (hi > lo) segments.push({ fLo: lo, fHi: hi, color, opacity });
    };
    reached.forEach((p, i) => {
      const color = phasePalette.phaseColor(p.major, p.minor);
      if (i + 1 < reached.length) {
        pushSeg(p.frac, reached[i + 1].frac, color, PROJECTS_OPACITY);
        return;
      }
      // Current phase: solid through today, then the forward staircase fade.
      const bodyEnd = Math.max(p.frac, todayFrac);
      pushSeg(p.frac, bodyEnd, color, PROJECTS_OPACITY);
      for (let k = 0; k < PHASE_FADE_STEPS; k++) {
        pushSeg(bodyEnd + (k / PHASE_FADE_STEPS) * FADE_YEARS,
                bodyEnd + ((k + 1) / PHASE_FADE_STEPS) * FADE_YEARS,
                color, PROJECTS_OPACITY * (1 - (k + 0.5) / PHASE_FADE_STEPS));
      }
    });
    for (const s of segments) {
      const attrs = {
        d: proj.buildSegmentPath(proj.fracToT(s.fLo), proj.fracToT(s.fHi)),
        'fill-opacity': String(s.opacity),
        stroke: 'none',
      };
      if (s.varColor) attrs.style = `fill:${s.color}`;
      else attrs.fill = s.color;
      svg.appendChild(el('path', attrs));
    }

    // ── Layer 3: cap fades ──────────────────────────────────────────────
    // The band fades in/out over FADE_DAYS past each cap, exactly the
    // app's treatment: a fade wedge filled with a userSpaceOnUse linear
    // gradient from the cap's mid-band point — in the colour of the TOPMOST
    // segment containing the cap (the app's findEdgeSeg rule) — to the
    // tail's mid-band end at opacity 0. Drawn AFTER the shading so the
    // tail continues visually from the segment that abuts the cap.
    const capFill = (frac) => {
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (s.fLo <= frac + 1e-9 && s.fHi >= frac - 1e-9) {
          return { color: s.color, opacity: String(s.opacity), varColor: !!s.varColor };
        }
      }
      return { color: 'var(--muted)', opacity: String(BASE_OPACITY), varColor: true };
    };
    const defsEl = el('defs', {});
    svg.appendChild(defsEl);
    const fadeWedge = (name, tCapS1, tEndS1, capFrac) => {
      const tCapS2 = tCapS1 - frame.PHASE_DIFF;
      const tEndS2 = tEndS1 - frame.PHASE_DIFF;
      const start = proj.polarPt(
        (frame.b * tCapS1 + frame.b * tCapS2) / 2, tCapS1 + frame.PHASE_ABS);
      const end = proj.polarPt(
        (frame.b * tEndS1 + frame.b * tEndS2) / 2, tEndS1 + frame.PHASE_ABS);
      const fill = capFill(capFrac);
      const grad = el('linearGradient', {
        id: `slr-fade-${name}`, gradientUnits: 'userSpaceOnUse',
        x1: start.x.toFixed(2), y1: start.y.toFixed(2),
        x2: end.x.toFixed(2), y2: end.y.toFixed(2),
      });
      const stop = (offset, opacity) => {
        const s = el('stop', { offset, 'stop-opacity': opacity });
        // var(--muted) resolves only as CSS, not as a bare stop-color attribute.
        if (fill.varColor) s.setAttribute('style', `stop-color:${fill.color}`);
        else s.setAttribute('stop-color', fill.color);
        return s;
      };
      grad.appendChild(stop('0%', fill.opacity));
      grad.appendChild(stop('100%', '0'));
      defsEl.appendChild(grad);
      svg.appendChild(el('path', {
        d: proj.buildFadeWedge(tCapS1, tEndS1, tCapS2, tEndS2,
                               frame.b * tCapS1, tCapS1 + frame.PHASE_ABS),
        fill: `url(#slr-fade-${name})`,
        stroke: 'none',
      }));
    };
    fadeWedge('outer', win.tSolidS1, tOuterEndS1, win.winHiFrac);
    fadeWedge('inner', win.tInnerS1, tInnerEndS1, win.winLoFrac);

    // Every dated event, already placed above (the dense window is sized to
    // cover them all, so no further filtering is needed).
    const placed = allPlaced;

    // ── Layer 4 (top): event ticks — the Atlas event-mark shape ─────────
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
    // the visible shape. Colour + opacity follow the app's canonical mark
    // spec (eventManifoldSpec defaultEventMarkSpecs): BOTH tiers draw in
    // the text colour at spec opacity 1.0, dimmed at rest by
    // EVENT_MARK_REST_OPACITY (0.4) with the hovered mark restored to full
    // — a defining (version-launch) milestone differs by SHAPE alone (the
    // full-band triangle vs the minors' half-band one), exactly as the
    // app's majors do.
    const REST_OPACITY = 0.4;   // eventManifoldSpec EVENT_MARK_REST_OPACITY
    const rw = proj.ringWidth;
    for (const ev of placed) {
      const defining = ev.kind === 'defining';
      const g = el('g', {
        role: 'img',
        'aria-label': `${ev.label} — ${ev.iso}`,
      });
      const mark = el('path', {
        d: singleDayMarkPath(ev.frac, rw / 2, defining ? rw : rw / 2),
        fill: 'currentColor',
        'fill-opacity': String(REST_OPACITY),
        stroke: 'none',
      });
      g.appendChild(mark);
      const mid = proj.project(ev.frac + HALF_DAY_FRAC, rw / 2);
      g.appendChild(el('circle', {
        cx: mid.x.toFixed(2),
        cy: mid.y.toFixed(2),
        r: '7',
        fill: 'transparent',
        'pointer-events': 'all',
      }));
      g.addEventListener('mouseover', () => {
        mark.setAttribute('fill-opacity', '1');
        showReadout(ev, defining);
      });
      g.addEventListener('mouseout', () => {
        mark.setAttribute('fill-opacity', String(REST_OPACITY));
        clearReadout();
      });
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
