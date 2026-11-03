// Type declarations for day-cut.js — the browser half of 引擎 Engines/
// day_cut: where one day ends and the next begins.

export declare const DAY_CUT: {
  /** Midnight, local clock — a calendar date. */
  readonly CALENDAR: "calendar";
  /** 04:00 on the local clock, every season — a day divided by sleep;
   *  23 or 25 hours on a clock-change day. */
  readonly SLEEP: "sleep";
};
export type DayCut = (typeof DAY_CUT)[keyof typeof DAY_CUT];

/** spec.json — the hours both halves read. */
export declare const DAY_CUT_SPEC: Record<DayCut, { hour: number; clock: "local" | "winter" }>;

/** UTC offset of an IANA zone at an instant, in minutes. */
export declare function offsetMinutes(tz: string, ms: number): number;

/** The zone's smallest UTC offset in `year`, in minutes — its winter clock. */
export declare function winterOffsetMinutes(tz: string, year: number): number;

/** [start, end] epoch ms of ISO day `day` under `cut`; end is the next
 *  day's start. */
export declare function dayWindow(day: string, cut: DayCut, tz: string): [number, number];

/** The ISO day an instant (epoch ms) belongs to under `cut`. */
export declare function dayOf(ms: number, cut: DayCut, tz: string): string;
/** HH:MM, counting on past 24 until the sleep day ends (01:37 → 25:37). */
export declare function sleepClock(ms: number, tz: string): string;
/** "+1" — drawn as a superscript right after a clockless sleep-day date
 *  while `calendarAhead`. */
export declare const CALENDAR_AHEAD_MARK: string;
/** The calendar date has turned and the sleep day has not (00:00–04:00). */
export declare function calendarAhead(ms: number, tz: string): boolean;
/** "+1d" / "−3,652d" (true minus, comma thousands), `*` when starred. */
export declare function dayOffsetText(n: number, starred?: boolean): string;
/** Whole days from ISO date `from` to `to` (negative if earlier). */
export declare function daysBetween(from: string, to: string): number;
/** A sleep day (ISO date) in full: "Thursday 22 October". */
export declare function sleepDayName(day: string): string;
/** The same day in Chinese: "2026年10月22日 周四". */
export declare function sleepDayNameZh(day: string): string;
/** Both: "Thursday 22 October 2026年10月22日 周四". */
export declare function sleepDayNames(day: string): string;
