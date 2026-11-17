// Type declarations for the shared today / anchor marker shape (marker.js)
// — imported by the lifespan-atlas as `ring-log/marker` (lib/eventMarkShape
// re-exports it) and by the site-log-rings page-widget.

export type MarkerPoint = { x: number; y: number };
export type MarkerProject = (frac: number, y: number) => MarkerPoint;

export declare const HAT_OVERHANG_DAYS: number;
export declare function markerSubPath(pts: MarkerPoint[]): string;
export declare function markerEdge(
  project: MarkerProject, fa: number, ya: number, fb: number, yb: number,
  n: number, skipFirst: boolean): MarkerPoint[];
export type HatState = "now" | "day";
export declare const HAT_STATES: { readonly NOW: "now"; readonly DAY: "day" };
export declare function markerHatRearPts(
  project: MarkerProject, f0: number, dayFrac: number, ringWidth: number,
  samples: number, overhangDays: number, state?: HatState): MarkerPoint[];
export declare function markerHatPts(
  project: MarkerProject, f0: number, dayFrac: number, ringWidth: number,
  samples: number, overhangDays: number, state?: HatState): MarkerPoint[];
export declare function markerCellSubpaths(
  project: MarkerProject, f0: number, dayFrac: number, ringWidth: number,
  S: number): string;
export declare function eventMarkerPath(opts: {
  startFrac: number; dayFrac: number; ringWidth: number;
  project: MarkerProject; bumpSamples?: number; edgeSamples?: number;
  hatOverhangDays?: number; state?: HatState;
}): string;
