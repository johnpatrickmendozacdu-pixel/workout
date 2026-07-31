# BMI readout, category and weight trend

Date: 2026-07-31

## Problem

The profile already collects weight (kg) and height (cm) and does nothing with them. The
user wants BMI derived from those two numbers, the category it falls in, a nudge toward
the healthy range when it does not, and — once weight changes over time — a way to see
how much has been lost or gained.

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

## Domain functions (pure, in `src/domain/domain.js`)

```js
bmiSummary(profile)
// → null when weight or height is missing or non-positive
// → { bmi, category, healthyMin, healthyMax, toHealthy }

weightTrend(weightLog)
// → null when fewer than 2 entries
// → { delta, since }   // delta kg vs the first entry, negative = lost
```

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

## UI — Profile sheet only

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

Nothing renders on Today, on Progress, or at launch.

## Testing

Unit tests in `tests/domain.test.js` for the pure layer:

- `bmiSummary`: a known value (80 kg / 180 cm → 24.7, `normal`); each category boundary
  from both sides (18.5, 25, 30); `toHealthy` above, below and inside the range;
  null for missing weight, missing height, zero height, negative values.
- `weightTrend`: null for zero and one entry; loss and gain deltas; unsorted input.
- `mergeProfiles`: union of two disjoint logs; same-date conflict resolves to the winner;
  a log present on one side only survives; neither side loses entries.

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
