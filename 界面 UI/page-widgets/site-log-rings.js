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
// via dynamic import by relative path, exactly like stats-table.js.
//
// The wheel was BARE until 2026-09-05 (labelsMode "none", user call
// 2026-08-19); two calendar layers were added that day, both replicated from
// the app rather than invented here:
//   • the four SEASON GLYPHS — not a label tier but the app's own fixed,
//     non-rotating calendar ring, on the shared ring-log/seasons SSOT;
//   • the MONTHS label tier — the app's `months` mode at its DENSE setting,
//     drawn through the shared engine's placeLabelMarks with innerSide
//     false. Outer side only is not a compromise for the site: RingsScene
//     passes `innerSide={isSparse}`, so the dense spiral — which is exactly
//     what this widget replicates — already drops the inner side "so the
//     spiral's core stays clean". The engine's own outerClear rule then
//     limits outer marks to the OUTERMOST revolution, so it is twelve labels
//     around the current year, not twelve per ring.
// Progressive enhancement throughout: with JS off, or if an engine fails to
// load, the server-rendered muted note simply stays.
(function () {
  const mount = document.querySelector('.site-log-rings[data-ringlog-events]');
  if (!mount) return;
  const parse = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };
  const items = parse(mount.dataset.ringlogEvents);
  if (!items.length) return;
  const phases = parse(mount.dataset.ringlogPhases);
  const todayIso = mount.dataset.ringlogToday;
  const size = +mount.dataset.ringlogSize || 320;

  // Month NAMES are the one label piece not taken from an engine, and
  // deliberately: event-marks states its own division of labour — "this
  // module returns NUMBERS only … each consumer owns … its own i18n
  // (mapping monthIndex → a month name)". The app's copy is
  // theme/display.ts ENGLISH_MONTHS; keep the two spellings identical.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  Promise.all([
    import('../../引擎 Engines/ring-log/rings.js'),
    import('../../引擎 Engines/ring-log/phase-color.js'),
    import('../../引擎 Engines/ring-log/seasons.js'),
    import('../../引擎 Engines/event-marks/marks.js'),
    import('../../引擎 Engines/ring-log/future-registers.js'),
  ]).then(([rings, phasePalette, seasons, eventMarks, registers]) => {
    // THE FUTURE GROUND, resolved to a real hex. The registers blend colours,
    // and mixHex parses hex — handing it the literal string "var(--future-grey)"
    // yields "#NaNNaNNaN" silently — so the variable is read off the document
    // and resolved here, once. getPropertyValue returns the AUTHORED value, and
    // light-dark() is not resolved by it, so the pair is picked apart by the
    // effective colour scheme; a stylesheet that never loaded falls back to the
    // dark value, matching base.css's own dark-by-default posture.
    const futureGrey = (() => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--future-grey').trim();
      const m = raw.match(/light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/);
      if (!m) return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : '#4a4a4a';
      const explicit = document.documentElement.getAttribute('data-theme');
      const dark = explicit
        ? explicit === 'dark'
        : !window.matchMedia('(prefers-color-scheme: light)').matches;
      return dark ? m[2] : m[1];
    })();
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
    // Append a node filled in the theme's muted ink — the site's analog of
    // the app's `t.labelMuted`, which is what the label tier and its boundary
    // ticks are drawn in. Via style, not a fill attribute: a CSS var() does
    // not resolve in a bare presentation attribute (the same reason the
    // shading's base segment and its fade gradient set fill/stop-color in
    // style below).
    const svgAppendMuted = (parent, node) => {
      node.setAttribute('style', 'fill:var(--muted)');
      parent.appendChild(node);
      return node;
    };
    const svg = el('svg', {
      viewBox: `0 0 ${size} ${size}`,
      class: 'site-log-rings-svg',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'Site log — one growth ring per year, one tick per milestone, '
        + 'read clockwise from the December solstice at the top',
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
    // CURRENT phase runs solid to build-time today and then DISSOLVES FORWARD
    // over FADE_YEARS (0.25y) in PHASE_FADE_STEPS staircase sub-segments,
    // after which the PROJECTION GROUND carries that same grey on to the rim.
    // Base grey uses var(--muted) (theme-aware, the site's analog of the app's
    // t.labelMuted) — set via style: CSS var() doesn't resolve in a bare
    // fill attribute.
    //
    // THE DISSOLVE IS A COLOUR RAMP, NOT AN ALPHA RAMP (2026-09-05). This
    // widget ramped OPACITY to nothing until then — which is the shape
    // ring-log/future-registers exists to forbid, and which had quietly
    // stopped matching the app when it moved to a hue dissolve on 2026-09-02,
    // while the comment above still claimed the recipe was replicated
    // EXACTLY. It looked fine here only by luck: with just the grey base
    // underneath, alpha-to-zero happens to land on a colour close to where a
    // dissolve should end. Both registers now come from the shared engine,
    // so the two surfaces cannot drift again.
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
      // ③ DISSOLVE — the band's colour carried step by step to the future
      // grey, every step at the SAME band opacity (the register is the hue).
      for (let k = 0; k < PHASE_FADE_STEPS; k++) {
        pushSeg(bodyEnd + (k / PHASE_FADE_STEPS) * FADE_YEARS,
                bodyEnd + ((k + 1) / PHASE_FADE_STEPS) * FADE_YEARS,
                registers.dissolveToFuture(color, futureGrey, (k + 0.5) / PHASE_FADE_STEPS),
                PROJECTS_OPACITY);
      }
      // ② PROJECTION GROUND — the same grey, on to the end of the window.
      // ③ ends where ② begins, so the handover is continuous by construction
      // rather than by two values agreeing.
      pushSeg(bodyEnd + FADE_YEARS, win.winHiFrac,
              registers.projectionGround(futureGrey), PROJECTS_OPACITY);
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

    // ── Season glyphs: the fixed calendar ring ──────────────────────────
    // The four seasons on a FIXED (non-rotating) ring outside the spiral
    // rim — REPLICATED from the app's RingsScene.tsx season block, on the
    // shared ring-log/seasons SSOT (fractions, glyphs and radius all from
    // there), so the site's log and the app's Rings view seat them
    // identically. Two things make this exact:
    //   • the angle is `midpoint · 2π` with NO PHASE_ABS. The spiral's own
    //     phase rotates the BAND so the rim lands at RIM_ORIENT; the
    //     calendar does not rotate with it. polarPt already puts θ=0 at 12
    //     o'clock going clockwise, and the spiral is calendar-fixed with
    //     the reference December solstice there, so a bare `mid·2π` is the
    //     glyph's screen angle.
    //   • the radius is SEASON_EMOJI_RATIO (0.55) of the canvas edge, well
    //     outside the rim (0.43·size) — and it still fits the square
    //     UNPADDED because the four midpoints land 37.5° off the axes, i.e.
    //     near the corners: max offset is 0.55·cos(37.5°) ≈ 0.436 of the
    //     edge against the 0.5 half-width. Do not "centre" them onto the
    //     axes; that is what would push them off-canvas.
    // They are the ONLY thing drawn outside the band, and the band cannot
    // reach them, so paint order against the ticks below is moot. Plain
    // <text>, matching the app (its Fluent 3D assets are app-only and the
    // site has no such store) — and aria-hidden, because the SVG's own
    // label above already says which way the year runs and the hover
    // readout gives every real date exactly.
    const seasonG = el('g', { 'aria-hidden': 'true' });
    seasons.SEASON_MIDPOINTS.forEach((mid, i) => {
      const pos = proj.polarPt(size * seasons.SEASON_EMOJI_RATIO, mid * 2 * Math.PI);
      const t = el('text', {
        x: pos.x.toFixed(2),
        y: pos.y.toFixed(2),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        // The app's FONT.emoji (28) against its REF_CHART canvas (304) —
        // kept as that ratio so the glyphs track this widget's own size.
        'font-size': String((28 / 304) * size),
      });
      t.textContent = seasons.SEASON_EMOJIS[i];
      seasonG.appendChild(t);
    });
    svg.appendChild(seasonG);

    // ── The months label tier ───────────────────────────────────────────
    // REPLICATED from the app's RingsLabelMarks.tsx, on the two shared
    // engines: event-marks supplies the month boundaries (NUMBERS only — see
    // MONTHS above for why the names don't come from there) and ring-log's
    // placeLabelMarks does the placement, including the midpoint-clear rule
    // that decides which side of a coil a mark may use. Both were already
    // reachable, so nothing had to move into an engine for this.
    //
    // Three details are the app's and matter:
    //   • innerSide FALSE — the dense setting (RingsScene `innerSide={isSparse}`).
    //   • The gates are handed the FADE ENDS rather than the solid caps
    //     (the engine's inSolid check reads tSolidS1/tInnerS1), so marks are
    //     placed THROUGH the fade region instead of being dropped at the
    //     solid edge; fadeAt below then gives each one the band's own ramp,
    //     which is what stops them popping at that edge. The clearance
    //     params keep their true values.
    //   • The range is padded by both fade tails + 2 days so a month whose
    //     midpoint sits inside a fade still gets its mark.
    const RING_TICK_LENGTH_RATIO = 0.02;   // clockGeometry, month/week ticks
    // PRIMARY_LABEL_OUTWARD_RATIO.zh. RingsLabelMarks uses the zh gap for
    // EVERY language (the Rings view has no language control and renders the
    // English names), so matching the app means matching that — the two
    // ratios differ by 0.005 of the edge, ~1.6px here.
    const PRIMARY_LABEL_OUTWARD_RATIO_ZH = 0.035;
    const RING_TICK_YEAR_RATIO = 0.04;     // clockGeometry, the year seam
    const YEAR_LABEL_OUTWARD_RATIO = 0.05; // eventManifoldSpec
    const tickLen = RING_TICK_LENGTH_RATIO * size;
    const yearTickLen = RING_TICK_YEAR_RATIO * size;
    const yearLabelGap = YEAR_LABEL_OUTWARD_RATIO * size;
    const yearFont = (12 / 304) * size;    // FONT.chartMajor against REF_CHART
    const labelGap = PRIMARY_LABEL_OUTWARD_RATIO_ZH * size;
    const labelFont = (9 / 304) * size;    // FONT.chart against REF_CHART
    const PAD_FRAC = (rings.FADE_DAYS + 2) / rings.DAYS_PER_YEAR;
    const monthMarks = eventMarks
      .getMonthMarksInRange(
        rings.fracToMs(win.winLoFrac - PAD_FRAC, originMs),
        rings.fracToMs(win.winHiFrac + PAD_FRAC, originMs))
      .map(m => ({
        fraction: rings.msToFrac(m.startMs, originMs),
        midFraction: rings.msToFrac(m.midMs, originMs),
        endFraction: rings.msToFrac(m.endMs, originMs),
        text: MONTHS[m.monthIndex],
        // The months tier's year conventions, from the SAME place the app
        // reads them (event-marks): the year seam takes a longer tick, and
        // the number appears at the Jan/Feb, Jun/Jul and Nov/Dec boundaries.
        isYearBoundary: m.isNewYear,
        yearText: eventMarks.yearLabelForMonth(m),
      }));
    // The band's own edge ramp, read at a mark's t (RingsLabelMarks fadeAtT).
    const fadeAt = (tt) => {
      if (tt >= win.tInnerS1 && tt <= win.tSolidS1) return 1;
      if (tt > win.tSolidS1 && tt < tOuterEndS1) return (tOuterEndS1 - tt) / (tOuterEndS1 - win.tSolidS1);
      if (tt > tInnerEndS1 && tt < win.tInnerS1) return (tt - tInnerEndS1) / (win.tInnerS1 - tInnerEndS1);
      return 0;
    };
    const monthG = el('g', { 'aria-hidden': 'true' });
    const labelPlaced = rings.placeLabelMarks(monthMarks, {
      fracToT: proj.fracToT, polarPt: proj.polarPt,
      b: frame.b, PHASE_DIFF: frame.PHASE_DIFF, PHASE_ABS: frame.PHASE_ABS,
      tSolidS1: tOuterEndS1, tInnerS1: tInnerEndS1,   // widened gates, see above
      tOuterEndS1, tInnerEndS1,
      dayFrac: DAY_FRAC, tickLen, labelGap, innerSide: false,
      yearTickLen, yearLabelGap,
      // boundaryTickDayWidth omitted — the engine's default 0.5 IS the app's
      // clockGeometry BOUNDARY_TICK_DAY_WIDTH.
    });
    // Boundary ticks come back keyed by index, not position; rebuild
    // index → opening frac the way the engine built its boundary list.
    for (const tick of labelPlaced.boundaryTicks) {
      const m = monthMarks[tick.index];
      const f = m ? fadeAt(proj.fracToT(m.fraction)) : 1;
      if (!tick.outer || f <= 0) continue;
      svgAppendMuted(monthG, el('path', {
        d: tick.outer, stroke: 'none',
        'fill-opacity': String(0.5 * f),   // the app's tick weight
      }));
    }
    for (const lbl of labelPlaced.labels) {
      const m = monthMarks[lbl.index];
      const f = m ? fadeAt(proj.fracToT(m.midFraction)) : 1;
      if (!lbl.outer || f <= 0) continue;
      const node = el('text', {
        x: lbl.outer.x.toFixed(2), y: lbl.outer.y.toFixed(2),
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': String(labelFont),
        'fill-opacity': String(f),
      });
      node.textContent = lbl.text;
      svgAppendMuted(monthG, node);
    }
    // YEAR NUMBERS — anchored on the boundary, so they take the TICK's fade
    // rather than the month label's: a number naming a seam comes and goes
    // with it. Drawn at the app's chartMajor size, a step up from the month
    // names, which is what makes the year read as the coarser tier.
    for (const yl of labelPlaced.yearLabels) {
      const m = monthMarks[yl.index];
      const f = m ? fadeAt(proj.fracToT(m.fraction)) : 1;
      if (!yl.outer || f <= 0) continue;
      const node = el('text', {
        x: yl.outer.x.toFixed(2), y: yl.outer.y.toFixed(2),
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': String(yearFont),
        'fill-opacity': String(f),
      });
      node.textContent = yl.text;
      svgAppendMuted(monthG, node);
    }
    svg.appendChild(monthG);

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
