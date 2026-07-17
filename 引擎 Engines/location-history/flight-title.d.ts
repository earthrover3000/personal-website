// Types for flight-title.js — the shared flight-event title grammar.

/** A flight's endpoints, as verbatim (uppercase, unresolved) 3-letter codes. */
export interface FlightRoute {
  /** Origin location code (IATA airport or metro/multi-airport city code). */
  origin: string;
  /** Destination location code. */
  dest: string;
}

/** The route-matching regex (see flight-title.js). */
export declare const FLIGHT_TITLE_ARROW: RegExp;

/** Parse an event title into its { origin, dest } codes, or null when it isn't
 *  a recognised flight. */
export declare function parseFlightTitle(
  summary: string | null | undefined,
): FlightRoute | null;
