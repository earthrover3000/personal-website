// The JS half of day_cut against the shared cases (cases.json) — run by
// `python -m day_cut` beside the Python half's own self_check. Prints one
// summary line; exits 1 on the first mismatch.
import { readFileSync } from "node:fs";
import { DAY_CUT, calendarAhead, dayOf, dayWindow, dayOffsetText,
         daysBetween, sleepClock,
         sleepDayName, sleepDayNameZh, sleepDayNames } from "./day-cut.js";

const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
let n = 0;
const fail = (what, c, got) => {
  console.error(`${what} ${JSON.stringify(c)}: got ${JSON.stringify(got)}`);
  process.exit(1);
};
for (const c of cases.window) {
  if (!Object.values(DAY_CUT).includes(c.cut)) fail("unknown cut", c, c.cut);
  const got = dayWindow(c.day, c.cut, c.tz).map(iso);
  if (got[0] !== c.start || got[1] !== c.end) fail("dayWindow", c, got);
  n++;
}
for (const c of cases.day_of) {
  const got = dayOf(Date.parse(c.at), c.cut, c.tz);
  if (got !== c.day) fail("dayOf", c, got);
  n++;
}
// The sleep day's head (JS only: no Python half draws it). Dublin's
// autumn change, 25 October 2026: 01:37 IST, the hour repeated, 04:00.
for (const [at, want] of [
  ["2026-10-24T09:05:00Z", "10:05"], ["2026-10-25T00:37:00Z", "25:37"],
  ["2026-10-25T01:37:00Z", "26:37"], ["2026-10-25T02:59:00Z", "27:59"],
  ["2026-10-25T03:59:00Z", "28:59"], ["2026-10-25T04:00:00Z", "04:00"],
]) {
  const got = sleepClock(Date.parse(at), "Europe/Dublin");
  if (got !== want) fail("sleepClock", { at, want }, got);
  n++;
}
if (sleepDayName("2026-10-22") !== "Thursday 22 October") {
  fail("sleepDayName", { day: "2026-10-22" }, sleepDayName("2026-10-22"));
}
n++;
for (const [day, want] of [["2026-10-22", "2026年10月22日 周四"],
                           ["2026-10-25", "2026年10月25日 周日"],
                           ["2027-01-02", "2027年1月2日 周六"]]) {
  if (sleepDayNameZh(day) !== want) fail("sleepDayNameZh", { day, want },
                                         sleepDayNameZh(day));
  n++;
}
if (sleepDayNames("2026-10-28")
    !== "Wednesday 28 October 2026年10月28日 周三") {
  fail("sleepDayNames", { day: "2026-10-28" }, sleepDayNames("2026-10-28"));
}
n++;
for (const [args, want] of [
  [[1], "+1d"], [[-2], "\u22122d"], [[3, true], "*+3d"],
  [[-3652], "\u22123,652d"], [[12345], "+12,345d"],
]) {
  const got = dayOffsetText(...args);
  if (got !== want) fail("dayOffsetText", { args, want }, got);
  n++;
}
for (const [from, to, want] of [
  ["2026-10-27", "2026-10-26", -1], ["2026-10-27", "2026-11-03", 7],
  ["2026-03-28", "2026-03-30", 2], ["2016-10-27", "2026-10-27", 3652],
]) {
  const got = daysBetween(from, to);
  if (got !== want) fail("daysBetween", { from, to, want }, got);
  n++;
}
for (const [at, want] of [
  ["2026-11-02T23:59:00Z", false], ["2026-11-03T00:00:00Z", true],
  ["2026-11-03T03:59:00Z", true], ["2026-11-03T04:00:00Z", false],
]) {
  const got = calendarAhead(Date.parse(at), "Europe/Dublin");
  if (got !== want) fail("calendarAhead", { at, want }, got);
  n++;
}
console.log(`${n} cases (js)`);
