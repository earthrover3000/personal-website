// Type declarations for the shared future-register module
// (future-registers.js) — how a band says "this time is not settled". SSOT for
// the lifespan-atlas app (imported as `ring-log/future-registers`;
// lib/futureRegisters.ts re-exports the registers and theme/display.ts
// re-exports mixHex) and the site's site-log-rings page-widget.

/** Parse "#rgb" or "#rrggbb" into [r, g, b] (0-255). */
export declare function parseHex(h: string): [number, number, number];
/** Blend two hex colours in sRGB: t=0 → a, t=1 → b. Both must be real hex —
 *  a CSS var() string parses to NaN. */
export declare function mixHex(a: string, b: string, t: number): string;
/** ② The ground past a claim's end — flat, full-opacity, hard-edged. */
export declare function projectionGround(futureGrey: string): string;
/** ③ One step of a band dissolving forward toward `futureGrey`. */
export declare function dissolveToFuture(color: string, futureGrey: string, t: number): string;
