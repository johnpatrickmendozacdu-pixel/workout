# EMOM count-in and approach beeps

Date: 2026-07-30

## What it is

An EMOM session counts you in — 5, 4, 3, 2, 1 — and beeps the same five seconds
before every phase change, so you know a rest is ending or work is about to
start without staring at the screen. This is how every other EMOM timer behaves.

## The start model

Decided by the user: **no new button.** The first logged rep still starts the
session, exactly as it does for a normal exercise, but on an EMOM exercise it
starts a five-second count-in, and **the workout clock waits too** so both begin
together at Round 1.

The implementation follows from something already in the code. `timerElapsedMs`
clamps its running portion with `Math.max(0, nowMs - runStartedAt)`. So starting
the timer with `runStartedAt` set five seconds into the future means:

- the workout clock reads 0:00 for the whole count-in and starts moving at the
  exact instant work begins — no separate "delay" state to keep in step;
- the EMOM cycle, being derived from that same elapsed time, opens on Round 1
  WORK with a full work period, not five seconds into it;
- **"a count-in is running" is derivable**: `runStartedAt` is in the future.
  Nothing new is stored, so nothing new can desynchronise or reach the sync
  snapshot.

Normal-mode exercises are untouched: they start at once, as now.

The rep that triggered the count-in is logged immediately. Only the clocks wait.

## The beeps

Two tones, so they are distinguishable without looking:

- **Countdown tick** — short and low, at T-5, 4, 3, 2, 1.
- **The change itself** — higher entering WORK, lower entering REST, and the
  same "go" tone at the end of the count-in.

Ticks belong to the phase they end. If a phase is shorter than five seconds only
the ticks that fit inside it are emitted, so a 2-second rest cannot spray beeps
back through the work period.

### Scheduled ahead, not detected late

Beeps currently fire when the one-second tick *notices* a phase has changed.
That can be up to a second late, and a throttled tab drops them entirely — which
is worse than useless for a count-in, whose whole value is being exactly on time.

Since every boundary is derived from timestamps, the exact millisecond of each
beep is known in advance. A pure function returns the upcoming events, and the
renderer schedules them on the Web Audio clock, which runs on the audio thread
and is sample-accurate:

```js
emomBeepSchedule(timer, workSec, restSec, nowMs, lookaheadMs)
  -> [{ atMs, kind }]   // kind: 'tick' | 'work' | 'rest'
```

The one-second tick becomes a scheduler that looks a couple of seconds ahead and
books anything new, keyed by `atMs` so a beep is never booked twice.

## Display

The band gains a **READY** state during the count-in, showing the seconds
remaining, styled like REST (silver) rather than WORK — nothing is live yet. The
clock beside it sits at 0:00 on its own, which needs no explanation.

## Honest limits, unchanged

iOS silences Web Audio on the physical mute switch, and suspends it when the app
is backgrounded or the screen is off. Scheduling ahead makes the beeps *precise*
when audio is available; it cannot make them play when the platform has muted
them. The on-screen countdown remains the primary signal.

The audio context is already unlocked by the tap that logs a rep, which is the
same tap that now starts the count-in — so the first beep of a session can sound.

## Testing

Unit tests for `emomBeepSchedule`: the five count-in ticks plus the go tone; the
five ticks before a work→rest change and the rest tone at the boundary; the same
into work; events already past excluded; events beyond the lookahead excluded; a
paused timer producing nothing; ticks clipped to a phase shorter than five
seconds; and no duplicate `atMs` values.

Unit tests for the delayed start: elapsed reads 0 throughout the count-in, the
EMOM phase opens on Round 1 WORK with a full period, and the clock begins
advancing exactly when the count-in ends.

Browser verification at 375px with a short cycle: the READY state counting down,
the clock held at 0:00 and then moving, and the band crossing into WORK on time.

## Out of scope

- Configuring the count-in length. Five seconds, like every other EMOM timer.
- A count-in on normal-mode exercises.
- Voice cues.
