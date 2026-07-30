# Batch B, part 1 — the progress trajectory chart

Date: 2026-07-30

## Form

The data's job is **change over time**: daily totals for one exercise, against
the target it was chasing on each of those days. That job picks a line.

Sparse data is the wrinkle. Rest days and missed days mean there is no total for
many dates, and a line drawn point-to-point over an evenly spaced index would
invent a smooth history that did not happen. So **points are positioned by real
calendar date** inside a 30-day window and only exist for days actually logged.
A gap in training therefore reads as a long flat segment, which is the truth.

A stepped **target line** rides underneath, because "trajectory" is only
meaningful relative to what you were aiming at, and this app's targets move on
their own via PR bumps. It comes from `targetHistory`, so it steps where the
target actually changed.

## Colour, and what the validator changed

Ran `validate_palette.js` against the app's dark panel rather than eyeballing it.
Three results, handled differently:

- **CVD separation WARN — neon vs silver ΔE 7.8 (deutan).** This is the one that
  changed the design. The plan had been to mark target-hit days with neon and
  nothing else, which is identity by **colour alone** and unreadable for
  red-green colourblindness at that separation. Achievement now also carries
  **shape**: a hit day is a filled marker, a short day is a hollow one, and both
  sit measurably above or below the target line. Colour is reinforcement, not the
  carrier.
- **Lightness-band and chroma FAILs — out of scope, not ignored.** Those checks
  score *categorical* palettes, and this is not one: it is a single neutral
  series plus one status accent. The silver reading as near-gray (chroma 0.01) is
  the point — it is this design system's recessive rule colour, and a lone
  neutral series is correct per the skill's own guidance on text and recessive
  marks.
- **Contrast PASS** — both marks clear 3:1 against `#141917`.

Neon stays rationed to its single job in this app: marking what is achieved.
The trajectory line itself is silver, so a whole chart never spends the signal.

## Marks

Per the skill's mark specs: 2px data line, markers at r=4 (8px) carrying a 2px
ring in the surface colour so adjacent markers separate, and **no gridlines** —
which also sidesteps the dashed-gridline anti-pattern entirely.

**One deliberate deviation:** the target line is dashed. The skill flags dashing
as noise on *gridlines and axis rules*; this is a semantic reference line, and
dashed already means "target" elsewhere in this product (`.day-num.target` in
the Progress day rows). Internal consistency wins, and with no gridlines present
there is nothing for it to be confused with.

Labels are selective — the latest point and the best point only, never a number
on every dot.

## Legend, table view, interaction

- **No legend box.** One series, and the card it lives in is already titled with
  the exercise name. The target line gets a small direct label instead, so
  identity is never colour-alone.
- **The table view already exists.** The day-by-day list of totals and targets
  sits directly beneath the chart in the same card, which satisfies the
  accessibility requirement without inventing a second view.
- **No crosshair or hover tooltip**, and this is a deviation with a reason. The
  skill's default assumes a pointer; this is a 375px touch surface, and the exact
  value for every day is already listed immediately below the chart. Adding a tap
  layer would duplicate the list and add state to a card that re-renders. The
  selective direct labels carry the two numbers worth reading at a glance.

Dark mode only — this app has no light theme, by an explicit earlier decision.

## Data

Pure, derived, in `stats.js`, consistent with everything else in that file:

```js
trajectorySeries(ex, setsLog, windowDays, todayOverride)
  -> { points: [{ date, dayIndex, total, target, hit }], span, maxY }
```

- `dayIndex` is days since the window start, so the renderer maps date to x
  without knowing about dates.
- `target` is the effective target for *that* day.
- `hit` is `target > 0 && total >= target`.
- `maxY` covers the tallest total **and** the tallest target in the window, so a
  target you never reached is still visible on the scale, and is at least 1 so
  the geometry can never divide by zero.
- Days with no logged sets produce no point.

Fewer than two points is not a chart. The card shows a quiet line of text
instead, because two dots joined by a segment is not a trajectory.

## Testing

Unit tests: points only for logged days and in date order; `dayIndex` relative to
the window start; a stepped target read per day from `targetHistory`; the `hit`
flag both ways; `maxY` covering an unreached target; days older than the window
excluded; an exercise with no history returning no points and a safe `maxY`.

Browser verification at 375px with real data: the chart rendered inside a
Progress card, no horizontal overflow, markers distinguishable by shape with
colour removed, and the empty/too-short state showing text rather than a broken
axis.

## Out of scope

- Comparing exercises on one chart. One card, one exercise — the existing rule.
- Any second y-axis. Totals and targets share one scale by construction.
- Zooming or panning the window.
