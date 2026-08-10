# Exact sets, session image, time exercises — design

2026-08-10. Approved by the user before implementation.

Three additions. Nothing existing is redesigned; every one of them lands on a
mechanism the app already has.

---

## 1 · Exact set entry (bug fix)

**The report.** A real 28-rep set was typed in and came back as two sets, 20 and
8, so Top Set never saw 28.

**The cause.** `REP_PAD` is a fixed list (1…50) with no 28, so the only route in
was the logger's "tap the total to type it". A typed total with nothing logged
is *deliberately* split into 20-chunks by `splitIntoSets` (`domain.js`), because
a day total typed in one go must never masquerade as one heroic set. That rule
is right. What was missing was a way to say "this was one set of 28".

**The fix.**

- The logger's total stops being editable. It is a readout now.
- Directly under it sits a visible control — `+ Exact set` — that opens a
  number field and logs **one set** of whatever is typed, on top of today's
  total. In Subtract mode the same control reads `− Exact amount` and takes the
  number off, using the existing `decrementLast`.
- The control is placed by the total, where the eye already is when the number
  is not on the pad, and labelled so it is understood without reading the note
  under it.

**Kept:** the Progress day list stays tap-to-edit. Correcting a past record is a
different job from training, and `splitIntoSets` survives there for the one
remaining case — typing a total onto a day with nothing logged.

**Not done for the user:** the 20 and 8 already in their log. Editing someone's
real data is theirs to do (set badges are already tap-to-edit).

---

## 2 · Save image from Today

A finished exercise's sheet grows `Save image`, beside the one on the Progress
card. Same canvas, same watermark, session figures instead of lifetime ones:

    icon · name · CATEGORY · today's date
    28 / 30 reps
    TIME 12:04   SETS 4   STREAK 9   TARGET 30

Shared drawing code with the existing card; nothing is uploaded, no dependency.

---

## 3 · Time-based exercises

**Model.** `ex.mode === 'time'`. Absent means count, so every exercise that
exists today is untouched. `ex.unit` is `'min'`, and the target is in minutes,
carried by the existing `targetHistory`.

**The thing that keeps it in harmony:** a time session **banks its minutes into
the day's log** exactly like any other total (`bankTimeSession`, a one-entry
write — never `splitIntoSets`, a clock reading is not a typed number). Streaks,
best day, lifetime, the 30-day chart, the Progress day list and both share cards
then work with no special cases. They read minutes.

Banked on pause, on give up, and on take-the-win — so walking away mid-session
never loses the work. Reset clears the day's entry with the clock.

**Plan form.** The Unit field becomes a two-way switch: **Count** (the free-text
unit field as it is now) or **Time** (a number plus Minutes/Hours; hours are
stored as minutes). The target field follows the switch.

**Today.** No keypad and no set list for a time exercise. A dormant clock with
one `Start`, then the existing Pause / Resume / Give up / Complete. The card
reads `12 of 30 min` and its meter fills by time.

**Reaching the target.** The clock keeps running — nothing auto-completes. When
you are looking at the app as it crosses (or when you open it again afterwards)
the existing *Target reached* sheet appears: Take the win, or Keep going.
`pushingOn` already stops it re-asking.

**Progress.** One group of four, since "fastest session" is meaningless for a
time goal: **Longest session**, **First day**, **Average session**, **Lifetime**
— all formatted as durations.

**Guide.** `src/guide.js` rows for adding (Count or Time), logging (Exact set)
and finishing (Start, and the same win/give-up choice). The topbar `?` sheets
for Today and Plan get a line each, shown only when a time exercise exists.

---

## Testing

Domain-level, where the rules live: `bankTimeSession` writes one entry and never
splits; minute formatting; a time exercise's day counts as done at its target.
`main.js` has no coverage, so the UI is checked by using it at 375px.
