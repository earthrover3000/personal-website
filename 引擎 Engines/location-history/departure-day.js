// departure-day — SINGLE SOURCE OF TRUTH for the date a journey STARTS, as
// opposed to the date the aircraft leaves the ground. The two differ more
// often than they look, and the gap is what this module owns.
//
// THE QUESTION IT ANSWERS (user decision 2026-08-25). The statusline countdown
// and the atlas's Prospects list both mean "when do I go?", not "what does the
// airline's schedule say?" — so when a hotel night is booked before a morning
// flight, the day you left home is the day you checked in. That is a fact
// about location history, not a fudge of the timetable: you moved out of your
// flat on the 10th and the plane happened to leave on the 11th.
//
// WHAT DOES *NOT* CONSUME THIS, deliberately: the 🗓️ Agenda cards. A flight
// card sent to family says the flight's own date, because a reader who looks
// MU 232 up must find the date the card gave them. This module exists for the
// surfaces that describe the traveller, never for those that quote a carrier.
// Nor does it move a COUNTRY BOUNDARY: a Dublin hotel is still Ireland, so the
// residence shading keeps reading the flight date and only the Prospects ROW
// date reads this. `stays.ts` carries both values for exactly that reason.
//
// TWO INDEPENDENT RULES. They are not one rule with two branches, and the
// distinction is load-bearing:
//
//   • THE HOTEL RULE needs a lodging feed, and fires only when leaving a BASE
//     (people.yaml `base: true`). A hotel in a city you are already travelling
//     in is one more night of a trip already under way, not leaving home.
//   • THE 4AM RULE needs no feed at all, and applies EVERYWHERE (user
//     decision 2026-08-25). A departure before 04:00 local means you were up
//     and moving the previous evening wherever you were. It is not
//     hypothetical: of the twelve flights on the live calendar on 2026-08-25,
//     two leave Shanghai at 01:40 and 02:11 — both from a base, both with
//     nothing booked, because that base is a parent's flat.
//
// THEY TAKE THE EARLIER RESULT AND NEVER STACK. Composed, a hotel checking out
// on the day of an 02:11 flight would shift two days; capped, it shifts one.
// MAX_SHIFT_DAYS is the cap and it is applied to the FINAL answer, so a third
// rule added later cannot quietly reintroduce stacking.
//
// A MULTI-NIGHT STAY STILL SHIFTS ONLY ONE DAY (user decision 2026-08-25).
// Checking in three nights early does not make the journey start three days
// earlier for these two readouts. The cap is what keeps the rule from needing
// to know anything about how long a stay was.
//
// WHAT IT CANNOT SEE, recorded because each fails SILENTLY rather than
// wrongly, and none is worth building for:
//   1. Leaving home the night before without booking anything — a friend's
//      sofa, a night train, sleeping at the airport. In no feed.
//   2. Already travelling, but in a base city: fly Galway→Dublin, hotel in
//      Dublin, fly out next morning. The origin is a base and the checkout is
//      on the flight day, so the rule fires though you never left home.
//      Catching it needs the PREVIOUS stay; the one-day cap bounds the error.
//   3. A base-city hotel booked for a non-travel reason that happens to check
//      out on a day you fly. Coincidence, same one-day bound.
//
// THREE consumers, ONE rule:
//   • lifespan-atlas's `virtual:stays` vite plugin (build time), which sets
//     Stay.departedHome and leaves Stay.start alone;
//   • the Prospects forward list, which reads that field for its row date;
//   • 原点 Origin's statusline `next-prospect.py`, which MIRRORS this module
//     in stdlib Python rather than importing it — the same arrangement
//     flight-title.js already has with that script, for the same reason (it
//     must run with no node and no third-party package). Change the rule here
//     and change it there; the Python side names this file.
//
// Like flight-title.js beside it, this works purely on plain values and stays
// framework-agnostic and browser-runnable. It parses no .ics: feed envelopes
// are each consumer's own job.

/** The hour a "day" starts for the purposes of when a journey began. A
 *  departure before this hour belongs to the previous day. 4am rather than
 *  midnight because the small hours belong to the evening that produced them
 *  — nobody describes a 02:11 flight as leaving "on Tuesday" when they left
 *  the house at 23:00 on Monday. */
export const DEPARTURE_DAY_BOUNDARY_HOUR = 4;

/** The most any combination of rules may move a departure. See the header on
 *  why this is applied once, at the end, rather than per rule. */
export const MAX_SHIFT_DAYS = 1;

/** ISO `YYYY-MM-DD` → `YYYY-MM-DD`, n days later (negative goes back).
 *  Anchored at UTC noon so no local timezone or DST transition can round a
 *  date across a boundary — the values here are calendar dates, not moments,
 *  and must not acquire a zone on the way through Date. */
export function shiftIsoDate(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/** Whether `code` names a base city's airport. Accepts a Set or an array, and
 *  compares uppercased — the calendar writes IATA codes uppercase but a hand
 *  edit to people.yaml or cities.yaml need not. */
export function isBaseCode(code, baseCodes) {
  if (!code || !baseCodes) return false;
  const wanted = String(code).toUpperCase();
  const list = baseCodes instanceof Set ? baseCodes : new Set(baseCodes);
  for (const c of list) if (String(c).toUpperCase() === wanted) return true;
  return false;
}

/**
 * The date a journey STARTS.
 *
 * @param {object} flight
 * @param {string} flight.date      local departure date, `YYYY-MM-DD`.
 * @param {string} [flight.origin]  origin location code; only the hotel rule
 *                                  reads it.
 * @param {number|null} [flight.hour] local departure hour 0–23, or null/undefined
 *                                  when unknown — the 4am rule then abstains
 *                                  rather than guessing, since a missing hour
 *                                  is not a small one.
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.baseCodes] codes counting as bases.
 * @param {string[]} [opts.checkOutDates] local `YYYY-MM-DD` check-out dates of
 *                                  known lodging stays. LOCAL dates: a feed
 *                                  that stamps UTC (TripIt does, with no TZID
 *                                  anywhere) puts a 07:00 Shanghai checkout on
 *                                  the previous day, and this rule would then
 *                                  silently stop firing. The caller must have
 *                                  resolved that already.
 * @returns {{date: string, shifted: number, reasons: string[]}}
 *          `date` is the effective start; `shifted` is whole days moved (0 or
 *          1); `reasons` names every rule that fired, so a consumer can say
 *          WHY a countdown reads a day early instead of looking broken.
 */
export function departureDay(flight, opts = {}) {
  const base = flight && typeof flight.date === 'string' ? flight.date : null;
  if (!base || !shiftIsoDate(base, 0)) {
    return { date: base, shifted: 0, reasons: [] };
  }
  const reasons = [];

  // Rule: 4am boundary. Everywhere, no feed.
  const hour = flight.hour;
  if (typeof hour === 'number' && hour >= 0 && hour < DEPARTURE_DAY_BOUNDARY_HOUR) {
    reasons.push('before-4am');
  }

  // Rule: hotel night before a flight out of a base.
  const outs = opts.checkOutDates || [];
  if (isBaseCode(flight.origin, opts.baseCodes) && outs.some((d) => d === base)) {
    reasons.push('hotel-checkout-on-departure');
  }

  // Take the earlier result, then cap. Both rules currently move by one day,
  // so the cap is not yet doing visible work — it is here so that a third rule
  // moving two days cannot silently compose with these.
  const shifted = reasons.length ? Math.min(1, MAX_SHIFT_DAYS) : 0;
  return { date: shiftIsoDate(base, -shifted), shifted, reasons };
}
