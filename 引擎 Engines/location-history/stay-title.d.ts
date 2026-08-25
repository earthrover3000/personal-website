// Types for stay-title.js — the shared lodging-event title grammar.

/** A lodging stay parsed out of a travel-calendar event title. */
export interface StayTitle {
  /** The place, verbatim: everything after the 🏨 and its spacing. Never
   *  empty — a bare glyph parses as null rather than as a nameless stay. */
  name: string;
}

/** The lodging marker. See stay-title.js on why a glyph is used here when
 *  flight-title.js deliberately avoids a typed marker. */
export declare const STAY_TITLE_GLYPH: string;

/** Parse an event title into a stay, or null when it isn't one (no 🏨). */
export declare function parseStayTitle(
  summary: string | null | undefined,
): StayTitle | null;
