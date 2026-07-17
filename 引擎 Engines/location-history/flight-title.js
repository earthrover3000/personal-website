// flight-title — SINGLE SOURCE OF TRUTH for the private travel calendar's
// flight-event title grammar. A booked or estimated flight names its route in
// the event SUMMARY as two 3-letter LOCATION codes (specific IATA airports OR
// IATA metro / multi-airport city codes, resolved uniformly downstream) joined
// by an arrow. Everything else on the line — a plane glyph, the flight number
// after a bullet ("• BA 4466"), an "(estimated)" tail — is ignored.
//
// TWO consumers, ONE grammar:
//   • lifespan-atlas's `virtual:stays` vite plugin (build time, RAW .ics text)
//     turns each flight into a country transition for the residence shading;
//   • the itinerary-calendar page's route mini-map (runtime, ical.js-parsed
//     summaries) turns the hovered flight into a great-circle arc.
//
// This module works purely on the title STRING and stays framework-agnostic and
// browser-runnable (a plain ES module, like the sibling event-marks engine).
// Envelope parsing — .ics unfolding / VEVENT splitting / DTSTART extraction — is
// each consumer's own job (stays.ts on raw text, the page via ical.js) and
// deliberately lives OUTSIDE this module.

/** Two 3-letter uppercase codes joined by an arrow: "->", U+2192 (→), or
 *  U+27A1 (➡) with an optional U+FE0F variation selector. `\b` anchors both
 *  codes so a stray pair of 3-letter words elsewhere in a longer title can't
 *  false-match. Capture groups: [1] origin code, [2] destination code. */
export const FLIGHT_TITLE_ARROW = /\b([A-Z]{3})\s*(?:->|[→➡]️?)\s*([A-Z]{3})\b/;

/** Extract a flight's { origin, dest } location codes from an event title, or
 *  null when the title isn't a recognised flight. Zero-width and BOM characters
 *  (some calendar apps inject them) are stripped first so they can't break the
 *  `\b` anchors. Codes are returned verbatim (uppercase, UNRESOLVED) — the
 *  caller maps them to a country or an airport coordinate. */
export function parseFlightTitle(summary) {
  if (!summary) return null;
  const cleaned = String(summary).replace(/[\u200B-\u200D\uFEFF]/g, '');
  const m = cleaned.match(FLIGHT_TITLE_ARROW);
  return m ? { origin: m[1], dest: m[2] } : null;
}
