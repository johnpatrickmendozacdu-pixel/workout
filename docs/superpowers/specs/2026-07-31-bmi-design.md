# BMI, and weekly weigh-in as a health habit

Date: 2026-07-31

## Problem

The profile already collects weight (kg) and height (cm) and does nothing with them. The
user wants BMI derived from those two numbers, the category it falls in, a nudge toward
the healthy range when it does not, and — once weight changes over time — a way to see
how much has been lost or gained.

They also want weighing in to become a tracked **health habit**: a weekly prompt on a day
they choose (Saturday by default), a visible mark when a week is missed, and its own place
on Progress. Health habits are a distinct concept from exercises and must never be
confused with them — a weigh-in is not a set, and missing one cannot break a workout
streak.

Nothing in the app stores weight history today. `profile.weight` is a single current
value that a form overwrites.

## Constraints

- 100% free: no backend, no paid service, no new runtime dependencies.
- 100% functional offline; BMI must never depend on the network.
- Existing data shapes must keep round-tripping through Drive sync and JSON backup/restore.
- The app never nags. This feature appears in the Profile sheet only — nothing on Today,
  nothing on launch.
- Visual language is the app's own: night brutalist, hard edges, near-black surfaces,
  acid-green accent. No imported style from elsewhere.

---

## What is derived vs stored

**Derived, never stored:** BMI, its category, the healthy weight range, and the distance
to that range. All are pure functions of `profile.weight` and `profile.height`, so saving
a new weight updates every one of them for free. This follows the same rule as daily
totals, streaks and EMOM state.

**Stored, minimally:** `profile.weightLog` — an append-only list of
`{ d: 'YYYY-MM-DD', w: <kg> }`. One entry per weight *change*, not per save. Without it
the app cannot answer "how much have I lost", which the user explicitly asked for. It is
the smallest thing that answers that question: no chart data, no daily samples, no
separate store.

**Also stored:** `profile.weighInDay` — 0 (Sunday) to 6 (Saturday), defaulting to **6**.
A single integer, because the user wants to pick their own weigh-in day.

**Not stored: the habit's hit/miss history.** Every week's status is derived from the
dates already in `weightLog`. There is no habit log, no per-week record, nothing to sync
or merge beyond what the weight list already carries. This is the whole reason the feature
is cheap.

## Domain functions (pure, in `src/domain/domain.js`)

```js
bmiSummary(profile)
// → null when weight or height is missing or non-positive
// → { bmi, category, healthyMin, healthyMax, toHealthy }

weightTrend(weightLog)
// → null when fewer than 2 entries
// → { delta, since }   // delta kg vs the first entry, negative = lost

weighInWeeks(weightLog, weighInDay, today)
// → [] when the log is empty
// → [{ ends: 'YYYY-MM-DD', status: 'hit' | 'missed' | 'pending' }, ...] oldest first
```

### How a week is judged

A week **ends** on `weighInDay` and covers the seven days up to and including it.

| Status | Rule |
|---|---|
| `hit` | at least one `weightLog` entry dated inside that week |
| `missed` | no entry, and the week's end day is in the past |
| `pending` | the current week, whose end day has not arrived |

History begins at the week containing the **first** `weightLog` entry, so weeks before the
user started are never shown as missed. A person who has never logged a weight has no
history and no misses — only the prompt.

Changing `weighInDay` re-derives every past week under the new anchor, so old weeks can
flip between hit and missed. This is a deliberate consequence of storing nothing: the
alternative is recording the anchor per week, which is more state for a cosmetic gain.
A `.hint` under the day picker says so plainly.

`bmi = w / (h/100)^2`, rounded to one decimal.

Categories use the WHO cutoffs, evaluated on the **unrounded** BMI so a value does not
display as one band while being classified as another:

| Category | BMI |
|---|---|
| `underweight` | < 18.5 |
| `normal` | 18.5 – 24.9 |
| `overweight` | 25 – 29.9 |
| `obese` | ≥ 30 |

`healthyMin` / `healthyMax` are `18.5 × h²` and `24.9 × h²`, rounded to one decimal.
`toHealthy` is the kg distance to the nearest edge of that range, `0` when already inside
it. This is the "starting trajectory" — a concrete target derived from height alone, with
no history required.

### Guards

Return `null` rather than a number for: missing weight, missing height, zero or negative
values, and non-finite results. A height of 0 must not produce `Infinity` on screen.

## Recording a weight change

In `saveProfile`, after the new weight is parsed and validated: if `weight` is non-null
and differs from the last entry in `weightLog`, append `{ d: today, w: weight }`. Same day
plus a changed weight replaces that day's entry rather than adding a second one, so
correcting a typo does not create a fake data point.

`saveProfile` must continue to spread the existing profile rather than rebuilding it from
form fields — the bug that once destroyed the avatar. `weightLog` is exactly the kind of
field that mistake would delete.

## Sync merge

`mergeProfiles` currently does `{ ...loser, ...winner }` plus per-field picks. An array
arriving through that spread is replaced wholesale, so two phones each logging a weight
would lose one device's entries. This is the same shape as the avatar-deletion bug and is
not optional to fix.

`weightLog` merges as a **union keyed by date**, sorted by date ascending. When both sides
have an entry for the same date, the winning snapshot's value is kept.

## Health habits are not exercises

This is a hard boundary, enforced in the domain layer and covered by tests:

- A weigh-in never appears in `setsLog`, never counts as a logged set, and never
  contributes to daily totals, Max, Top Set, lifetime reps or records.
- A missed weigh-in never breaks, shortens or touches the exercise streak.
- The weigh-in card never renders with exercise chrome: no rep ring, no progress bar, no
  target, no "to go" figure, no Give up / Keep going.
- It is labelled `HEALTH HABIT` wherever it appears, and on Today it sits **below** the
  exercise list.

## UI — Today

On the chosen weigh-in day, when that week has no entry yet, one card below the exercises:

```
HEALTH HABIT
Weekly weigh-in                     [ Log weight ]
```

Tapping opens a single weight field. Saving writes `profile.weight`, appends to
`weightLog`, and updates BMI everywhere at once. The card shows on the weigh-in day only —
a card sitting there all week is clutter — but a weight logged on any day still counts as
that week's hit.

## UI — Progress

Its own block, visually separated from the exercise sections:

```
WEEKLY WEIGHT TRACKING                      health habit

●  ●  ●  ✕  ●  ●  ●  ●  ○   →  (scrolls)

Current  82.4 kg · BMI 26.0 · Overweight
About 3.5 kg to the healthy range.
↓ 3.2 kg since 12 Jun
```

Green `●` = weighed in, red `✕` = missed, hollow `○` = this week pending. Every week since
the first entry is shown; the strip scrolls horizontally inside its own
`overflow-x:auto` container rather than being capped at a fixed number of weeks. The page
body must still never scroll sideways — the scroll belongs to the strip alone.

## UI — Profile sheet

Directly beneath the existing weight/height row, inside the same `.field` rhythm:

```
BMI 27.4   [OVERWEIGHT]
Healthy range at 178 cm: 58.6 – 78.9 kg
About 8.0 kg to the healthy range.
↓ 3.2 kg since 12 Jun
Weight alone can't tell muscle from fat.
```

- The number is the hero: large, tabular figures, acid-green when `normal`, amber when
  `overweight` or `underweight`, red when `obese`. Colours come from existing tokens.
- The category badge reuses the app's existing chip styling.
- The "to the healthy range" line appears only when `toHealthy > 0`.
- The trend line appears only when `weightTrend` returns a value, i.e. from the second
  distinct weight onward. Down arrow for loss, up for gain, neutral dim text either way —
  it reports, it does not congratulate or scold.
- The muscle caveat is one dim line, always shown when BMI is shown. BMI cannot distinguish
  muscle from fat, and in an app whose whole purpose is building muscle the number will
  eventually mislead without it.
- When weight or height is missing, the whole block is absent. No empty state, no prompt.

A weekday picker for `weighInDay` sits beside it, defaulting to Saturday.

## Notes — the app explains itself

The app has three note mechanisms and this feature uses each where it fits, rather than
inventing a fourth:

| Mechanism | Where | Text |
|---|---|---|
| `.hint` | under the weigh-in day picker | "Pick the day you usually weigh in. Changing it recalculates past weeks." |
| `.hint` | under the BMI block | "Weight alone can't tell muscle from fat." |
| `tipHtml` | first time the weigh-in card appears on Today | "Health habits are tracked apart from exercises — missing one never breaks your streak." Retires once a weight is logged. |
| Guide — Today | `['Weekly weigh-in', 'A health habit, not an exercise. Logging it never counts as reps.']` | conditional on the card being visible |
| Guide — Progress | `['Weight tracking', 'Green = weighed in, red = missed that week, hollow = this week.']` | conditional on any history existing |

## Testing

Unit tests in `tests/domain.test.js` for the pure layer:

- `bmiSummary`: a known value (80 kg / 180 cm → 24.7, `normal`); each category boundary
  from both sides (18.5, 25, 30); `toHealthy` above, below and inside the range;
  null for missing weight, missing height, zero height, negative values.
- `weightTrend`: null for zero and one entry; loss and gain deltas; unsorted input.
- `weighInWeeks`: empty log → no weeks; a hit in the current week → `pending` never
  becomes `missed`; a gap of several weeks → each one `missed`; an entry on the last day
  of a week counts for that week; changing `weighInDay` re-anchors the weeks; no week is
  reported before the first entry.
- `mergeProfiles`: union of two disjoint logs; same-date conflict resolves to the winner;
  a log present on one side only survives; neither side loses entries; `weighInDay`
  survives a merge.
- **The boundary**: logging a weigh-in leaves `setsLog`, daily totals and the exercise
  streak byte-identical. A missed week does not change `calcStreakInfo`.

The UI layer is verified by using the app, not by calling handlers: open the Profile
sheet at 375px, confirm the block appears and the figures are right, change the weight
and confirm BMI and the trend update without a reload, clear the weight and confirm the
block disappears.

## Explicitly not building

- No BMI history chart. The trajectory chart is exercise-shaped
  (`trajectorySeries(ex, setsLog)`) and generalising it is not warranted for a line of
  text. Revisit when there are months of entries worth plotting.
- No goal weight, no target date, no reminders to weigh in.
- No body-fat percentage, waist ratio or any second metric.
- No unit switching (lb / ft-in). The form is already kg and cm.
