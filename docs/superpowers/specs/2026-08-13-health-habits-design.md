# Health habits — design

A second kind of thing you can add to your plan, alongside an exercise: a daily
health habit. The first one people will use is keto, tracked meal by meal.

The daily weigh-in already in the app is untouched. It stores a *number* the BMI
line and the weekly chart read, and folding it into this would gain nothing and
risk the `weightLog` union-merge bug. Two health habits of different shapes is
correct; one system that has to be both is not.

## The rule that shapes everything

**Count breaks, not meals.**

A day is clean unless something broke it. That single flip removes the score,
and with the score goes every bad feeling the obvious design produces: a skipped
meal is neutral rather than a lost point, and there is no 2/3 to feel bad about.
For keto specifically the user's rule is absolute — *any carb breaks the day* —
so the six meal slots are not scoring the day. They are a **diary of where it
broke**, which is the more useful half: after a month, Progress can say "you
break at Evening snack 7 times out of 9", and that is an actionable fact about
losing weight. A daily yes/no could never say it.

## The habit day runs 5 AM to 4:59 AM

The user's own meal windows start at 5 AM, which happens to solve the hardest
problem here: a 1 AM raid belongs to the night you are still living, not the
morning you have not started. So a habit's day is the calendar date five hours
ago, and the evening block runs past midnight.

| Block | Window | Slots |
|---|---|---|
| Morning | 5:00 AM – 11:59 AM | Breakfast · Morning snack |
| Midday | 12:00 PM – 5:59 PM | Lunch · Afternoon snack |
| Evening | 6:00 PM – 4:59 AM | Dinner · Evening snack |

One pure function, `habitDay(nowMs)`, and every window question answers itself.
Nothing else in the app changes: `todayISO()` keeps meaning exactly what it
means everywhere else, and only habit code calls `habitDay`.

Between midnight and 5 AM the two disagree, and the card must say so rather than
look broken — it labels itself with the habit day when it differs from the
calendar day.

## Slot states, day states

A slot is **Kept**, **Skipped** or **Broke**. Skipped is neutral: not eating is
not a carb.

A day is:

- **Clean** — nothing broke, and at least one slot Kept.
- **Broken** — anything broke. Sealed the moment it happens; the remaining slots
  still log, because that is the diagnosis.
- **Neutral** — nothing logged, or everything skipped. Neither extends the
  streak nor ends it.
- **Off plan** — deliberately marked. Neutral, unlimited, as asked.

A day the habit is not scheduled for is neutral, never a break.

The "at least one Kept" condition exists so a day of pure skipping does not read
as a triumph. A clean day with five unlogged slots is still clean, but the day
list shows the holes, so a thin streak looks thin. **Display, not enforcement**
— the alternative punishes you for having a meeting.

## Immutability

**Add anything, change nothing.** Once a slot is tapped, that value is final —
not later the same day, not tomorrow, never.

The streak is the reward, so the streak is what you will be tempted to protect.
If a break is editable then at some point you break at dinner, look at a 30-day
streak, and quietly fix it — and from then on every number in the app is a
number you chose rather than earned. The cost is that a mis-tap is permanent.
That is the right trade: a wrong tap costs one slot on one day, and the rule is
what makes the other two hundred days mean anything.

It follows that **a day you never logged stays unlogged forever**. There is no
catch-up prompt, no retro-edit sheet, no edit path at all — which is also less
code than the alternative.

Immutability has a second payoff, in sync: two devices can never disagree about
a slot's value, only about whether it was set. The merge is therefore
conflict-free by construction, and where both hold a value the **earlier
timestamp wins**, because that is the one that actually happened.

## Live vs late

Every slot stays loggable until the habit day ends at 4:59 AM. But a slot logged
inside its own block is **live**; one logged after its block closed is **late**.

Nothing is ever lost, and the windows still mean something. Filled pill for
live, hollow pill for late — one CSS class, and no new stored field: the tap's
timestamp is already recorded and the block boundaries are arithmetic.

This gives a second thing to chase **that cannot be gamed**. The streak comes
from what you tapped. "In the moment" comes from the clock. The only way that
number rises is by actually opening the app after breakfast, which is the
behaviour that makes the streak true in the first place.

Late never softens the truth: a break logged at midnight breaks the day exactly
as much as one logged at noon. And because the day seals at 4:59 AM, "late" can
never become "invented".

## Presets are a copy, not a subscription

Activating a preset **copies** its fields into a habit that is then yours.
Nothing links back. The moment presets are linked by id, editing one later
mutates habits on other people's phones and we own a sync problem nobody asked
for.

Three presets, not a catalogue:

- **Keto** 🥑 — meals shape. "Any carb breaks the day."
- **No alcohol** 🚫 — plain shape. "One drink breaks the day."
- **Sleep by 11** 🌙 — plain shape.

Plus **Custom**: name, shape, schedule.

So a habit has exactly two shapes: `meals` (the six slots) and `plain` (one tap
for the whole day). Arbitrary custom slots are not built until someone asks.

## Data

Two new keys, both persisted and both synced. No third.

`habits` — IndexedDB `habits`, an array:

```js
{
  id, name, emoji, rule,          // rule is display text, e.g. "Any carb breaks the day."
  kind: 'meals' | 'plain',
  schedule: 'daily' | [0..6],     // same shape as an exercise
  scheduleHistory: [{ effectiveDate, schedule }],
  createdDate, active: true,
}
```

`schedule`, `scheduleHistory` and `createdDate` are deliberately the same fields
an exercise uses, so `scheduleEffectiveOn` and `isScheduledOn` are **reused
unchanged** rather than reimplemented. Those functions read only those fields.

Schedule history exists from day one. Changing a schedule must never rewrite the
past — that lesson has already been paid for once, when changing an exercise's
days erased its streak.

`habitLog` — IndexedDB `habit-log`, keyed by habit day:

```js
habitLog[day][habitId] = {
  slots: { breakfast: { v: 'kept'|'skip'|'broke', at: 1712345678901 }, ... },
  off: true,   // present only when the day is marked off plan
}
```

`live` is **derived** from `at`, never stored. A plain habit uses a single slot
key, `day`, so both shapes share one log and one set of functions.

**Habits are archived, never deleted** (`active: false`). That is not tidiness —
it removes the need for a tombstone key entirely, and a resurrect-after-delete
bug has already cost this codebase a debugging session.

## Pure layer

New file `src/domain/habits.js`, mirroring the existing `domain.js` / `stats.js`
split rather than growing either. Everything here is pure and tested.

- `HABIT_SLOTS`, `HABIT_BLOCKS` — the tables above, as data.
- `habitDay(nowMs)` → ISO date of five hours ago.
- `habitMinute(nowMs)` → minutes since 5 AM, 0..1439.
- `blockOf(slotKey)`, `isLive(slotKey, atMs)`.
- `logSlot(habitLog, day, habitId, slotKey, value, nowMs)` — **returns the log
  unchanged if that slot already holds a value.** This one guard is where
  immutability lives, so every caller gets it for free.
- `setOffPlan(habitLog, day, habitId, on)`.
- `habitDayState(habitLog, habit, day)` → `'clean' | 'broken' | 'neutral' | 'off'`.
- `habitStats(habitLog, habit, today)` → `{ current, longest, cleanIn30,
  liveRate, breaksBySlot }`. Today is neutral until logged and must not break the
  streak — the same special case `calcStreakInfo` already makes for today.
- `mergeHabitLogs(winner, loser)` — day → habit → slot, earliest `at` wins.

`mergeByDayKey` cannot be reused: it shallow-merges one level, so the winner's
habit entry would replace the loser's whole slot set and silently bin meals
logged on the other phone.

## UI

**Plan.** The Add button opens a two-way chooser — *Exercise* or *Health habit*
— and Exercise goes to the form that exists today, unchanged. Health habit opens
the preset picker, then a short form: emoji, name, schedule (the existing day
picker, reused). No target field; there is no target.

**Today.** A "Health habits" section below the exercises, above the weigh-in
card. A meals habit shows its three blocks: the current one open with its two
slots, past blocks collapsed to a one-line summary, the block that has not
arrived dimmed. Open the app at 2 PM and you see Midday, not a wall of six. A
plain habit is a single Kept / Broke row. Both carry the streak and an "Off
plan" action.

**Progress.** One block per habit: streak, clean days in the last 30, "Logged in
the moment — 84%", a 30-day strip, and the diagnosis line naming the slot that
breaks most. The clean-in-30 figure sits beside the streak deliberately —
unlimited off-plan days can quietly hollow a streak out, and that number cannot
be gamed.

**Not on the crew card.** What you eat is more personal than how many push-ups
you did. `sanitiseCard` decides what leaves the phone and it is not being
widened. Crew visibility is a separate, later, opt-in decision.

## Sync

`'habits'` and `'habitLog'` join `SNAPSHOT_DATA_KEYS`, so `sameSnapshotData`
covers them and a habit change actually triggers a push.

- `habits` merges by id, winner's ordering, appending ids it lacks — the same
  shape as `mergeExerciseLists`.
- `habitLog` merges with `mergeHabitLogs`, never as a spread. Rebuilding a
  stored object from the fields one screen edits is the bug that once destroyed
  an avatar and then propagated the deletion.

Old snapshots carry neither key; absent must read as empty everywhere, never
fatal. Optional data must not be able to kill a screen — naming one missing
column once broke every crew.

## Testing

`tests/habits.test.js` covers the pure layer: the 5 AM boundary either side of
midnight, live vs late at each block edge, the immutability guard rejecting a
second write, day states including all-skipped and unscheduled, the streak
across neutral and off-plan gaps, and a `mergeHabitLogs` case where two devices
log different slots on the same day.

`main.js` has no test coverage and this does not change that, so the habit
screens are verified by using them at 375px — not by calling handlers.

## Deliberately not built

- Per-meal partial credit, tiers, badges, a second streak.
- Arbitrary custom slots; a preset registry; preset updates.
- Habits on the crew card or share cards.
- Any edit or catch-up path, which immutability rules out by design.
