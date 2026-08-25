// flight-title — SINGLE SOURCE OF TRUTH for the private travel calendar's
// flight-event title grammar. A flight names its route in the event SUMMARY as
// two 3-letter LOCATION codes (specific IATA airports OR IATA metro /
// multi-airport city codes, resolved uniformly downstream) joined by an arrow.
// A plane glyph and any other decoration on the line are ignored.
//
// BOOKED vs ESTIMATED is decided here too, and the discriminator is the FLIGHT
// NUMBER (user decision 2026-08-25). Flighty syncs every ticketed flight into
// this calendar as "✈ DUB→LCY • BA 4467" — glyph, route, bullet, carrier,
// number — so a bullet-prefixed flight number means a seat exists. A route
// typed by hand for a trip intended but not ticketed ("LHR → PVG", optionally
// tailed "(estimated)") carries no number, and reads as an ESTIMATE. Nothing
// extra needs typing: the ABSENCE is the marker. Every one of the 14 events in
// the live feed on 2026-08-25 was Flighty-shaped, so today nothing classifies
// as an estimate — the field exists for the trips that aren't booked yet.
//
// The direction this can fail was weighed and accepted: were Flighty to stop
// emitting the number, a booked flight would classify as an estimate and hide
// behind the Prospects "Unbooked" toggle. The repair then is to widen
// FLIGHT_TITLE_NUMBER, NOT to introduce a marker convention — a rule that
// needs remembering at typing time is the one thing this design avoids.
//
// TWO consumers, ONE grammar:
//   • lifespan-atlas's `virtual:stays` vite plugin (build time, RAW .ics text)
//     turns each flight into a country transition for the residence shading,
//     and carries `booked` through to the Prospects forward list, which shows
//     booked flights always and gates only the estimates;
//   • the itinerary-calendar page's route mini-map (runtime, ical.js-parsed
//     summaries) turns the hovered flight into a great-circle arc. It reads
//     only origin/dest, so the added fields cost it nothing.
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

/** A bullet-prefixed flight number — "• BA 4467". The BULLET is required: it
 *  is what Flighty writes, and without it a bare "PVG 2026" in a hand-typed
 *  title would read as a flight number. The carrier is an IATA 2-character
 *  code, which may pair a digit with a letter either way round ("U2", "3U"),
 *  so all three shapes are spelled out rather than allowing [A-Z0-9]{2} —
 *  that would match a bare 2-digit number. U+00B7 (·) is accepted beside
 *  U+2022 (•) because some calendar apps substitute it.
 *  Capture groups: [1] carrier, [2] number. */
export const FLIGHT_TITLE_NUMBER = /[•·]\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*(\d{1,4})\b/;

/** Extract a flight from an event title, or null when the title isn't a
 *  recognised flight (no route ⇒ not a flight at all — the same calendar holds
 *  Train events, which this drops).
 *
 *  Zero-width and BOM characters (some calendar apps inject them — Flighty
 *  brackets its arrow with them) are stripped first so they can't break the
 *  `\b` anchors.
 *
 *  Returns:
 *    origin, dest — verbatim (uppercase, UNRESOLVED) codes; the caller maps
 *                   them to a country or an airport coordinate.
 *    flightNo     — "BA 4467" (single-spaced), or null when the title has none.
 *    booked       — whether a ticket exists, i.e. `flightNo !== null`. Kept as
 *                   its own field so the rule has ONE home and a consumer
 *                   never has to re-derive "no number means an estimate". */
export function parseFlightTitle(summary) {
  if (!summary) return null;
  const cleaned = String(summary).replace(/[\u200B-\u200D\uFEFF]/g, '');
  const m = cleaned.match(FLIGHT_TITLE_ARROW);
  if (!m) return null;
  const n = cleaned.match(FLIGHT_TITLE_NUMBER);
  const flightNo = n ? `${n[1]} ${n[2]}` : null;
  return { origin: m[1], dest: m[2], flightNo, booked: flightNo !== null };
}
