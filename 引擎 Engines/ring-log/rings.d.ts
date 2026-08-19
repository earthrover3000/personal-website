// Type declarations for the framework-agnostic ring-log engine (rings.js).
// The lifespan-atlas TS app imports this via the `ring-log` path alias
// (vite.config.ts resolve.alias + tsconfig paths); it is the single source of
// truth for the Rings view's spiral frame / projection / placement math,
// shared with the (future) site roadmap's site-log rings.

export declare const DAYS_PER_YEAR: number;
export declare const MS_PER_YEAR: number;
/** 120-day rim lead as a year-fraction (the reference date sits at 12
 *  o'clock; the rim lands 120 days later, at RIM_ORIENT). */
export declare const RIM_LEAD_FRAC: number;
/** Screen angle of the rim: RIM_LEAD_FRAC · 2π ≈ 118° (≈ 4 o'clock). */
export declare const RIM_ORIENT: number;

export declare function msToFrac(ms: number, originMs: number): number;
export declare function fracToMs(frac: number, originMs: number): number;

/** Fixed ring-frame scalars derived from the canvas + gap configuration. */
export type RingFrame = {
  cx: number;
  cy: number;
  /** Spiral pitch coefficient (radius = b·t). */
  b: number;
  /** Angular offset between the strip's two strands (fixes the width). */
  PHASE_DIFF: number;
  /** Whole-spiral angular shift placing the rim parameter at RIM_ORIENT. */
  PHASE_ABS: number;
  /** Rim spiral parameter (= R_CANVAS / b). */
  t_ref: number;
  /** Outermost strand's rim radius. */
  R_CANVAS: number;
  /** Strip thickness (= b·PHASE_DIFF = the configured bandWidth). */
  ringWidth: number;
};

export declare function makeRingFrame(cfg: {
  /** Square canvas edge (the atlas's W; H = W). */
  size: number;
  /** Strip thickness in px. */
  bandWidth: number;
  /** Rim inset from the canvas edge. */
  markerMargin: number;
  /** Gap between revolutions as a multiple of the band. */
  gapMultiplier: number;
  /** Whole revolutions added to the base rim radius. */
  rimExtraRevs: number;
}): RingFrame;

export type SpiralProjectionConfig = {
  cx: number;
  cy: number;
  b: number;
  PHASE_DIFF: number;
  PHASE_ABS: number;
  t_ref: number;
  /** Year-fraction at the rim (t = t_ref). */
  refFrac: number;
  /** Origin timestamp of the frac coordinate (frac 0 = this ms). */
  originMs: number;
};

/** The closure bundle over a fixed spiral config. Matches the atlas's
 *  tier-1 ManifoldProjection surface (project / ringWidth / dayPx) plus the
 *  spiral-specific extras. */
export type SpiralProjection = {
  /** Polar → cartesian; 12 o'clock = θ=0, increasing θ clockwise. */
  polarPt: (r: number, theta: number) => { x: number; y: number };
  /** polarPt as an "x.xx,y.yy" path fragment (toFixed(2)). */
  polar: (r: number, theta: number) => string;
  /** Year-fraction → spiral parameter t. */
  fracToT: (frac: number) => number;
  /** ISO date (YYYY-MM-DD) → t; null when unparseable. */
  dateToT: (iso: string) => number | null;
  /** Strip thickness (= b·PHASE_DIFF). */
  ringWidth: number;
  /** Strip point: frac along life, y outward from the inner edge. */
  project: (frac: number, y: number) => { x: number; y: number };
  /** Pixels per day at the rim's scale. */
  dayPx: number;
  /** Ring-arc band path (both strands) over [tStart, tEnd]. */
  buildSegmentPath: (tStart: number, tEnd: number) => string;
  /** 12 o'clock cap fade-wedge path. */
  buildFadeWedge: (
    t1Start: number, t1End: number,
    t2Start: number, t2End: number,
    capRadiusS1: number,
    capScreenAngle: number,
  ) => string;
};

export declare function makeSpiralProjection(cfg: SpiralProjectionConfig): SpiralProjection;

export declare function visibleRingWindow(input: {
  tSolidS1: number;
  refFrac: number;
  N: number;
}): {
  tInnerS1: number;
  winLoFrac: number;
  winHiFrac: number;
};

/** Sparse solid-window length in days (the Waterwheel's sliding circle). */
export declare const SPARSE_WINDOW_DAYS: number;
/** Drifting-mode slide clamp: revolutions inward the window may reach. */
export declare const SPARSE_SLIDE_REVS: number;
/** 6-day fade past each solid cap; the atlas's windowPolicy re-exports it. */
export declare const FADE_DAYS: number;

export declare function sparseRingWindow(input: {
  t_ref: number;
  refFrac: number;
  /** The (possibly animated) anchor's year-fraction. */
  anchorFrac: number;
  /** Days of future the window reaches past the anchor. */
  futureOffsetDays: number;
}): {
  tSolidS1: number;
  tInnerS1: number;
  winLoFrac: number;
  winHiFrac: number;
  anchorClampLo: number;
  anchorClampHi: number;
};

/** Tier-agnostic label mark (blocks / months / weeks all normalise here). */
export type RingLabelMarkInput = {
  fraction: number;
  midFraction: number;
  endFraction: number;
  text: string;
  blockIndex?: number;
};

export type PlacedLabelMarks = {
  boundaryTicks: { index: number; outer: string | null; inner: string | null }[];
  labels: {
    index: number;
    text: string;
    outer: { x: number; y: number } | null;
    inner: { x: number; y: number } | null;
  }[];
};

export declare function placeLabelMarks(
  marks: readonly RingLabelMarkInput[],
  cfg: {
    fracToT: (frac: number) => number;
    polarPt: (r: number, theta: number) => { x: number; y: number };
    b: number;
    PHASE_DIFF: number;
    PHASE_ABS: number;
    tSolidS1: number;
    tInnerS1: number;
    /** Fade-tail end parameters (solid caps ± FADE_DAYS). */
    tOuterEndS1: number;
    tInnerEndS1: number;
    /** One day as a year-fraction (1 / DAYS_PER_YEAR). */
    dayFrac: number;
    tickLen: number;
    labelGap: number;
    innerSide: boolean;
    /** Tick width as a fraction of one day (default 0.5). */
    boundaryTickDayWidth?: number;
    /** Also tick the last mark's END boundary (blocks). */
    closeFinalBoundary?: boolean;
    /** Per-boundary veto, keyed by the boundary's blockIndex. */
    skipBoundary?: (blockIndex: number) => boolean;
  },
): PlacedLabelMarks;

/** Dated input item — label/kind pass through untouched. */
export type RingLogItem = { iso: string; label: string; kind?: string };

/** Positioned spec for one item (see rings.js placeEvents docs). */
export type PlacedRingEvent = {
  x: number;
  y: number;
  /** Whole revolutions inward from the rim reference (0 = outermost). */
  ring: number;
  /** Screen angle in degrees, 0 = 12 o'clock, clockwise, [0, 360). */
  angleDeg: number;
  frac: number;
  t: number;
  iso: string;
  label: string;
  kind?: string;
};

export declare function placeEvents(
  items: readonly RingLogItem[],
  cfg: SpiralProjectionConfig & {
    /** Inclusive frac window; items outside are dropped. */
    fracLo?: number;
    fracHi?: number;
    /** Radial offset from the strip's inner edge (default ringWidth/2). */
    yOffset?: number;
  },
): PlacedRingEvent[];
