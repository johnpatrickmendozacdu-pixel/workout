# Daily weigh-in, one-time workouts, weight progression, and Today tidy

Date: 2026-08-03

Four changes, shipped as a sequenced relay (build → verify in a real browser at 375px →
deploy) in order **A → B → D → C**. A is trivial and de-risks Today first; C (a new stored
type) ships last.

## Constraints

- 100% free, offline-first, no new runtime dependencies.
- Data shapes keep round-tripping through Drive sync and JSON backup/restore.
- Night-brutalist language, `--radius-*: 0`, existing tokens only. Zero clutter.
- Guide/hint notes for every new surface, via the existing `.hint` / `tipHtml` /
  `modalGuide` mechanisms.
- **Boundaries (tested):** weight and one-time entries never touch any exercise's streak,
  reps, top set, best day, or a running session.

---

## A — Today shows only what's scheduled today

`viewToday` currently renders a "Not scheduled" section listing every exercise not due
today. Remove it: an exercise appears on Today only when it is scheduled for today, or has
already been logged today (the existing `done` path keeps a bonus workout visible). The
`resting` computation and its section go; the break-nudge for scheduled exercises stays.

Guide (Today) updates: drop any reference to the not-scheduled list.

---

## B — Weigh-in becomes daily, with a weekly-average chart

**Model change.** Weighing in is now a daily habit, not weekly. The chosen `weighInDay`
and the whole hit/miss-per-week idea are retired.

**Today card.** Appears every day until today has a weight logged; tapping opens the same
single-weight sheet. Copy: "Daily weigh-in — logs today's weight." Hidden once today is
logged. No lock, no day countdown.

**Progress block.** The weeks strip is replaced by a line chart of **weekly average
weight**, one point per week from the first entry, reusing the trajectory chart's SVG
style (axis labels, dot, line). Beneath it: current weight, this week's average so far,
and the overall change since the first week. This week's point is drawn but marked
provisional until Saturday closes it.

**Domain.** `weeklyAverages(weightLog, today)` in `domain.js`, pure:
returns `[{ weekStart, weekEnd, avg, count, isCurrent }]`, oldest first, weeks anchored to
the first entry (7-day buckets — same bucketing the old `weighInWeeks` used, so the code
is reused not reinvented). `avg` is the mean of that week's logged weights, one decimal.
Weeks with no entry are omitted (a gap, not a zero). Tested.

`recordWeight` already replaces same-day entries, so a second weigh-in the same day
corrects rather than doubles — daily logging needs no change there.

**Retire.** `weighInWeeks` and its uses, the `weighInDay` picker in the profile sheet, and
the day-based card logic. `weighInDay` stays on stored profiles for back-compat but is
unused. Its tests are replaced by `weeklyAverages` tests.

Guide/hints updated to describe daily logging and the weekly-average trend.

---

## D — Dumbbell weight on cards, with progression

**On the Today card.** Dumbbell exercises show the same quiet weight tag already used on
Plan and Progress (`weightTag`). Bodyweight shows nothing.

**Weight history.** Add `weightHistory: [{ effectiveDate, weight, unit }]` to exercises,
appended (never overwritten) when the weight changes — mirroring `applyTargetChange` /
`applyScheduleChange`. Unlike those, weight is display-only and feeds no past-day
computation, so history exists purely to show progression.

`applyWeightChange(ex, weight, unit)` appends a dated entry when the value changes.
Migration seeds `weightHistory` from the current `weight`/`weightUnit` for existing
dumbbell exercises (bodyweight exercises get none until they gain a weight).

**Progression display (Progress card).** `weightProgression(ex)` in `domain.js` →
`null | { start, current, unit, changed }`. The card shows one quiet line:
`Weight 12 → 14 kg` when it has changed, `Weight 14 kg` when it never has, nothing when
there is no weight. No timeline, no chart (YAGNI).

**Boundary.** Weight is not an input to any stat. Changing it reflects on the cards and
never kills a streak or a running session. Tested: a weight change leaves
`exerciseStats` byte-identical.

Guide/hint note on the equipment control already covers "a label, never changes reps".

---

## C — One-time workouts

**Purpose.** Log something done once — a random workout — that is not scheduled, not
planned, and carries none of the exercise metrics.

**Data.** `state.oneTimeLog: [{ id, date, name, minutes }]`, persisted under
`one-time-log`, merged in sync as a **union by id** (same shape as the weight-log merge).
Never enters `exercises` or `setsLog`.

**Creation.** The Add-exercise sheet gains a type toggle at the top: **Scheduled |
One-time**. Scheduled is the existing form unchanged. One-time collapses the form to two
fields — **Name** and **Minutes** — plus Save. Saving appends a dated entry for today and
closes the sheet; it does not create a plan row. Editing an existing exercise never shows
the toggle (you cannot convert a plan into a one-time or back).

**Progress.** A collapsible **"One time"** group (using the same `groupHeaderHtml`
mechanism as schedule groups), listed after the schedule groups. Each entry is one row:
`name · Nm · date`, newest first, with a small delete control. Collapsed summary shows the
count. No streak, target, top set, chart, or combo — deliberately spartan.

**Not on Today.** One-time entries are a log of the past, not a plan for today, so they do
not appear on Today. (They are logged from the Add sheet, reachable from Plan.)

Guide (Plan): "One-time logs a workout you just did — name and minutes, nothing else. Find
them in Progress under One time."

Tests: `oneTimeLog` merge is a union by id; a one-time entry never appears in any
exercise stat.

---

## Not building

- No per-day weight chart (only weekly averages) and no weight timeline list.
- No editing of a past one-time entry (delete and re-add); no one-time on Today.
- No converting between scheduled and one-time.
- `weighInDay` is not removed from stored data, only from the UI and logic.
