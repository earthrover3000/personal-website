// Types for departure-day.js — when a journey STARTS, as opposed to when the
// aircraft leaves the ground.

/** A flight, reduced to the three things the rules read. */
export interface DepartureFlight {
  /** Local departure date, `YYYY-MM-DD`. */
  date: string;
  /** Origin location code (IATA airport or metro code). Only the hotel rule
   *  reads it. */
  origin?: string;
  /** Local departure hour 0–23, or null when unknown — the 4am rule abstains
   *  rather than guessing. */
  hour?: number | null;
}

export interface DepartureDayOptions {
  /** Location codes belonging to base cities (people.yaml `base: true`).
   *  lifespan-atlas builds this with `baseCodes()` in vite/placesLived.ts. */
  baseCodes?: Iterable<string>;
  /** LOCAL `YYYY-MM-DD` check-out dates of known lodging stays. Must already
   *  be resolved to local dates — see departure-day.js on the UTC-stamp trap. */
  checkOutDates?: string[];
}

export interface DepartureDayResult {
  /** The effective start date, `YYYY-MM-DD`. */
  date: string;
  /** Whole days moved: 0 or 1 (see MAX_SHIFT_DAYS). */
  shifted: number;
  /** Every rule that fired — 'before-4am', 'hotel-checkout-on-departure' — so
   *  a consumer can explain a countdown that reads a day early. */
  reasons: string[];
}

/** The hour a day starts for "when did this journey begin". */
export declare const DEPARTURE_DAY_BOUNDARY_HOUR: number;

/** The cap on how far any combination of rules may move a departure. */
export declare const MAX_SHIFT_DAYS: number;

/** `YYYY-MM-DD` → `YYYY-MM-DD`, n days later. Null on an unparseable input. */
export declare function shiftIsoDate(iso: string, days: number): string | null;

/** Whether a location code names a base city's airport. */
export declare function isBaseCode(
  code: string | null | undefined,
  baseCodes: Iterable<string> | null | undefined,
): boolean;

/** The date a journey starts. See departure-day.js for the two rules, why
 *  they never stack, and the three cases they cannot see. */
export declare function departureDay(
  flight: DepartureFlight,
  opts?: DepartureDayOptions,
): DepartureDayResult;
