# Schedule history, equipment, and combo grouping

Date: 2026-08-02

Six connected changes. They edit the same two core files (`domain.js`, `stats.js`,
`main.js`) and depend on each other, so they ship as a sequenced relay — one built,
verified in a real browser at 375px, and deployed before the next begins. Order:
**A → C → B → D → F → E**.

## Constraints

- 100% free, offline-first, no new runtime dependencies.
- Data shapes keep round-tripping through Drive sync and JSON backup/restore.
- Night-brutalist language, `--radius-*: 0`, existing tokens only. Zero clutter.
- Guide/hint notes for every new surface, via the existing `.hint` / `tipHtml` /
  `modalGuide` mechanisms — no fourth mechanism.
- **Boundaries, tested as invariants:**
  - Changing an exercise's days never changes its streak or history.
  - Changing target reps (or weight) never changes streak, history, or top set.

---

## A — Schedule change must never rewrite history (the data-loss fix)

**Root cause.** `calcDayStats` (`domain.js:143`) does `if (!isScheduledOn(ex, dateStr))
continue`, and `isScheduledOn` reads the exercise's *current* `schedule` for every past
date. Change the schedule and every past day is re-judged under the new one: days you
trained but that fall outside the new schedule stop counting and vanish from the strip.
`setsLog` is untouched — the reps are safe — but the streak and strip recompute as if
they never happened.

**Fix, two parts:**

1. **A logged day always counts.** In `calcDayStats`, include an exercise on a day when
   it is scheduled **or** has logged reps that day. A day you trained is immutable
   history and can never be schedule-filtered out. This is what recovers already-damaged
   data the instant it ships — the reps reappear on their own.

   ```js
   const arr = (setsLog[dateStr] && setsLog[dateStr][ex.id]) || [];
   const trained = arr.length > 0;
   if (!isScheduledOn(ex, dateStr) && !trained) continue; // rest day, nothing due
   ```

2. **Past schedules freeze.** Add `scheduleHistory: [{ effectiveDate, schedule }]`,
   mirroring `targetHistory`. `isScheduledOn(exercise, dateStr)` uses the schedule in
   effect on `dateStr`; with no history it falls back to `exercise.schedule` exactly as
   today. Editing the schedule appends `{ effectiveDate: today, schedule }` — it never
   rewrites the past, so empty scheduled days keep the schedule they had.

   `scheduleEffectiveOn(exercise, dateStr)` is the picker, identical in shape to the
   `targetHistory` loop in `getEffectiveTarget`.

**Migration.** On load, any exercise without `scheduleHistory` gets
`[{ effectiveDate: createdDate || today, schedule: <current schedule or 'daily'> }]`.
This preserves each exercise's *current* computation exactly, so no correct user's
streak shifts on upgrade; part 1 is what heals the damaged data.

**Boundary test:** a fixed setsLog + a schedule change yields byte-identical
`calcStreakInfo` for every logged day.

---

## C — Target/weight edits stay local to the plan

Targets already record history (`targetHistory`), so an edited target only affects days
from its effective date on, and top set never reads target at all. This is mostly already
true; C is the guard rail:

- Verify the target editor appends to `targetHistory` rather than overwriting.
- Add tests proving a target change leaves `topSet`, `totalReps`, and past `calcDayStats`
  untouched.

Weight (from B) is display-only metadata: it is never an input to any stat.

---

## B — Bodyweight vs dumbbell, with kg/lb

**Data (per exercise):** `equipment: 'bodyweight' | 'dumbbell'` (default `'bodyweight'`),
`weight: number | null`, `weightUnit: 'kg' | 'lb'` (default `'kg'`). Pure metadata — no
stat consumes it.

**Editor (add/edit exercise sheet):** a two-option segmented control
`Bodyweight | Dumbbell`. Choosing Dumbbell reveals a number input and a `kg / lb` toggle.
Switching the unit **converts** the shown number (kg↔lb, 1 kg = 2.20462 lb, one decimal)
so the same physical weight is preserved, not relabelled.

**Display:** dumbbell exercises show a quiet `· 12 kg` after the name on the Plan row and
the Progress card. Bodyweight shows nothing extra.

**Domain:** `convertWeight(value, from, to)`, `formatWeight(value, unit)` in `domain.js`,
both pure and tested.

**Hint:** under the control — "Weight is a label for this exercise. It never changes your
reps, targets or streak."

---

## D — Plans grouped by schedule

Exercises whose **effective schedule today** is identical collapse under one heading
(`Mon Thu`, `Every day`, `Weekends`, …), reusing `scheduleLabel`. Within a group, the
existing plan rows render unchanged. Change an exercise's days and it moves to the
matching group on the next render — groups are derived each render, never stored, so
"auto-move" is free.

- `groupBySchedule(exercises, dateStr)` in `stats.js` → `[{ key, label, days, exercises }]`,
  ordered by earliest weekday then group size. Pure, tested.
- Empty groups never render. A single ungrouped exercise still shows under its own label —
  no "Other" bucket.
- Guide (Plan): "Exercises on the same days are grouped. Change an exercise's days and it
  moves to its new group."

---

## F — Progress grouped the same way

Progress reuses `groupBySchedule`. Each group is a collapsible section header with its
exercise cards beneath, same order as Plan. The Weekly-weight health-habit block stays
above all groups, untouched. Change a schedule and the card moves groups next render.

---

## E — Combo time per group

For each schedule group, aggregate the per-exercise session times into a combo:

- A **combo day** is a date on which every currently-scheduled exercise in the group had a
  closed session (completed or gave up). Its time is the sum of those sessions.
- **Total time** = sum of all combo-day times (mirrors the single-exercise Total time,
  same `formatTotalDuration`).
- **Average** = mean combo-day time; **Best** = fastest combo-day, both `formatDuration`.
- `comboTimes(groupExercises, timersLog, setsLog, dateStr)` in `stats.js`, pure, tested.
  A group of one degenerates to that exercise's own totals — correct, so no special case.

**Display:** one compact line on the group header in Progress —
`Combo · total 8h 30m · avg 2h05 · best 1h50`. Omitted when the group has no complete
combo day yet.

- Guide (Progress): "Combo time is how long a whole day's group takes together — total
  across all days, plus your average and best."

---

## Not building

- No per-set weight logging or weight history/trend (weight is a current label only).
- No cross-group combos or custom groupings — groups are exactly "same days".
- No reordering of groups by hand.
