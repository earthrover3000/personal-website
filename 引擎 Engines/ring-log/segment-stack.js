// ring-log/segment-stack — what a stack of translucent band segments actually
// looks like at one position. The SSOT shared by both surfaces that draw the
// spiral's shading: the lifespan-atlas Rings view (lib/ringSegments re-exports
// it as bandPaintAt) and the site's Site Log rings page-widget.
//
// WHY IT EXISTS (2026-09-06). Both surfaces fade the band out past each cap
// with a gradient, and both started that gradient from the TOPMOST SEGMENT
// covering the cap — the app's `findEdgeSeg`, the widget's `capFill`, the
// second copied from the first. But the band is not one segment there, it is a
// STACK: a muted grey base at 0.2 with a mode colour at 0.5 painted over it.
// Starting the fade from only the top layer drops the base's contribution the
// instant the cap is crossed, so the band JUMPED at the very seam the fade
// exists to smooth — measured on the dark theme, an inside composite of
// rgb(56,56,56) against rgb(44,44,44) one pixel outside.
//
// The fix is not a better guess at which segment matters; it is to stop
// picking one. Flattening the stack to a single translucent paint makes the
// gradient's first stop equal to what the band is at the cap BY CONSTRUCTION,
// in any theme and under any shading mode.

import { parseHex } from "./future-registers.js";

/**
 * The one translucent paint equivalent to every segment covering `pos`.
 *
 * Returns straight (un-premultiplied) colour plus the stack's combined alpha,
 * which is the form both an SVG gradient stop and a fill/fill-opacity pair
 * want. GROUND-INDEPENDENT on purpose: it composites the segments against
 * each other, never against a page background, so the same answer is correct
 * in light and dark. (The atlas's own flattenSegmentsAt does composite over a
 * background — that one answers "what colour is this pixel", for mosaic tiles.
 * This answers "what paint is the band made of", for a fade to transparent.)
 *
 * Segments are `{ lo, hi, color, opacity }` in PAINT ORDER, earliest first —
 * each consumer maps its own shape (the atlas's tStart/tEnd, the widget's
 * fLo/fHi). Bounds are inclusive; `color` must be a real hex.
 *
 * @param {{ lo: number, hi: number, color: string, opacity: number }[]} segments
 * @param {number} pos
 * @returns {{ color: string, opacity: number }} opacity 0 = nothing covers pos
 */
export function flattenStackAt(segments, pos) {
  // Premultiplied source-over accumulation: pc = c·a + pc·(1−a), pa = a + pa·(1−a).
  let pr = 0, pg = 0, pb = 0, pa = 0;
  for (const s of segments) {
    if (pos < s.lo - 1e-9 || pos > s.hi + 1e-9) continue;
    const a = Math.max(0, Math.min(1, s.opacity));
    if (a <= 0) continue;
    const [r, g, b] = parseHex(s.color);
    pr = r * a + pr * (1 - a);
    pg = g * a + pg * (1 - a);
    pb = b * a + pb * (1 - a);
    pa = a + pa * (1 - a);
  }
  if (pa <= 0) return { color: "#000000", opacity: 0 };
  const to = (v) => Math.max(0, Math.min(255, Math.round(v / pa)))
    .toString(16).padStart(2, "0");
  return { color: `#${to(pr)}${to(pg)}${to(pb)}`, opacity: pa };
}
