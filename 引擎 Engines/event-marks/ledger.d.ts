// Type declarations for event-marks/ledger.js — a cumulative series read off
// at period ends (the site-stats chart's Table view). A consumer bundling
// with TypeScript maps `event-marks/ledger` to this file the way the atlas
// maps `event-marks` to marks.d.ts.

import type { BlockContext, BlockMarkMs, MonthMarkMs, PhaseInput, PhaseMarkMs, WeekMarkMs } from "./marks.js";

export type PeriodUnit = "blocks" | "phases" | "months" | "weeks";

/** What each unit needs beyond the range: blocks take a BlockContext,
 *  phases their dated boundaries; months and weeks need nothing. */
export type PeriodContext = {
  blockCtx?: BlockContext;
  phases?: readonly PhaseInput[];
};

/** A mark from marks.js with the unit it came from stamped on. */
export type Period =
  | ({ unit: "months" } & MonthMarkMs)
  | ({ unit: "weeks" } & WeekMarkMs)
  | ({ unit: "blocks" } & BlockMarkMs)
  | ({ unit: "phases" } & PhaseMarkMs);

/** One snapshot of the running totals. `words` is null where the snapshot
 *  predates word tracking. Ascending by `ms` when passed to ledgerRows. */
export type LedgerPoint = { ms: number; total: number; words: number | null };

export type LedgerValues = { total: number | null; words: number | null };

export type LedgerRow<P extends { startMs: number; endMs: number } = Period> = {
  period: P;
  /** The period has not ended yet (endMs >= nowMs). */
  open: boolean;
  /** Where the closing values are read: endMs, or nowMs while open. */
  closeMs: number;
  /** Newest snapshot before startMs; null fields before the first snapshot. */
  opening: LedgerValues;
  /** Newest snapshot before closeMs; null fields before the first snapshot. */
  closing: LedgerValues;
  /** closing − opening per series; null where either side is null. */
  movement: LedgerValues;
  /** Snapshots falling in [startMs, endMs). Days, not builds, on a
   *  day-collapsed series. */
  snapshots: number;
};

/** Every period of `unit` overlapping [startMs, endMs], overlap-filtered.
 *  [] for an unknown unit or a unit whose context is missing. */
export declare function periodsFor(
  unit: PeriodUnit | string,
  startMs: number,
  endMs: number,
  ctx?: PeriodContext,
): Period[];

/** One row per period: the step-function value of each series at the
 *  period's close, its value at the open, and the difference. */
export declare function ledgerRows<P extends { startMs: number; endMs: number }>(
  points: readonly LedgerPoint[],
  periods: readonly P[],
  nowMs: number,
): LedgerRow<P>[];
