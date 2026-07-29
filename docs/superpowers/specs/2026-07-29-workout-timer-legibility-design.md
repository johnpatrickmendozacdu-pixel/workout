# Making the workout clock legible

Date: 2026-07-29

## Problem

The timer already does everything the user asked for. It auto-starts on the
first logged set, it pauses and resumes, it pauses itself when you cross your
target and offers Take the win / Keep going, and Give up ends the session while
keeping every rep counted. All of it shipped in `8380fe6` and all of it is live
in build `1963252`.

None of it is explained anywhere. The in-app guide never mentions the clock.
The card says nothing about what starts it, what pausing costs, or what Give up
does to your record. And before the first rep there is no timer block at all,
so the one rule that most needs teaching — *logging a rep starts a clock* — can
only be learned by tripping over it.

Two defects found while investigating:

- `.timer-btn` renders 88×36px. This project holds tappable targets to 44px.
- The timer block springs into existence on the first rep and shoves the rep
  pad down the screen, so the button you were aiming at moves under your thumb.

This is a legibility job, not a feature build. Nothing about how the timer
*works* changes.

## Design

### 1. A dormant timer block

The block renders whenever the logger is open, not only once a timer exists.

With no timer yet: clock reads `0:00` in `--text-faint`, status reads
`NOT STARTED`, no controls. On the first rep it lights up in place — the clock
starts and the controls row fills in.

This announces the mechanism before it fires. It also cuts the layout jump from
the full block (~120px) down to the one controls row that appears, which is
honest: full stability would mean reserving a row of empty space, and an empty
44px gap under a dead clock is worse than a small shift.

### 2. The note is permanent signage

A note lives inside the block in every phase, in the same slot, styled like the
existing `.tip` pad note — it does not retire after first use.

| Phase | Note |
|---|---|
| idle | Starts on your first rep. |
| running | Pause any time — stepping away costs you nothing. |
| paused | Clock stopped. Your reps still count. Resume when you're back. |
| completed | Banked. This time counts toward your best. |
| gaveup | Ended early. Your reps still count; the time doesn't. |

The `completed` and `gaveup` notes state a real consequence rather than a
sentiment: `completedTimes` in `stats.js` counts only `completed` sessions
toward best and average, so a session you ended early genuinely does not.

Border colour follows the phase — accent for idle and running, silver for
paused, danger for gaveup — reusing the pad note's existing behaviour of
turning to the warning colour.

### 3. Give up gets the sheet its opposite already has

Give up is currently one silent tap with no confirmation and no
acknowledgement. Crossing your target, the symmetric moment, opens a sheet with
a stat line and two choices.

Tapping Give up now opens `modal.type = 'giveup'`, built as a sibling of
`modalComplete`:

- heading **End here?**
- the honest stat line — `42 of 100 reps • 11:20`
- **Log what I did** (danger-toned primary) and **Keep going** (secondary)

The clock keeps running while the sheet is open; it is a confirmation, not a
pause. Keep going returns to the logger with the clock running, exactly as it
does from the target-reached sheet.

This is what turns quitting into a logged result: the moment you give up, the
app shows you what you actually did.

### 4. Today stops nagging about a session you closed

An exercise you gave up on currently stays in **To do** showing reps remaining,
as though nothing happened. Today's job is "what's left, and how do I start
it" — a session you deliberately ended is not left.

A gaveup exercise moves to the **Done** section as a quiet row with a flag
glyph and `42 of 100`, distinct from the green tick of a met target. It stays
tappable, and logging more reps afterwards still counts.

Streaks are untouched: they are computed from sets against target and never
read the timer, so giving up short of target still breaks the streak. That is
precisely the "logged that you failed the target, kept what you achieved"
behaviour asked for, and it already works.

### 5. Guide rows

Two rows added to the Today guide, which currently has no entry for the clock:

- **The clock** — Starts with your first rep. Pause any time.
- **End early** — Give up logs what you did and stops the clock.

### 6. The 44px fix

`.timer-btn` gets `min-height:44px`, and joins the night-brutalist control set
so it takes the 2px ink border the other controls carry instead of the 1px
border it kept from the pre-restyle base.

## Architecture

Rendering only, with one addition to the domain layer:

```js
timerPhase(timer) // 'idle' | 'running' | 'paused' | 'completed' | 'gaveup'
```

Pure, in `domain.js`, returning `'idle'` for no timer. Three render sites need
the idle case named rather than each re-deriving it from a null check. Copy
stays in `main.js`, where all rendering lives.

No storage change, no migration, no change to what is derived versus stored.

## Testing

- `timerPhase` for every status and for null — unit tests in `tests/domain.test.js`.
- Existing 113 tests must stay green; no timer behaviour is being altered.
- Manual verification at 375px against the project rule: screenshot each of the
  five phases, measure every timer control clears 44×44, confirm no horizontal
  overflow, and exercise idle → running → paused → gaveup **without reloading
  between checks**, since a reload masks re-render bugs.

## Out of scope

- Manually starting the clock before the first rep. The rule is "your first rep
  starts it"; a second way in muddies it.
- Pausing from the Today screen without opening the card.
- Per-set rest timers.
