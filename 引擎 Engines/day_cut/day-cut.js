// day-cut — where one day ends and the next begins, for the browser: the
// JS half of 引擎 Engines/day_cut (user decisions 2026-10-21). The rule and
// its reasons are in __init__.py's docstring; the numbers are spec.json,
// which both halves read; cases.json is the test both must pass
// (check.mjs here, `self_check` there — `python -m day_cut` runs both).
//
//   DAY_CUT.CALENDAR  midnight, local clock — a calendar date.
//   DAY_CUT.SLEEP     04:00, local clock, every season — a day divided by
//                     sleep. 23 or 25 hours on a clock-change day.
//
// spec.json gives each cut an hour and a clock: "local" (the wall clock)
// or "winter" (the zone's SMALLEST UTC offset in the year, never a DST
// flag — Europe/Dublin calls its summer clock standard time). Zones are
// IANA names, worked through Intl, so a page can speak for a place other
// than the device it runs on. Days are ISO `YYYY-MM-DD` strings; instants
// are epoch ms.
//
// Pure: no DOM, no clock — the caller passes the instant.
import spec from "./spec.json" with { type: "json" };

export const DAY_CUT = Object.freeze({ CALENDAR: "calendar", SLEEP: "sleep" });
export const DAY_CUT_SPEC = spec;

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const formats = new Map();
function format(tz) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric",
      day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formats.set(tz, f);
  }
  return f;
}

/** The wall clock of `ms` in `tz`, as the epoch ms that wall time would be
 *  in UTC. */
function wallMs(tz, ms) {
  const p = {};
  for (const { type, value } of format(tz).formatToParts(ms)) p[type] = +value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** UTC offset of `tz` at `ms`, in minutes. */
export function offsetMinutes(tz, ms) {
  return Math.round((wallMs(tz, Math.floor(ms / 1000) * 1000)
    - Math.floor(ms / 1000) * 1000) / MIN_MS);
}

/** The zone's smallest UTC offset in `year`, in minutes — its winter
 *  clock. Sampled mid-month at noon UTC, clear of any change night. */
export function winterOffsetMinutes(tz, year) {
  let min = Infinity;
  for (let m = 0; m < 12; m++) {
    min = Math.min(min, offsetMinutes(tz, Date.UTC(year, m, 15, 12)));
  }
  return min;
}

const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseIso = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** The instant the wall clock in `tz` reads `wall` (epoch ms of that
 *  wall time as if UTC). Where the clock skips that reading, it is read
 *  with the offset in force before the skip — the skip itself. */
function localCut(tz, wall) {
  const before = offsetMinutes(tz, wall - DAY_MS / 2);
  let t = wall - before * MIN_MS;
  const at = offsetMinutes(tz, t);
  if (at !== before) {
    // The offset changes between half a day earlier and this reading:
    // settle on the offset actually in force at the candidate instant.
    const t2 = wall - at * MIN_MS;
    if (offsetMinutes(tz, t2) === at) t = t2;
  }
  return t;
}

/** [start, end] of day `day` (ISO date) under `cut`, as epoch ms; end is
 *  the next day's start. */
export function dayWindow(day, cut, tz) {
  const dayMs = parseIso(day);
  const { hour, clock } = spec[cut];
  if (clock === "winter") {
    const year = new Date(dayMs).getUTCFullYear();
    const start = dayMs + hour * HOUR_MS
      - winterOffsetMinutes(tz, year) * MIN_MS;
    return [start, start + DAY_MS];
  }
  const wall = dayMs + hour * HOUR_MS;
  return [localCut(tz, wall), localCut(tz, wall + DAY_MS)];
}

/** The day (ISO date) the instant `ms` belongs to under `cut`. */
export function dayOf(ms, cut, tz) {
  const { hour, clock } = spec[cut];
  if (clock === "winter") {
    const year = new Date(ms).getUTCFullYear();
    return isoOf(ms + winterOffsetMinutes(tz, year) * MIN_MS
      - hour * HOUR_MS);
  }
  return isoOf(wallMs(tz, ms) - hour * HOUR_MS);
}

// ── THE SLEEP DAY'S HEAD: its time and its name ─────────────────────────────
// The one statement of how a sleep day's time and date read (user requests
// 2026-10-22 and 2026-10-26: the Noticeboard's title line, "SSOT the one
// in the noticeboard" for the atlas Diary's strip). Drawn by the
// Noticeboard and the Status Board (time), the Dashboard (date) and the
// Diary (both); the look is each host's.

const headClocks = {};
const two = (n) => String(n).padStart(2, "0");

/** HH:MM on the local clock — but once the calendar date has turned and
 *  the sleep day has not, the real time since local midnight plus 24 h
 *  (user decision 2026-10-25: "my 28 hour time don't change with the
 *  clock"): 01:37 reads 25:37. A clock-change night neither repeats nor
 *  skips: it runs to 28:59 in autumn, 26:59 in spring, then 04:00. */
export function sleepClock(ms, tz) {
  const date = dayOf(ms, DAY_CUT.CALENDAR, tz);
  if (dayOf(ms, DAY_CUT.SLEEP, tz) !== date) {
    const [midnight] = dayWindow(date, DAY_CUT.CALENDAR, tz);
    const mins = Math.floor((ms - midnight) / MIN_MS);
    return two(24 + Math.floor(mins / 60)) + ":" + two(mins % 60);
  }
  const f = headClocks[tz] || (headClocks[tz] = new Intl.DateTimeFormat(
    "en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit",
               hourCycle: "h23" }));
  const part = (k) => f.formatToParts(ms).find((p) => p.type === k).value;
  return part("hour") + ":" + part("minute");
}

/** The date's mark for the small hours where no clock says them (user
 *  decisions 2026-11-03): a timetable's "next calendar day", written as a
 *  SUPERSCRIPT right after the sleep day's date — `2026年11月2日⁺¹`. Each
 *  host draws the superscript (a <sup>, so the plus and the one are
 *  the font's own; the Unicode ⁺¹ pair renders mismatched). A head with
 *  a time shows `25:37` instead. */
export const CALENDAR_AHEAD_MARK = "+1";

/** Whether `ms` is in those hours: the calendar date has turned and the
 *  sleep day has not (00:00–04:00). */
export function calendarAhead(ms, tz) {
  return dayOf(ms, DAY_CUT.CALENDAR, tz) !== dayOf(ms, DAY_CUT.SLEEP, tz);
}

/** How far a day is from today, for the head's time slot while the strip
 *  shows another day: "+1d", "−2d" (a true minus), thousands grouped
 *  with commas as the atlas writes every count ("−3,652d", user decision
 *  2026-10-27; en-GB pinned so a device's locale never changes the
 *  mark). `starred` puts the
 *  atlas's leading `*` for projected in front — the board marks a day
 *  whose weather is incomplete so (`*+3d`). Shared by the Noticeboard and
 *  the Diary since 2026-10-27; zero is today, which shows the time. */
export function dayOffsetText(n, starred = false) {
  return (starred ? "*" : "") + (n > 0 ? "+" : "\u2212")
    + Math.abs(n).toLocaleString("en-GB") + "d";
}

/** Whole days from ISO date `from` to ISO date `to` (negative if earlier). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z")
    - Date.parse(from + "T00:00:00Z")) / DAY_MS);
}

/** A sleep day (ISO date) in full: "Thursday 22 October". */
export function sleepDayName(day) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  }).format(Date.parse(day + "T12:00:00Z"));
}

/** A sleep day (ISO date) in Chinese: "2026年10月22日 周四". Built by
 *  hand, not by Intl's zh-CN, so a device without Chinese locale data
 *  writes it the same. */
export function sleepDayNameZh(day) {
  const { zh, wd } = sleepDayParts(day);
  return `${zh} ${wd}`;
}

/** The board heads' date line, both languages (user request 2026-10-28):
 *  "Thursday 22 October 2026年10月22日 周四" — a space between, no
 *  dot (user decision 2026-10-28). */
export function sleepDayNames(day) {
  return sleepDayName(day) + " " + sleepDayNameZh(day);
}

/** That line's three parts, for a head that dresses them apart — the
 *  board's grid, a date's CALENDAR_AHEAD_MARK after each DATE but not
 *  after the weekday: { en: "Thursday 22 October", zh: "2026年10月22日",
 *  wd: "周四" }. The Noticeboard heads and the atlas Diary's head both
 *  read it (2026-11-03), so the split is said once. */
export function sleepDayParts(day) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    en: sleepDayName(day),
    zh: `${y}年${m}月${d}日`,
    wd: `周${"日一二三四五六"[dow]}`,
  };
}
