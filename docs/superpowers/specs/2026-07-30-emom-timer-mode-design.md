# Batch C — EMOM timer mode

Date: 2026-07-30

## What it is

A second way to run a workout: every minute on the minute. A minute of work, a
minute of rest, on repeat, while you log reps as usual and the normal clock keeps
running alongside. Chosen per exercise in Plan, changeable afterwards, work and
rest lengths configurable and defaulting to 60s each.

## The load-bearing decision: EMOM stores nothing

EMOM is a **pure function of the workout clock's elapsed time**, not a second
timer with its own start stamp.

```js
emomPhase(elapsedMs, workSec, restSec) -> { phase, round, secondsLeft, cycleSec }
```

`elapsedMs` already excludes paused time (`timerElapsedMs`). So every behaviour
the clock has been taught, EMOM inherits without a line of new logic:

- Pause for the bathroom and the cycle freezes with the clock. This is the
  original reason the pause button exists, and it would have been the first thing
  to break under a separate EMOM start timestamp.
- Reset puts the cycle back to round 1.
- Give up or take the win and the cycle stops with the session.
- Nothing new is written to storage, so there is no migration, no addition to the
  sync snapshot, and no chance of the cycle drifting out of step with the clock
  it is supposed to follow.

This is the same principle the stats layer already runs on: derive it, don't
store it.

## Model

An exercise gains three optional fields:

- `timerMode` — `'normal'` (default) or `'emom'`. Absent means normal, so
  existing exercises need no migration.
- `emomWorkSec`, `emomRestSec` — default 60 and 60.

The phase maths:

```
cycle = work + rest
t     = floor(elapsedMs / 1000)
round = floor(t / cycle) + 1
pos   = t % cycle
phase = pos < work ? 'work' : 'rest'
left  = phase === 'work' ? work - pos : cycle - pos
```

Edge cases decided rather than discovered: a rest of 0 is legal and means
continuous work with rounds still counting; a cycle of 0 or a negative length
returns `null`, and the UI then shows nothing rather than dividing by zero.

## UI

**Plan** gets a Timer field built from the existing two-button mode pattern
(`sched-modes`): Normal / EMOM. Choosing EMOM reveals two number inputs for work
and rest seconds. Because the same form edits an existing exercise, switching
mode afterwards is free.

**The logger card** gains a band directly under the clock, shown only when the
exercise is in EMOM mode and the session is live:

- the phase word, **WORK** or **REST**, as the largest element
- the seconds remaining in this phase
- the round number

Neon marks WORK, because that is what is live; REST takes silver. That keeps the
palette's one rule intact — green means live or achieved — instead of spending it
on decoration.

The existing one-second global tick updates the band's text in place, exactly as
it already does for `[data-elapsed]`, so an EMOM session costs no re-renders.

## The beep

A short tone generated with Web Audio: no audio files, no network, no
permissions, nothing to maintain. Two notes so they are distinguishable without
looking — a higher one entering WORK, a lower one entering REST.

The AudioContext is created and resumed on a user gesture (the tap that logs a
rep or starts the clock), because iOS will not let a page make sound otherwise.

**Two honest limitations, because "it beeps" would be a promise the platform
does not keep:**

- **iOS silences Web Audio when the physical mute switch is on.** Nothing can be
  done about that from a web app.
- **Beeps are unreliable while the app is backgrounded or the screen is off**,
  since timers are throttled and audio is suspended. The display stays correct
  when you come back, because the phase is derived from timestamps rather than
  counted, but you will have missed the cues.

Therefore the **on-screen band is the primary signal and the beep is a bonus.**
That is why the phase word, not the countdown, is the biggest thing in the band.

## Testing

Unit tests for `emomPhase`: the first work period, the last second of work, the
transition into rest, the last second of rest, the roll into round 2, an
asymmetric 40/20 cycle, a zero rest meaning continuous work, and invalid
lengths returning null. Plus a test that a paused clock holds its phase,
demonstrating the inheritance the whole design rests on.

Browser verification at 375px, without reloading: set an exercise to EMOM with a
short cycle so transitions are observable in seconds, log a rep to start the
clock, watch the band cross WORK into REST and the round increment, confirm
pausing freezes the phase and resuming continues it, and confirm the band
disappears when the day seals.

## Out of scope

- EMOM on the Today card. The band belongs where you are logging.
- Auto-logging reps per round; you still log what you actually did.
- Vibration, which iOS ignores.
- Keeping the screen awake, which iOS Safari does not support.
