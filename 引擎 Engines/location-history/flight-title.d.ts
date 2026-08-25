// Types for flight-title.js — the shared flight-event title grammar.

/** A flight parsed out of a travel-calendar event title. */
export interface FlightRoute {
  /** Origin location code (IATA airport or metro/multi-airport city code). */
  origin: string;
  /** Destination location code. */
  dest: string;
  /** Carrier + number as one string ("BA 4467"), or null when the title
   *  carries none — which is what makes the flight an ESTIMATE. */
  flightNo: string | null;
  /** Whether a ticket exists: `flightNo !== null`. See flight-title.js on why
   *  the flight number is the discriminator. */
  booked: boolean;
}

/** The route-matching regex (see flight-title.js). */
export declare const FLIGHT_TITLE_ARROW: RegExp;

/** The bullet-prefixed flight-number regex (see flight-title.js). */
export declare const FLIGHT_TITLE_NUMBER: RegExp;

/** Parse an event title into a flight, or null when it isn't a recognised
 *  flight (no route). */
export declare function parseFlightTitle(
  summary: string | null | undefined,
): FlightRoute | null;
