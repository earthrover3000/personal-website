// time-ago — THE spelling of every duration: how long ago, how long, how
// long until (user decisions 2026-10-20: "SSOT the time countdown
// everywhere, using the same format"; 2026-11-17: "h", never "hr", and a
// set of STANDARD STYLES to quote by name; 2026-11-18: COMPACT, precision
// per shape, every readout reviewed one by one).
//
// THE REGISTER — which readout uses which style, and why — is in the Python
// twin's docstring (引擎 Engines/time_ago), not here: this file ships with
// the public website, and the register names private pages.
//
// THE STANDARD STYLES — a readout is named "<style> <shape>":
//
//   SHORT     a value in a sentence or a list: spaced words, 2 h 5 min
//   FULL      quiet footnotes and tooltips: words in full, 3 minutes ago
//   COMPACT   glanceable figures and terminal lines: no space before the
//             unit (d h m s), one between parts, never padded — 6d 17h,
//             3m 7s, 30h ago
//   CLOCK     a moment counted down, HH:MM: 01:20 · 27:05 (spelled where
//             used, e.g. sun-countdown, not here)
//   CALENDAR  a date-only distance: in 18 days · 3 months ago
//             (relative-time.js's calendar; the atlas's age.ts spells it
//             compactly, 18 days · 2mo)
//
//   shape   Short           Full                  Compact
//   ago     3 min ago       3 minutes ago         30h ago / just now
//   span    2 h 5 min       2 hours 5 minutes     6d 17h · 2h 0m 7s
//   until   in 1 h 20 min   in 1 hour 20 minutes  in 1h 20m
//   unit    15 min          15 minutes            15m · 30h · 3d
//
//   agoText spanText untilText unitText / full*Text / compactAgoText
//   compactSpanText compactUntilText compactUnitText compactUnits
//
// PRECISION, per shape:
//
//   SHORT/FULL ago, unit  one whole unit, floored: s → min → h → d, then
//                         weeks from 14 d, months from 9 w, years from 12
//                         mo; "just now" for the first second only (user
//                         decision 2026-10-20: a label ticking every second
//                         counts 1, 2, 3 … rather than jumping to "5 s")
//   SHORT/FULL span       at most two units, the zero part DROPPED, floored
//   SHORT/FULL until      a span rounded UP to the minute, then "now"
//   COMPACT span          every unit from the largest down to a FLOOR, the
//                         zeros below the lead KEPT ("2h 0m 7s"); floor
//                         "h" by default ("6d 0h", "17h", "0h")
//   COMPACT until         rounded UP to the floor ("m" by default), zeros
//                         kept, then "now"
//   COMPACT unit, ago     one whole unit: minutes, HOURS UP TO 48 h ("30h"),
//                         then days; largest "h" never turns to days; ago
//                         is "just now" under a minute
//   CALENDAR              whole days UP TO 70, then calendar months/years
//   CLOCK                 hours:minutes, zero-padded, hours past a day
//
// A value that TICKS keeps its zeros, so no cell blinks out at a round
// number; a FIXED value drops them ("1 h" on a picker).
//
// The short units are the Lifespan Atlas's own (d, w, mo, yr), so a
// duration and a life span share one vocabulary.
//
// THE SAME RULE IN PYTHON is 引擎 Engines/time_ago — `python -m time_ago
// --check` runs both over the same seconds and fails on any difference.
// Who reads this file:
//
//   · 界面 UI/page-widgets/relative-time.js — inlined into pages by
//     `index_page.read_relative_time_js`, which places this file's text
//     (its `export` dropped) in front of it;
//   · 界面 UI/page-widgets/stats-table.js — `import()`s it from beside
//     itself (../../引擎 Engines/time-ago/), the same hop on the website and
//     on the /workshop/ mount;
//   · the Lifespan Atlas — the `time-ago` alias (vite.config.ts,
//     vitest.config.ts, tsconfig.app.json), as `sun-countdown` is.
//
// Ships with the website (`.public`). Pure: no DOM, no clock — the caller
// passes the seconds.

// [seconds per unit, its word], largest first.
const SPAN_UNITS = [[86400, "d"], [3600, "h"], [60, "min"], [1, "s"]];

/** The one whole unit an "ago" is told in. */
function agoUnit(s) {
  if (s < 60) return [s, "s"];
  if (s < 3600) return [Math.floor(s / 60), "min"];
  if (s < 86400) return [Math.floor(s / 3600), "h"];
  if (s < 1209600) return [Math.floor(s / 86400), "d"];
  if (s < 5443200) return [Math.floor(s / 604800), "w"];
  if (s < 31557600) return [Math.floor(s / 2629800), "mo"];
  return [Math.floor(s / 31557600), "yr"];
}

/** `seconds` (clamped at 0, floored) in its one whole unit: "5 h",
 *  "15 min" — an "ago" without the word, for a column or "every 6 h". */
export function unitText(seconds) {
  const [n, unit] = agoUnit(Math.max(0, Math.floor(seconds)));
  return `${n} ${unit}`;
}

/** `seconds` elapsed (clamped at 0, floored): "just now", "3 min ago". */
export function agoText(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 1) return "just now";
  const [n, unit] = agoUnit(s);
  return `${n} ${unit} ago`;
}

/** `seconds` (clamped at 0, floored) as {d, h, m, s}: each "" or its part
 *  ("3 min"), at most two set, the larger first — for a page that stands
 *  each unit in its own column. */
export function durationUnits(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const keys = ["d", "h", "m", "s"];
  const out = { d: "", h: "", m: "", s: "" };
  const i = SPAN_UNITS.findIndex(([n]) => s >= n);
  const lead = i < 0 ? 3 : i;
  const [big, word] = SPAN_UNITS[lead];
  out[keys[lead]] = `${Math.floor(s / big)} ${word}`;
  if (lead < 3) {
    const [small, word2] = SPAN_UNITS[lead + 1];
    const rest = Math.floor((s % big) / small);
    if (rest) out[keys[lead + 1]] = `${rest} ${word2}`;
  }
  return out;
}

/** `seconds` as a span: "45 s", "2 h 5 min", "1 d 3 h". */
export function spanText(seconds) {
  const u = durationUnits(seconds);
  return [u.d, u.h, u.m, u.s].filter(Boolean).join(" ");
}

// Each short unit's word in full.
const FULL_WORDS = { s: "second", min: "minute", h: "hour", d: "day",
                     w: "week", mo: "month", yr: "year" };
const fullPart = (n, unit) => `${n} ${FULL_WORDS[unit]}${n === 1 ? "" : "s"}`;

/** `seconds` in its one whole unit, in words: "15 minutes", "5 hours". */
export function fullUnitText(seconds) {
  const [n, unit] = agoUnit(Math.max(0, Math.floor(seconds)));
  return fullPart(n, unit);
}

/** `seconds` elapsed, in words: "just now", "3 minutes ago". */
export function fullAgoText(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return s < 1 ? "just now" : `${fullUnitText(s)} ago`;
}

/** `seconds` as a span in words: "45 seconds", "1 hour 5 minutes",
 *  "4 days 2 hours". */
export function fullSpanText(seconds) {
  const u = durationUnits(seconds);
  return [u.d, u.h, u.m, u.s].filter(Boolean).map((p) => {
    const [n, unit] = p.split(" ");
    return fullPart(Number(n), unit);
  }).join(" ");
}

/** Full until: "in 1 hour 20 minutes", or "now". */
export function fullUntilText(seconds) {
  const s = Math.ceil(seconds / 60) * 60;
  return s <= 0 ? "now" : `in ${fullSpanText(s)}`;
}

// COMPACT's units, largest first: [seconds per unit, its letter].
const COMPACT_UNITS = [[86400, "d"], [3600, "h"], [60, "m"], [1, "s"]];

/** Compact parts {d, h, m, s} (floored): every unit from the largest that
 *  fits down to `floor` set, zeros included; the rest "". Under the floor
 *  the floor alone, "0h" / "0s". */
export function compactUnits(seconds, floor = "h") {
  const s = Math.max(0, Math.floor(seconds));
  const out = { d: "", h: "", m: "", s: "" };
  const last = COMPACT_UNITS.findIndex(([, u]) => u === floor);
  let lead = COMPACT_UNITS.findIndex(([n]) => s >= n);
  if (lead < 0 || lead > last) lead = last;
  for (let i = lead; i <= last; i++) {
    const [n, u] = COMPACT_UNITS[i];
    const above = i === lead ? Infinity : COMPACT_UNITS[i - 1][0];
    out[u] = `${Math.floor((s % above) / n)}${u}`;
  }
  return out;
}

/** Compact span (floored) down to `floor`: "6d 17h", "6d 0h", "17h" with
 *  the default hour floor; "2h 0m 7s", "45s" with "s". */
export function compactSpanText(seconds, floor = "h") {
  const u = compactUnits(seconds, floor);
  return [u.d, u.h, u.m, u.s].filter(Boolean).join(" ");
}

// Below this, a one-unit COMPACT age stays in hours (user decision
// 2026-11-18, an older rule restored): a daily job that last ran 30 hours
// ago reads "30h", not "1d", so a missed run shows.
const COMPACT_DAYS_FROM = 48 * 3600;

/** Compact unit (floored): one whole unit, minutes under an hour, HOURS up
 *  to 48 h, then days — "0m", "15m", "30h", "3d". `largest` "h" never turns
 *  to days ("50h"), for a figure read against an hour target ("30h/24h",
 *  2026-11-18). */
export function compactUnitText(seconds, largest = "d") {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (largest === "h" || s < COMPACT_DAYS_FROM) {
    return `${Math.floor(s / 3600)}h`;
  }
  return `${Math.floor(s / 86400)}d`;
}

/** Compact ago: "just now" under a minute, else the compact unit and
 *  "ago" — "15m ago", "30h ago", "3d ago". */
export function compactAgoText(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? "just now" : `${compactUnitText(s)} ago`;
}

/** Compact until, rounded UP to `floor` ("m" by default): "in 1h 20m",
 *  "in 2h 0m", "in 5m"; "now" once it has come. */
export function compactUntilText(seconds, floor = "m") {
  const n = COMPACT_UNITS.find(([, u]) => u === floor)[0];
  const s = Math.ceil(seconds / n) * n;
  return s <= 0 ? "now" : `in ${compactSpanText(s, floor)}`;
}

/** `seconds` until something, to the minute (rounded up): "in 1 h 20 min".
 *  "now" once it has come. */
export function untilText(seconds) {
  const s = Math.ceil(seconds / 60) * 60;
  return s <= 0 ? "now" : `in ${spanText(s)}`;
}
