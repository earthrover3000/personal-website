// ring-log/phase-color — the deterministic personal-website version/phase
// colour, the SSOT shared by BOTH consumers of the website's phase palette:
//   • the lifespan-atlas app — src/theme/display.ts re-exports these via the
//     `ring-log/phase-color` alias (vite.config.ts resolve.alias + the
//     tsconfig.app.json path), so every app importer keeps its historical
//     `@/theme/display` path;
//   • the site's Site Log rings page-widget (界面 UI/page-widgets/
//     site-log-rings.js), which dynamic-imports this file by relative path.
// A sibling of rings.js rather than part of it: rings.js is contractually
// geometry-only ("no colours"), while this module is colour-only. It ships
// with the module (the co-located `.public` marker deploys the folder whole).
//
// Moved VERBATIM from the app's src/theme/display.ts (2026-08-01) — the
// formula, constants and rounding are part of the palette contract; do NOT
// "improve" anything here without checking both consumers.
//
// Personal-website version bands get a colour derived DETERMINISTICALLY from
// the stage's identity — its major.minor — never from the render-time band
// index. This keeps a given version's hue stable no matter which other
// versions are currently shipped or visible (shipping 0.1/0.2 must never
// recolour 0.3).
//   • Hue BAND by major PARITY: even majors (0,2,4…) → a blue band; odd majors
//     (1,3,5…) → a second band. Only two bands, alternating, so temporally-
//     adjacent big versions always contrast.
//   • Hue by minor, spread across the band in a FIXED-length ramp (PHASE_RAMP
//     slots): minor .1 … .PHASE_RAMP step across the band so 0.1…0.5 are five
//     DISTINCT hues (a lightness-only ramp was indistinguishable at band
//     opacity). "+" (open-ended) and any minor past the ramp clamp to the last
//     slot. So e.g. 0.3 is always the blue band's slot-3 hue.

export const PHASE_RAMP = 5;
// Hue band per parity, [first-slot hue, last-slot hue] in HSL degrees. Blue
// band first (the 0.x versions); the odd-major band is a teal-green placeholder
// until a 1.x version ships and its exact band is chosen.
export const PHASE_HUE_BANDS = [[205, 250], [120, 165]];
const PHASE_SATURATION = 70;
// Fixed lightness — the version distinction rides on hue, not lightness, so the
// bands stay equally legible over the grey "no info" base.
const PHASE_LIGHTNESS = 52;

/** @param {number} h @param {number} s @param {number} l @returns {string} */
function hslToHex(h, s, l) {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Deterministic colour for a personal-website version band, keyed on the
 *  stage identity (major.minor) — NOT on how many bands are visible. Even
 *  majors use the blue family, odd majors the second family; the minor index
 *  picks a fixed hue slot within a PHASE_RAMP-length ramp. "+" / overflow
 *  clamps to the last slot.
 *  @param {number} major @param {number | "+"} minor @returns {string} */
export function phaseColor(major, minor) {
  const [h0, h1] = PHASE_HUE_BANDS[Math.abs(major) % PHASE_HUE_BANDS.length];
  // Slot 0..PHASE_RAMP-1. minor ".1" → slot 0, ".PHASE_RAMP" → last slot.
  const slotRaw = minor === "+" ? PHASE_RAMP : minor;
  const slot = Math.min(Math.max(slotRaw - 1, 0), PHASE_RAMP - 1);
  const f = slot / Math.max(1, PHASE_RAMP - 1);
  const hue = h0 + f * (h1 - h0);
  return hslToHex(hue, PHASE_SATURATION, PHASE_LIGHTNESS);
}
