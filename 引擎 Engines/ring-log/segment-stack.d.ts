// Type declarations for the shared segment-stack module (segment-stack.js) —
// what a stack of translucent band segments looks like at one position. SSOT
// for the lifespan-atlas Rings view (lib/ringSegments re-exports it as
// bandPaintAt) and the site's site-log-rings page-widget.

/** One segment of the band, in paint order. `color` must be a real hex. */
export type StackSegment = {
  lo: number;
  hi: number;
  color: string;
  opacity: number;
};

/** The single translucent paint equivalent to every segment covering `pos`.
 *  Ground-independent — segments composite against each other, never against
 *  a page background. `opacity: 0` means nothing covers `pos`. */
export declare function flattenStackAt(
  segments: readonly StackSegment[],
  pos: number,
): { color: string; opacity: number };
