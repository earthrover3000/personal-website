// Type declarations for the shared season module (seasons.js) — the four
// seasons as a ring, SSOT for the lifespan-atlas app (imported as
// `ring-log/seasons`; lib/time.ts, theme/display.ts and lib/clockGeometry.ts
// re-export it) and the site's site-log-rings page-widget.
//
// Types match what the app INFERRED before the move (mutable number[] /
// string[]), so no call site changes shape.

/** Season-start fractions within a year from the origin solstice, in
 *  /24ths — [spring, summer, autumn, winter]. An intentional division, NOT
 *  the astronomical solstices/equinoxes. */
export declare const SEASON_STARTS: number[];
/** Each season's midpoint fraction — where its glyph is drawn. */
export declare const SEASON_MIDPOINTS: number[];
/** [spring, summer, autumn, winter], drawn as plain text glyphs. */
export declare const SEASON_EMOJIS: string[];
/** Season-glyph ring radius as a fraction of the square canvas edge. */
export declare const SEASON_EMOJI_RATIO: number;
