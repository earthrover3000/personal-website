// stay-title — SINGLE SOURCE OF TRUTH for the travel calendar's LODGING event
// title grammar, the sibling of flight-title.js. A stay hand-entered on that
// calendar names itself with a 🏨 and then the place:
//
//     🏨 Dublin City Centre (North Docklands)
//
// WHY A GLYPH AT ALL, when this tree's standing rule is that "a rule which
// needs remembering at typing time is the one thing this design avoids"
// (flight-title.js, on why a MISSING flight number is the estimate marker
// rather than a typed one). Two answers, and the second is the real one:
//
//   1. There is nothing structural to infer from. A flight announces itself
//      with a route — two location codes and an arrow, which nobody types by
//      accident. A stay is a multi-day event with a place name, which is also
//      what a conference, a visit and a holiday look like. Inferring "lodging"
//      from shape would silently claim all of them.
//   2. The glyph EARNS ITS PLACE IN THE CALENDAR APP before it earns anything
//      here. Hotel nights should read apart from flights when you scan a
//      month. It is a mark you would want even if no code existed — which is
//      exactly what that rule is protecting, since the cost it objects to is
//      typing something FOR the machine.
//
// TWO SOURCES, ONE SHAPE. Stays reach this app from the hand-entered travel
// calendar and (for now) from TripIt's own feed, which writes a check-in and a
// check-out event instead of one spanning event. This module is ONLY about the
// hand-entered form; TripIt's grammar lives with the reader that knows TripIt
// (日程 Agenda's lodging/feed.py), exactly as this module stays out of the
// .ics envelope. The two are unioned downstream, deduped on date and name,
// and the calendar wins — it is the half a human curates.
//
// THREE consumers, ONE grammar, the same arrangement flight-title.js has:
//   • 日程 Agenda's lodging/feed.py — full Stay records for the 中文 card;
//   • lifespan-atlas's `virtual:stays` vite plugin — check-out dates, for the
//     departure-day rule;
//   • 原点 Origin's statusline next-prospect.py, which MIRRORS this in stdlib
//     Python because it can import no ES module. Change the glyph here and
//     change it there.
//
// Like its sibling this works purely on the title STRING, stays
// framework-agnostic and browser-runnable, and parses no .ics: envelopes are
// each consumer's own job.

/** The lodging marker. One place, so retiring 🏨 for something else is one
 *  edit here plus its Python mirror — and note that changing it ORPHANS every
 *  event already typed with the old one, which is why it should not change. */
export const STAY_TITLE_GLYPH = '🏨';

/** Zero-width and BOM characters: some calendar apps inject them around an
 *  emoji, and they would sit between the glyph and the name. Stripped before
 *  anything else looks at the title, as flight-title.js does for its arrow. */
const INVISIBLE = /[​-‍﻿️]/g;

/**
 * Parse a lodging event title, or null when it is not one.
 *
 * Deliberately forgiving about everything except the glyph: any amount of
 * space after it, and the whole remainder is the name. A hotel name can hold
 * anything — commas, brackets, another language — so imposing further
 * structure would only create ways to type it wrong.
 *
 * @param {string} summary the event SUMMARY.
 * @returns {{name: string}|null}
 */
export function parseStayTitle(summary) {
  if (!summary) return null;
  const cleaned = String(summary).replace(INVISIBLE, '').trim();
  if (!cleaned.startsWith(STAY_TITLE_GLYPH)) return null;
  const name = cleaned.slice(STAY_TITLE_GLYPH.length).trim();
  return name ? { name } : null;
}
