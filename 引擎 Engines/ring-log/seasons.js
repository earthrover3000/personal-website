// ring-log/seasons — the four seasons as a ring: where they start, where
// their glyphs sit, and what those glyphs are. The SSOT shared by BOTH
// consumers of the season ring:
//   • the lifespan-atlas app — src/lib/time.ts re-exports the fractions,
//     src/theme/display.ts the glyphs and src/lib/clockGeometry.ts the
//     placement radius, all via the `ring-log/seasons` alias
//     (vite.config.ts resolve.alias + the tsconfig.app.json path), so every
//     app importer keeps its historical `@/lib/time` / `@/theme/display` /
//     `@/lib/clockGeometry` path;
//   • the site's Site Log rings page-widget (界面 UI/page-widgets/
//     site-log-rings.js), which dynamic-imports this file by relative path.
// A sibling of rings.js rather than part of it, on exactly the argument
// phase-color.js already makes: rings.js is contractually geometry-only,
// while this module is calendar CONTENT — fractions and glyphs. It ships
// with the module (the co-located `.public` marker deploys the folder
// whole).
//
// Moved VERBATIM from the app (2026-09-05) — SEASON_STARTS / SEASON_MIDPOINTS
// from src/lib/time.ts, SEASON_EMOJIS from src/theme/display.ts,
// SEASON_EMOJI_RATIO from src/lib/clockGeometry.ts. The fractions are a
// deliberate season division (see below), not an approximation of anything;
// do NOT "improve" a constant here without checking both consumers.

// Season-start fractions within a year, written as simple /24ths of a year
// from the origin-solstice epoch (fraction 0 ≡ YOUR winter solstice —
// December up north, June down south; the fractions are origin-relative, so
// they carry over to southern mode UNCHANGED, no rotation: user decision
// 2026-08-13). Kept as fractions, not hard-coded decimals. Order
// [spring, summer, autumn, winter], northern calendar shown:
//   spring   6/24 (≈ 0.250) → ~Mar 22  (southern: ~Sep 20)
//   summer  11/24 (≈ 0.458) → ~Jun 7   (southern: ~Dec 6)
//   autumn  18/24 (≈ 0.750) → ~Sep 21  (southern: ~Mar 21)
//   winter  23/24 (≈ 0.958) → ~Dec 7   (just before the origin solstice, so
//                                       the solstice sits INSIDE winter;
//                                       winter then wraps past the year seam)
// These drive the "seasons" shading and SEASON_MIDPOINTS (season-emoji
// placement). This is an INTENTIONAL season division — deliberately chosen, NOT
// an approximation of the astronomical solstices/equinoxes. It differs on purpose
// from getSeasonDate (the app's lib/seasons), which uses the astronomical dates
// for season-keyed EPOCH boundaries (so summer/winter shading starts sit ~2 weeks
// before those solstices). Don't "correct" these toward the solstices.
export const SEASON_STARTS = [6 / 24, 11 / 24, 18 / 24, 23 / 24];

/** Each season's MIDPOINT fraction — where its glyph is drawn. Winter wraps
 *  past the year seam, so its end is SEASON_STARTS[0] + 1 before the halving.
 *  The four land at 2.5/24, 8.5/24, 14.5/24 and 20.5/24 — i.e. every 90°,
 *  offset 37.5° from 12 o'clock, which is why a radius outside the rim still
 *  clears a square canvas: the glyphs sit near the CORNERS. */
export const SEASON_MIDPOINTS = SEASON_STARTS.map((start, i) => {
  const end = SEASON_STARTS[(i + 1) % 4] + (i === 3 ? 1 : 0); // winter wraps
  return ((start + end) / 2) % 1;
});

/** [spring, summer, autumn, winter] — the same order as SEASON_STARTS. Drawn
 *  as PLAIN text glyphs, not the app's Fluent 3D assets: the atlas's own
 *  Rings and Clock season rings use bare <text> here (EmojiGlyphSvg is not in
 *  play), and the public site has no Fluent 3D asset store at all, so a text
 *  glyph is what both consumers already render. */
export const SEASON_EMOJIS = ["🌿", "🔆", "🍂", "❄️"];

/** Radius of the season-glyph ring as a fraction of the square canvas edge —
 *  OUTSIDE the chart rim (the atlas's rims sit at 0.43 of the edge). The ring
 *  is FIXED and non-rotating: a glyph's screen angle is `midpoint · 2π`
 *  measured clockwise from 12 o'clock, with NO spiral phase applied, because
 *  the calendar is what it marks. */
export const SEASON_EMOJI_RATIO = 0.55;
