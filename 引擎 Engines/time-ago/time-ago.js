// time-ago — how long ago, in words: THE one spelling of it (user decision
// 2026-10-20: "SSOT the time countdown everywhere, using the same format").
//
//   just now · 1 second ago · 42 seconds ago · 3 minutes ago · 2 hours ago
//   · 5 days ago · 3 weeks ago · 4 months ago · 2 years ago
//
// "just now" for the first second only (user decision 2026-10-20: a label
// that ticks every second counts 1, 2, 3 … rather than jumping from "just
// now" to "5 seconds"). Seconds only under a minute, then whole units — the format the website's
// index pages, its stats pages' "Last updated" and the Lifespan Atlas's
// About screen each spelled out separately until this file, and the
// Noticeboard's "refreshed … ago". Who reads it:
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

const agoUnit = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** `seconds` elapsed (clamped at 0, floored) as words. */
export function agoText(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 1) return "just now";
  if (s < 60) return agoUnit(s, "second");
  if (s < 3600) return agoUnit(Math.floor(s / 60), "minute");
  if (s < 86400) return agoUnit(Math.floor(s / 3600), "hour");
  if (s < 1209600) return agoUnit(Math.floor(s / 86400), "day");
  if (s < 5443200) return agoUnit(Math.floor(s / 604800), "week");
  if (s < 31557600) return agoUnit(Math.floor(s / 2629800), "month");
  return agoUnit(Math.floor(s / 31557600), "year");
}

// THE SHORT FORM — a duration as at most two units, larger first, the
// second always two digits: 45s · 3m45s · 2h05m · 1d03h (user decisions
// 2026-10-22, for the Sessions widget). As parts, one per unit, so a
// page can stand each unit in its own column and every m sits under every
// m. The SAME RULE in Python is claude_sessions.fmt_age (Readouts) —
// change both together.
const pad2 = (n) => String(n).padStart(2, "0");

/** `seconds` (clamped at 0, floored) as {d, h, m, s}: each "" or e.g. "3m". */
export function durationUnits(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const out = { d: "", h: "", m: "", s: "" };
  if (s < 60) {
    out.s = `${s}s`;
  } else if (s < 3600) {
    out.m = `${Math.floor(s / 60)}m`;
    out.s = `${pad2(s % 60)}s`;
  } else if (s < 86400) {
    out.h = `${Math.floor(s / 3600)}h`;
    out.m = `${pad2(Math.floor((s % 3600) / 60))}m`;
  } else {
    out.d = `${Math.floor(s / 86400)}d`;
    out.h = `${pad2(Math.floor((s % 86400) / 3600))}h`;
  }
  return out;
}
