# Batch A — records wait for the day to close, and two pieces of housekeeping

Date: 2026-07-30

First of four batches decomposed from a seven-item request. The other three are
recorded under Roadmap so their settled decisions are not lost.

## Why these three together

They share a property: none of them touches stored data, and none can lose a
workout. That is the whole reason they go first — the fourth batch (sync) is the
only change in the set that can destroy real data, so it lands last, into a
codebase that is otherwise settled.

## 1. Records wait for the day to close

**Problem.** Top Set already auto-computes the biggest single set
(`stats.js`), but it counts sets the moment they are logged. Mid-workout it
climbs with every set, so a number that is supposed to mean "your best ever" is
provisional all the way through a session. Best day (`maxReps`) has the same
flaw: it can claim a record for a day you have not finished.

**Rule.** A date that is *today* and not yet sealed for that exercise is
excluded from **Top Set** and **Best day**. Everything else — lifetime reps,
total sets, current and best streak, the day's own total — keeps counting today
live.

The principle: **records wait for the day to close; counters do not.** This is
not a new idea in the codebase, it is an existing one applied consistently —
`completedTimes` already admits only `completed` sessions, so Best time has
always waited for the day to close. After this change Top Set, Best day and Best
time all agree.

**"Sealed" is the existing definition**, `workoutSealed(timer, total, target)`
from `domain.js`: the target was met, or the session was deliberately closed
with Take the win or Log what I did. Consequences that follow from reusing it
rather than inventing a second notion of "done":

- Hit your target and the day seals itself, so records update as soon as you
  finish — no extra tap.
- Choose Keep going and the day stays open, so records stay provisional while
  you push past the target. Correct: you are still working.
- A **targetless** exercise has no target to meet, so its "done" is closing the
  session. If you never close it, today's sets land in the records tomorrow,
  when today stops being today. Acceptable and predictable; the alternative is a
  second, weaker definition of done.
- Correcting a total downward unseals the day (already true) and the records
  become provisional again, which is right — the day reopened.

**Implementation.** `exerciseStats` computes `today` from its existing
`todayOverride` parameter, and skips the topSet/maxReps comparison for that
date when `workoutSealed(...)` is false. `stats.js` already imports `getTimer`
and `getEffectiveTarget` from `domain.js`; this adds `workoutSealed`. No new
module, no stored field, nothing derived twice.

## 2. Delete the quick-add field

**It already does nothing.** The Plan form writes `ex.chips`, and the logger
assigns it (`const chips = ...`) and never reads it — the pad renders a fixed
16-number `REP_PAD`. The field's hint, "These become the +/− quick buttons when
logging a set", is false today.

So this is not a feature being removed, it is dead code and a lie being
deleted: the form field and its three inputs, the chip parsing in the save
handler, `chips` on `addExercise`/`updateExercise`, `DEFAULT_CHIPS`, and the
unused assignment in the logger.

Existing `ex.chips` values stay in storage untouched. Nothing reads them and
nothing writes them any more, so a migration would be churn for no gain.

## 3. Move the mark off the greeting

The mark is currently inline in the same element as the greeting
(`<div class="app-title">MARK + "Hey, Johnny"</div>`) and only on Today. Sitting
inside the text flow of a greeting makes it read as decoration on a personal
message rather than as the app's identity.

It moves to its own slot at the far left of the topbar row, vertically centred
against the title block, on **all three screens** — an identity anchor that
does not move as you navigate. It stays non-interactive (`aria-hidden`), so it
cannot be mistaken for a control or absorb a mis-tap.

The Today bar already carries a streak pill plus three chips. If the mark's
slot crowds the row at 375px, the mark wins and the streak pill yields — the
measurement decides, not the guess.

## Testing

- Unit tests in `tests/stats.test.js` for the records rule: today's larger set
  excluded from Top Set while unsealed and admitted once sealed; the same for
  Best day; lifetime reps and total sets unaffected by sealing; past days
  unaffected; a targetless exercise admitted only once its session is closed.
- The full suite (123 tests before this batch) must stay green.
- Manual verification at 375px with a real render: the topbar on all three
  screens with no horizontal overflow, the Plan form with the field gone and
  saving correctly, and Top Set holding steady mid-session then updating the
  moment the day seals — exercised **without reloading between checks**.

## Roadmap — decided, not yet specified

- **Batch B:** progress trajectory chart (inline SVG, no libraries, via the
  dataviz skill); profile picture upload (canvas-downscaled square as a data
  URL — must stay small, since it rides in the sync snapshot).
- **Batch C:** EMOM timer mode, selectable per exercise in Plan and switchable
  afterwards, work/rest configurable and defaulting to 60s/60s, running
  alongside the normal clock. Phase change signalled by a **Web Audio generated
  beep** — no audio files, no network, no permissions, nothing to maintain. Not
  vibration: iOS Safari ignores `navigator.vibrate` even in an installed PWA.
  The interval maths is pure and testable: given a start time, now, work and
  rest lengths, return phase, round index and seconds left.
- **Batch D:** sync hardening, and it carries the one genuine bug in the
  request. Sync is whole-file last-write-wins on `meta.updatedAt`, so work done
  offline is silently overwritten by any later push from another copy; and a
  push that fails offline is never retried, because nothing listens for
  `online`. Needs a pure, exhaustively tested merge plus a retry queue.
  **The Drive round-trip cannot be verified without the user's Google login** —
  that limitation is unchanged and must be stated plainly, not implied away.

## Out of scope

- Migrating away stored `ex.chips`.
- Any change to what sealing means. Batch A consumes the existing definition.
- Making the mark tappable.
