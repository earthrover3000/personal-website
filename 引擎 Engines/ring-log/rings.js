// ring-log — SSOT ring geometry shared by the lifespan-atlas Growth Rings
// view and (future) the site roadmap's site-log rings. ONE framework-free,
// browser-runnable ES module: the atlas consumes it via the `ring-log` vite
// alias / tsconfig path (lib/manifold/spiralGeometry.ts delegates here) and
// the site's client JS will dynamic-import it by relative path, exactly like
// 引擎 Engines/event-marks. Consumers RENDER; this engine only COMPUTES —
// no React, no DOM, no colours. (Label LAYOUT — tick wedges + label anchor
// points — is compute and lives here, see placeLabelMarks; label CONTENT
// comes from event-marks / the atlas's block context, and theming, fonts and
// interaction stay consumer-side.)
//
// The model is the Rings view's Archimedean spiral: two strands one
// PHASE_DIFF apart bound a strip of constant width; 1 revolution = 1 year.
// Positions along the strip are absolute year-FRACTIONS
//   frac = (ms − originMs) / MS_PER_YEAR
// (the atlas's lib/marks dateToFrac — origin = a December solstice; the site
// picks its own origin ms). The spiral is calendar-fixed: the reference date
// `refFrac` + RIM_LEAD_FRAC (120 days) maps to the rim radius at screen
// angle RIM_ORIENT, which puts the reference itself at 12 o'clock. Every
// date then sits at spiral parameter
//   t(frac) = t_ref + (frac − refFrac)·2π ,  radius b·t, screen angle
//   t + PHASE_ABS (θ=0 at 12 o'clock, clockwise).
//
// All formulas are ported VERBATIM from the atlas's RingsScene.tsx (frame
// block) and lib/manifold/spiralGeometry.ts (projection closures) — the
// Rings view must stay pixel-identical, so do NOT "improve" any constant,
// formula, rounding, or step count here.

/** Tropical-year length in days. Mirrors lib/time.DAYS_PER_YEAR — anchors
 *  every per-day / per-year ratio (dayPx, RIM_LEAD_FRAC). */
export const DAYS_PER_YEAR = 365.24219;
/** Milliseconds per mean tropical year. Mirrors lib/time.MS_PER_YEAR. */
export const MS_PER_YEAR = 1000 * 60 * 60 * 24 * DAYS_PER_YEAR;

// The spiral is calendar-fixed: a December solstice + 120 days maps to the
// rim. RIM_LEAD_FRAC is that 120-day lead as a year-fraction; the reference
// solstice (and every ±1yr from it) sits at 12 o'clock while the rim lands
// at RIM_ORIENT ≈ 118° (≈ 4 o'clock). refFrac (the frac at the rim) leads
// the reference by RIM_LEAD_FRAC and PHASE_ABS places the rim parameter at
// RIM_ORIENT; the two cancel for the calendar mapping, so the reference —
// and any calendar-fixed adornments — stay put at 12 o'clock.
export const RIM_LEAD_FRAC = 120 / DAYS_PER_YEAR;
export const RIM_ORIENT = RIM_LEAD_FRAC * 2 * Math.PI;

// Path sampling densities — fixed, part of the byte-identical path contract.
const STEPS_PER_REV = 200;
const FADE_STEPS = 60;

/** Absolute year-fraction of a ms timestamp for a given origin. Same
 *  arithmetic as the atlas's lib/marks dateToFrac. */
export const msToFrac = (ms, originMs) => (ms - originMs) / MS_PER_YEAR;
/** Inverse of msToFrac (the atlas's fracToTime). */
export const fracToMs = (frac, originMs) => originMs + frac * MS_PER_YEAR;

// ─── Ring frame (ported verbatim from RingsScene's derived-geometry block) ──
//
// PHASE_DIFF and b are determined by the gap setting; both fix the strip
// width at exactly bandWidth. R_CANVAS is the outermost strand's rim radius:
// the base rim (size/2 − markerMargin) plus rimExtraRevs whole pitches
// (one pitch = b·2π). t_ref = R_CANVAS/b is the rim's spiral parameter, and
// PHASE_ABS rotates the whole spiral so the rim parameter lands at
// RIM_ORIENT — combined with refFrac's RIM_LEAD_FRAC lead this keeps the
// reference date at 12 o'clock.

/**
 * Build the fixed ring frame from plain numbers.
 * @param {{ size: number, bandWidth: number, markerMargin: number,
 *           gapMultiplier: number, rimExtraRevs: number }} cfg
 *   size          — square canvas edge (the atlas's W; H = W).
 *   bandWidth     — strip thickness in px (the atlas's 0.02·W band).
 *   markerMargin  — rim inset from the canvas edge (the atlas's 0.07·W).
 *   gapMultiplier — gap between revolutions as a multiple of the band
 *                   (1 = gap equals band; the atlas locks this to 1).
 *   rimExtraRevs  — whole revolutions added to the base rim radius.
 * @returns {{ cx: number, cy: number, b: number, PHASE_DIFF: number,
 *            PHASE_ABS: number, t_ref: number, R_CANVAS: number,
 *            ringWidth: number }}
 */
export function makeRingFrame({ size, bandWidth, markerMargin, gapMultiplier, rimExtraRevs }) {
  const PHASE_DIFF = (2 * Math.PI) / (1 + gapMultiplier);
  const b = bandWidth / PHASE_DIFF;
  const R_CANVAS = (size / 2 - markerMargin) + rimExtraRevs * (b * 2 * Math.PI);
  const t_ref = R_CANVAS / b;
  // Rim parameter sits at RIM_ORIENT; combined with the refFrac lead this
  // keeps the reference solstice/anchor at 12 o'clock.
  let PHASE_ABS = (RIM_ORIENT - t_ref) % (2 * Math.PI);
  if (PHASE_ABS < 0) PHASE_ABS += 2 * Math.PI;
  return {
    cx: size / 2, cy: size / 2,
    b, PHASE_DIFF, PHASE_ABS, t_ref, R_CANVAS,
    ringWidth: b * PHASE_DIFF,
  };
}

// ─── Spiral projection (ported verbatim from lib/manifold/spiralGeometry) ──

/**
 * Build the family of pure geometry closures over a fixed spiral config
 * (centre, pitch b, phase offsets, reference parameter/frac, frac origin):
 *   • polarPt / polar — polar→cartesian (12 o'clock = θ=0, clockwise);
 *     polar returns the "x.xx,y.yy" path fragment (toFixed(2) — part of the
 *     byte-identical path contract).
 *   • fracToT / dateToT — year-fraction / ISO date → spiral parameter t
 *   • project — the strip (frac, y) → screen point (y=0 inner edge, +y out)
 *   • buildSegmentPath / buildFadeWedge — ring-arc band + fade-wedge SVG paths
 *   • ringWidth (= b·PHASE_DIFF) and dayPx are the derived band metrics.
 * @param {{ cx: number, cy: number, b: number, PHASE_DIFF: number,
 *           PHASE_ABS: number, t_ref: number, refFrac: number,
 *           originMs: number }} cfg
 */
export function makeSpiralProjection(cfg) {
  const { cx, cy, b, PHASE_DIFF, PHASE_ABS, t_ref, refFrac, originMs } = cfg;

  // Polar — 12 o'clock = θ=0, increasing θ rotates clockwise.
  const polarPt = (r, theta) => {
    const phi = theta - Math.PI / 2;
    return { x: cx + r * Math.cos(phi), y: cy + r * Math.sin(phi) };
  };
  const polar = (r, theta) => {
    const p = polarPt(r, theta);
    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  };

  // Reference's parameter is fixed at R_CANVAS/b; every other date sits at
  // `t_ref + (frac − refFrac)·2π`. PHASE_ABS shifts the entire spiral
  // angularly; the mapping itself is invariant under it.
  const fracToT = (frac) => t_ref + (frac - refFrac) * 2 * Math.PI;
  const dateToT = (iso) => {
    const dms = new Date(iso + "T00:00:00Z").getTime();
    if (Number.isNaN(dms)) return null;
    return fracToT(msToFrac(dms, originMs));
  };

  // The manifold is one strip: time = frac, radial offset = y (y=0 inner edge,
  // y>0 outward). frac → t via fracToT, then radius b·(t−PHASE_DIFF)+y at angle
  // t+PHASE_ABS. ringWidth = b·PHASE_DIFF is constant across the spiral.
  const ringWidth = b * PHASE_DIFF;
  const project = (frac, y) => {
    const tt = fracToT(frac);
    return polarPt(b * (tt - PHASE_DIFF) + y, tt + PHASE_ABS);
  };
  const dayPx = (2 * Math.PI * (b * t_ref)) / DAYS_PER_YEAR;

  const buildSegmentPath = (tStart, tEnd) => {
    const span = tEnd - tStart;
    const steps = Math.max(8, Math.ceil((span / (2 * Math.PI)) * STEPS_PER_REV));
    let d = `M ${polar(b * tStart, tStart + PHASE_ABS)}`;
    for (let i = 1; i <= steps; i++) {
      const tParam = tStart + (i / steps) * span;
      d += ` L ${polar(b * tParam, tParam + PHASE_ABS)}`;
    }
    d += ` L ${polar(b * (tEnd - PHASE_DIFF), tEnd + PHASE_ABS)}`;
    for (let i = steps; i >= 0; i--) {
      const tParam = tStart + (i / steps) * span;
      d += ` L ${polar(b * (tParam - PHASE_DIFF), tParam + PHASE_ABS)}`;
    }
    return d + " Z";
  };

  const buildFadeWedge = (
    t1Start, t1End,
    t2Start, t2End,
    capRadiusS1,
    capScreenAngle,
  ) => {
    let d = `M ${polar(capRadiusS1, capScreenAngle)}`;
    for (let i = 1; i <= FADE_STEPS; i++) {
      const tParam = t1Start + (i / FADE_STEPS) * (t1End - t1Start);
      d += ` L ${polar(b * tParam, tParam + PHASE_ABS)}`;
    }
    d += ` L ${polar(b * t2End, t2End + PHASE_ABS + PHASE_DIFF)}`;
    for (let i = FADE_STEPS; i >= 0; i--) {
      const tParam = t2Start + (i / FADE_STEPS) * (t2End - t2Start);
      d += ` L ${polar(b * tParam, tParam + PHASE_ABS + PHASE_DIFF)}`;
    }
    return d + " Z";
  };

  return {
    polarPt, polar, fracToT, dateToT, ringWidth, project, dayPx,
    buildSegmentPath, buildFadeWedge,
  };
}

// ─── Visible ring window (ported verbatim from rings/dense/denseWindow) ──

/**
 * Which stretch of the spiral is visible for an N-revolution window pinned
 * at the rim: N whole revolutions inward from the solid outer edge — window
 * [refFrac − N, refFrac] in frac space. Pure math only; the atlas's window
 * POLICIES (dense/sparse presets, anchor drag clamps, sliders) stay app-side.
 * @param {{ tSolidS1: number, refFrac: number, N: number }} input
 * @returns {{ tInnerS1: number, winLoFrac: number, winHiFrac: number }}
 */
export function visibleRingWindow({ tSolidS1, refFrac, N }) {
  return {
    tInnerS1: tSolidS1 - N * 2 * Math.PI,
    winLoFrac: refFrac - N,
    winHiFrac: refFrac,
  };
}

// ─── Sparse window (ported verbatim from rings/sparseWindow.ts) ──────────
//
// The Waterwheel / sparse-circle policy: a fixed-length SPARSE_WINDOW_DAYS
// solid band that slides along the calendar-fixed spiral with the anchor,
// its outer edge inside the rim. winEnd reaches futureOffsetDays into the
// future from the anchor; winStart is SPARSE_WINDOW_DAYS before. The rim
// reference sits one year further out (rimYearOffset 1 app-side) so the
// maximum future reach always fits. The atlas's sparseWindow.ts policy
// DELEGATES here — the app view and the site's Site Log widget must stay
// pixel-identical, so do NOT change any formula in one place only.

/** Sparse solid-window length in days. */
export const SPARSE_WINDOW_DAYS = 600;

/** Drifting-mode hard clamp: the window may never slide outside
 *  [refFrac − SPARSE_SLIDE_REVS, refFrac] — the rim and SPARSE_SLIDE_REVS
 *  revolutions inward. */
export const SPARSE_SLIDE_REVS = 4;

/** 6-day fade past each solid cap (year-days). The scene's FADE_DT and the
 *  label-range pad derive from this; the atlas's windowPolicy re-exports it. */
export const FADE_DAYS = 6;

/**
 * Solid-band edges + visible-window fracs + anchor drag clamps for the
 * sparse sliding window. Pure math; anchor animation/clamping policy stays
 * consumer-side.
 * @param {{ t_ref: number, refFrac: number, anchorFrac: number,
 *           futureOffsetDays: number }} input
 *   anchorFrac — the (possibly animated) anchor's year-fraction.
 * @returns {{ tSolidS1: number, tInnerS1: number, winLoFrac: number,
 *            winHiFrac: number, anchorClampLo: number, anchorClampHi: number }}
 */
export function sparseRingWindow({ t_ref, refFrac, anchorFrac, futureOffsetDays }) {
  const windowSpanFrac = SPARSE_WINDOW_DAYS / DAYS_PER_YEAR;
  const futureOffFrac = futureOffsetDays / DAYS_PER_YEAR;
  const winEnd = anchorFrac + futureOffFrac;
  const winStart = winEnd - windowSpanFrac;
  return {
    tSolidS1: t_ref + (winEnd - refFrac) * 2 * Math.PI,
    tInnerS1: t_ref + (winStart - refFrac) * 2 * Math.PI,
    winLoFrac: winStart,
    winHiFrac: winEnd,
    anchorClampLo: refFrac - SPARSE_SLIDE_REVS + windowSpanFrac - futureOffFrac,
    anchorClampHi: refFrac - futureOffFrac,
  };
}

// ─── Label marks (ported verbatim from rings/RingsLabelMarks.tsx) ────────
//
// Tick + label GEOMETRY for the tier-agnostic label marks (blocks / months /
// weeks all normalise to { fraction, midFraction, endFraction, text }).
// Content generation stays with the event-marks engine (month/week walks)
// and the atlas's block context; interaction (clicks, highlights) and
// theming stay consumer-side — this computes only wedge paths and label
// anchor points. A tick/label renders on a side only where that side is
// clear of the neighbouring spiral revolution (the midpoint clear rule).

/**
 * @param {{ fraction: number, midFraction: number, endFraction: number,
 *           text: string, blockIndex?: number,
 *           isYearBoundary?: boolean, yearText?: string|null }[]} marks
 * @param {{ fracToT: (frac: number) => number,
 *           polarPt: (r: number, theta: number) => {x: number, y: number},
 *           b: number, PHASE_DIFF: number, PHASE_ABS: number,
 *           tSolidS1: number, tInnerS1: number,
 *           tOuterEndS1: number, tInnerEndS1: number,
 *           dayFrac: number, tickLen: number, labelGap: number,
 *           innerSide: boolean,
 *           yearTickLen?: number, yearLabelGap?: number,
 *           boundaryTickDayWidth?: number,
 *           closeFinalBoundary?: boolean,
 *           skipBoundary?: (blockIndex: number) => boolean }} cfg
 *   tOuterEndS1 / tInnerEndS1 — fade-tail end parameters (solid caps ±
 *     FADE_DAYS), bounding the neighbour-clear test exactly as the scene's.
 *   boundaryTickDayWidth — tick width as a fraction of one day (the atlas's
 *     clockGeometry BOUNDARY_TICK_DAY_WIDTH; default 0.5).
 *   yearTickLen — tick length for marks flagged `isYearBoundary` (the months
 *     tier's longer year seam). Omit and every tick uses tickLen.
 *   yearLabelGap — radial gap for the YEAR NUMBER, anchored on the mark's
 *     opening boundary. Omit and no year labels are placed.
 *   closeFinalBoundary — also tick the last mark's END boundary (blocks).
 *   skipBoundary — optional per-boundary veto (the atlas's synthesised
 *     current↔next transition skip), keyed by the boundary's blockIndex.
 * @returns {{ boundaryTicks: { index: number, outer: string|null,
 *                              inner: string|null }[],
 *             labels: { index: number, text: string,
 *                       outer: {x: number, y: number}|null,
 *                       inner: {x: number, y: number}|null }[],
 *             yearLabels: { index: number, text: string,
 *                           outer: {x: number, y: number}|null,
 *                           inner: {x: number, y: number}|null }[] }}
 */
export function placeLabelMarks(marks, cfg) {
  const {
    fracToT, polarPt, b, PHASE_DIFF, PHASE_ABS,
    tSolidS1, tInnerS1, tOuterEndS1, tInnerEndS1,
    dayFrac, tickLen, labelGap, innerSide,
  } = cfg;
  const boundaryTickDayWidth =
    cfg.boundaryTickDayWidth !== undefined ? cfg.boundaryTickDayWidth : 0.5;
  const TWO_PI = 2 * Math.PI;
  const halfStart = (1 - boundaryTickDayWidth) / 2;
  const rO = (tt) => b * tt;
  const rI = (tt) => b * (tt - PHASE_DIFF);
  // Side is clear iff the neighbouring revolution's band (incl. fade tails,
  // which span outer-edge-param [tInnerEndS1, tOuterEndS1]) does not exist
  // at that angle within reach.
  const outerClear = (tt) => tt + TWO_PI > tOuterEndS1;
  const innerClear = (tt) => innerSide && tt - TWO_PI < tInnerEndS1;
  const inSolid = (tt) => tt >= tInnerS1 && tt <= tSolidS1;
  const wedgePath = (frac, edge, dir, len) => {
    const useLen = len !== undefined ? len : tickLen;
    const t1 = fracToT(frac + dayFrac * halfStart);
    const t2 = fracToT(frac + dayFrac * (halfStart + boundaryTickDayWidth));
    const e1 = edge(t1);
    const e2 = edge(t2);
    const p1 = polarPt(e1, t1 + PHASE_ABS);
    const p2 = polarPt(e1 + dir * useLen, t1 + PHASE_ABS);
    const p3 = polarPt(e2 + dir * useLen, t2 + PHASE_ABS);
    const p4 = polarPt(e2, t2 + PHASE_ABS);
    return `M ${p1.x.toFixed(2)},${p1.y.toFixed(2)} L ${p2.x.toFixed(2)},${p2.y.toFixed(2)} L ${p3.x.toFixed(2)},${p3.y.toFixed(2)} L ${p4.x.toFixed(2)},${p4.y.toFixed(2)} Z`;
  };

  // Boundary ticks — a half-day radial wedge at each period's opening
  // boundary; optionally the final mark's end boundary too (blocks).
  const boundaries = marks.map((m, i) => ({
    frac: m.fraction,
    blockIndex: m.blockIndex !== undefined ? m.blockIndex : i,
    // A mark may ask for a LONGER tick than the tier's — the months tier
    // does it at the year seam (see cfg.yearTickLen). Undefined = the tier's.
    tickLen: m.isYearBoundary && cfg.yearTickLen !== undefined ? cfg.yearTickLen : undefined,
  }));
  if (cfg.closeFinalBoundary && marks.length > 0) {
    const last = marks[marks.length - 1];
    boundaries.push({
      frac: last.endFraction,
      blockIndex: (last.blockIndex !== undefined ? last.blockIndex : 0) + 1,
    });
  }
  const boundaryTicks = [];
  for (const bnd of boundaries) {
    const tB = fracToT(bnd.frac);
    if (!inSolid(tB)) continue;
    if (cfg.skipBoundary && cfg.skipBoundary(bnd.blockIndex)) continue;
    const outer = outerClear(tB) ? wedgePath(bnd.frac, rO, 1, bnd.tickLen) : null;
    const inner = innerClear(tB) ? wedgePath(bnd.frac, rI, -1, bnd.tickLen) : null;
    if (outer || inner) boundaryTicks.push({ index: bnd.blockIndex, outer, inner });
  }

  // Labels at each mark's centre. Center must be in the solid window; the
  // side must be clear for the WHOLE period, so bind on the edge nearest
  // the conflict (outer→start, inner→end).
  const labels = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const tMid = fracToT(m.midFraction);
    if (!inSolid(tMid)) continue;
    const ang = tMid + PHASE_ABS;
    const outer = outerClear(fracToT(m.fraction))
      ? polarPt(rO(tMid) + labelGap, ang) : null;
    const inner = innerClear(fracToT(m.endFraction))
      ? polarPt(rI(tMid) - labelGap, ang) : null;
    if (outer || inner) labels.push({ index: i, text: m.text, outer, inner });
  }

  // YEAR LABELS — the months tier's second text class (2026-09-05). Anchored
  // on the mark's OPENING BOUNDARY, not its midpoint: the number names the
  // seam it sits on, and a boundary-anchored number reads as belonging to the
  // turn rather than to either month beside it. That is also why it is a
  // separate list instead of a second field on `labels` — different anchor,
  // different radius (cfg.yearLabelGap), different size at every consumer.
  // WHICH marks carry one is not decided here: the caller sets `yearText`
  // from event-marks' yearLabelForMonth, the SSOT for that convention.
  const yearLabels = [];
  if (cfg.yearLabelGap !== undefined) {
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (!m.yearText) continue;
      const tB = fracToT(m.fraction);
      if (!inSolid(tB)) continue;
      const ang = tB + PHASE_ABS;
      const outer = outerClear(tB) ? polarPt(rO(tB) + cfg.yearLabelGap, ang) : null;
      const inner = innerClear(tB) ? polarPt(rI(tB) - cfg.yearLabelGap, ang) : null;
      if (outer || inner) yearLabels.push({ index: i, text: m.yearText, outer, inner });
    }
  }
  return { boundaryTicks, labels, yearLabels };
}

// ─── Event placement (data in → positioned specs out) ────────────────────

/**
 * Place dated items on the rings. Items are `{ iso, label, kind? }`; label
 * and kind are PASSED THROUGH untouched — consumers bind their own tooltips
 * (the site via a native SVG <title>, the atlas its own way). Items with an
 * unparseable date, or falling outside the optional [fracLo, fracHi] window,
 * are dropped.
 *
 * Output per item:
 *   x, y      — screen point at radial offset `yOffset` from the strip's
 *               inner edge (default mid-band, ringWidth/2).
 *   ring      — whole revolutions inward from the rim reference
 *               (0 = outermost year ring; 1 rev = 1 year).
 *   angleDeg  — screen angle in degrees, 0 = 12 o'clock, clockwise, [0, 360).
 *   frac, t   — the item's year-fraction and spiral parameter, for composing
 *               with the lower-level primitives.
 *
 * @param {{ iso: string, label: string, kind?: string }[]} items
 * @param {{ cx: number, cy: number, b: number, PHASE_DIFF: number,
 *           PHASE_ABS: number, t_ref: number, refFrac: number,
 *           originMs: number, fracLo?: number, fracHi?: number,
 *           yOffset?: number }} cfg
 */
export function placeEvents(items, cfg) {
  const proj = makeSpiralProjection(cfg);
  const yOffset = cfg.yOffset !== undefined ? cfg.yOffset : proj.ringWidth / 2;
  const TWO_PI = 2 * Math.PI;
  const out = [];
  for (const item of items) {
    const dms = new Date(item.iso + "T00:00:00Z").getTime();
    if (Number.isNaN(dms)) continue;
    const frac = msToFrac(dms, cfg.originMs);
    if (cfg.fracLo !== undefined && frac < cfg.fracLo) continue;
    if (cfg.fracHi !== undefined && frac > cfg.fracHi) continue;
    const t = proj.fracToT(frac);
    const { x, y } = proj.project(frac, yOffset);
    let angleDeg = (((t + cfg.PHASE_ABS) * 180) / Math.PI) % 360;
    if (angleDeg < 0) angleDeg += 360;
    out.push({
      x, y,
      ring: Math.floor((cfg.t_ref - t) / TWO_PI),
      angleDeg,
      frac, t,
      iso: item.iso,
      label: item.label,
      kind: item.kind,
    });
  }
  return out;
}
