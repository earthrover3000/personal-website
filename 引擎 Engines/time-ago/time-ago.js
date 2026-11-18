// time-ago — THE spelling of every duration: how long ago, how long, how
// long until (user decisions 2026-10-20: "SSOT the time countdown
// everywhere, using the same format"; 2026-11-17: "h", never "hr", and a
// set of STANDARD STYLES to quote by name from now on).
//
// THE STANDARD STYLES — a readout is named "<style> <shape>", e.g. "Short
// ago" or "Full span":
//
//   SHORT     columns, cards, terminal rows: anywhere tight
//   FULL      sentences, "Last updated", the status line: words in full
//   CLOCK     counting down to a moment: 01:20 · 27:05 (the status line's
//             and the sun's; spelled where they are — sun-countdown and
//             claude.sh — not here)
//   CALENDAR  a thing with only a date: today · yesterday · 3 days ago ·
//             in 2 years 1 month (relative-time.js's `relative-time-coarse`)
//   COMPACT   the tightest span: no space before the unit (d h m s), one
//             space between parts, never padded. Every unit from the
//             largest down to a FLOOR, zeros kept below the lead (user
//             decisions 2026-11-18). Span: compactSpanText, and
//             compactUnits for a page with a column per unit; until:
//             compactUntilText, rounded UP to the floor ("in 1h 20m");
//             unit: compactUnitText, ONE whole unit, hours up to 48 h
//             ("15m", "30h", "3d" — the Services panel's ages); ago:
//             compactAgoText, that unit + " ago", "just now" under a
//             minute ("fetched 30h ago").
//               floor h   6d 17h · 6d 0h · 17h · 0h
//                         (the status line's 7-day countdown, Usage page)
//               floor s   45s · 3m 7s · 2h 0m 7s · 1d 0h 5m 0s
//                         (the Noticeboard's Sessions widget)
//
// THE SHAPES, in Short and Full:
//
//   shape   Short                  Full                      function
//   ago     3 min ago              3 minutes ago             agoText / fullAgoText
//   span    2 h 5 min              2 hours 5 minutes         spanText / fullSpanText
//   until   in 1 h 20 min          in 1 hour 20 minutes      untilText / fullUntilText
//   unit    15 min                 15 minutes                unitText / fullUnitText
//
// THE LADDER is one for every style: s → min → h → d, then (ago and unit)
// weeks from 14 days, months from 9 weeks, years from 12 months. An ago or
// a unit is one whole unit, rounded down; a span is at most two, larger
// first, the second left out at zero; an until is a span to the minute,
// rounded up, "now" once it has come. "just now" for the first second only
// (user decision 2026-10-20: a label that ticks every second counts 1, 2,
// 3 … rather than jumping from "just now" to "5 s"). CALENDAR counts in
// days up to 60, then months and years.
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
// 2026-11-18, the Services panel's rule before 2026-11-17): a daily job
// that last ran 30 hours ago reads "30h", not "1d", so a missed run shows.
const COMPACT_DAYS_FROM = 48 * 3600;

/** Compact unit (floored): one whole unit, minutes under an hour, HOURS up
 *  to 48 h, then days — "0m", "15m", "30h", "3d". `largest` "h" never turns
 *  to days ("50h"), for a figure read against an hour target (the Beta
 *  hold's "30h/24h", 2026-11-18). */
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
