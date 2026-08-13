# Health Habits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add health habits — recurring, targetless daily habits (keto tracked meal by meal) that live alongside exercises with their own streak, their own 5 AM day, and an immutable log.

**Architecture:** A new pure module `src/domain/habits.js` holds every rule; `src/domain/domain.js` gains only the sync merge; `src/main.js` gains state, persistence and three screens. Habits reuse the exercise `schedule` / `scheduleHistory` field shape so `isScheduledOn` and `scheduleEffectiveOn` work on them unchanged.

**Tech Stack:** Vanilla JS (ES modules), Vite, Vitest. No runtime dependencies — do not add any.

**Spec:** `docs/superpowers/specs/2026-08-13-health-habits-design.md`

## Global Constraints

- **No new dependencies.** The app has zero runtime dependencies and that is a hard rule.
- **Pure layer is tested; `main.js` is not.** `main.js` and `googleSync.js` have no test coverage. Every rule must live in `src/domain/habits.js` so it can be tested. `main.js` renders and dispatches only.
- **`todayISO()` keeps its meaning everywhere.** Only habit code calls `habitDay()`. Never change `todayISO`, `isoDate` or `addDays`.
- **Habit day starts at 5 AM** (`HABIT_DAY_START_HOUR = 5`) and runs to 4:59 AM.
- **Immutability:** a slot that holds a value can never be changed. Writes are refused on any day but the current habit day.
- **Habits are archived (`active: false`), never deleted.** No tombstone key.
- **Two new sync keys only:** `habits` and `habitLog`. Absent must read as empty, never fatal.
- **Habits never go on the crew card or share cards.** Do not touch `buildCrewCard` or `sanitiseCard`.
- Run tests with `npm test`. All 321 existing tests must still pass at every commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/habits.js` | **Create.** Every habit rule: the day boundary, blocks and slots, presets, log writes with their guards, day state, stats. Pure. |
| `tests/habits.test.js` | **Create.** Covers all of the above. |
| `src/domain/domain.js` | **Modify.** `mergeHabitLogs`, plus `habits`/`habitLog` in `SNAPSHOT_DATA_KEYS` and `mergeSyncSnapshots`. Merges live here, next to the others, so `habits.js` never has to import `domain.js` back and create a cycle. |
| `tests/domain.test.js` | **Modify.** Merge cases. |
| `src/main.js` | **Modify.** State, persistence, the Plan chooser and habit form, the Today cards, the Progress block. |
| `src/style.css` | **Modify.** Habit card, slot pills, block rows. |

---

### Task 1: The habit day, its blocks and its slots

**Files:**
- Create: `src/domain/habits.js`
- Create: `tests/habits.test.js`

**Interfaces:**
- Consumes: `isoDate` from `src/domain/domain.js`.
- Produces: `HABIT_DAY_START_HOUR: number`, `HABIT_BLOCKS: Array<{key,label,start,end,window}>`, `HABIT_SLOTS: Array<{key,label,block}>`, `PLAIN_SLOT: 'day'`, `slotsFor(habit) -> Array<{key,label,block}>`, `habitDay(nowMs) -> 'YYYY-MM-DD'`, `habitMinute(nowMs) -> 0..1439`, `blockOf(slotKey) -> block|null`, `blockAt(nowMs) -> block`, `isLive(slotKey, atMs) -> boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/habits.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  HABIT_SLOTS, HABIT_BLOCKS, PLAIN_SLOT, slotsFor,
  habitDay, habitMinute, blockOf, blockAt, isLive,
} from '../src/domain/habits.js';

// Local-time constructors on purpose: the app reads the phone's clock, so the
// tests must too.
const at = (s) => new Date(s).getTime();

describe('the habit day runs 5 AM to 4:59 AM', () => {
  it('a 1 AM snack belongs to the night before', () => {
    expect(habitDay(at('2026-08-13T01:30:00'))).toBe('2026-08-12');
  });
  it('4:59 AM is still the night before', () => {
    expect(habitDay(at('2026-08-13T04:59:00'))).toBe('2026-08-12');
  });
  it('5:00 AM starts the new day', () => {
    expect(habitDay(at('2026-08-13T05:00:00'))).toBe('2026-08-13');
  });
  it('midday is unremarkable', () => {
    expect(habitDay(at('2026-08-13T13:00:00'))).toBe('2026-08-13');
  });
});

describe('habitMinute counts from 5 AM', () => {
  it('is 0 at 5 AM', () => expect(habitMinute(at('2026-08-13T05:00:00'))).toBe(0));
  it('is 420 at noon', () => expect(habitMinute(at('2026-08-13T12:00:00'))).toBe(420));
  it('wraps past midnight', () => expect(habitMinute(at('2026-08-13T01:00:00'))).toBe(1200));
  it('is 1439 at 4:59 AM', () => expect(habitMinute(at('2026-08-13T04:59:00'))).toBe(1439));
});

describe('blocks', () => {
  it('has three', () => expect(HABIT_BLOCKS.map((b) => b.key)).toEqual(['morning', 'midday', 'evening']));
  it('covers the whole day with no gap', () => {
    expect(HABIT_BLOCKS[0].start).toBe(0);
    expect(HABIT_BLOCKS[2].end).toBe(1439);
    expect(HABIT_BLOCKS[1].start).toBe(HABIT_BLOCKS[0].end + 1);
    expect(HABIT_BLOCKS[2].start).toBe(HABIT_BLOCKS[1].end + 1);
  });
  it('puts 2 PM in midday and 1 AM in evening', () => {
    expect(blockAt(at('2026-08-13T14:00:00')).key).toBe('midday');
    expect(blockAt(at('2026-08-13T01:00:00')).key).toBe('evening');
  });
});

describe('slots', () => {
  it('has six, in the order they happen', () => {
    expect(HABIT_SLOTS.map((s) => s.key)).toEqual([
      'breakfast', 'morningSnack', 'lunch', 'afternoonSnack', 'dinner', 'eveningSnack',
    ]);
  });
  it('maps each to its block', () => {
    expect(blockOf('breakfast').key).toBe('morning');
    expect(blockOf('afternoonSnack').key).toBe('midday');
    expect(blockOf('eveningSnack').key).toBe('evening');
  });
  it('gives a plain habit one windowless slot', () => {
    expect(slotsFor({ kind: 'plain' })).toEqual([{ key: PLAIN_SLOT, label: 'Today', block: null }]);
    expect(slotsFor({ kind: 'meals' })).toBe(HABIT_SLOTS);
  });
});

describe('live vs late', () => {
  it('breakfast logged at 8 AM is live', () => {
    expect(isLive('breakfast', at('2026-08-13T08:00:00'))).toBe(true);
  });
  it('breakfast logged at 8 PM is late', () => {
    expect(isLive('breakfast', at('2026-08-13T20:00:00'))).toBe(false);
  });
  it('is live at the very edge of its block', () => {
    expect(isLive('breakfast', at('2026-08-13T11:59:00'))).toBe(true);
    expect(isLive('lunch', at('2026-08-13T12:00:00'))).toBe(true);
    expect(isLive('lunch', at('2026-08-13T17:59:00'))).toBe(true);
  });
  it('lets the evening block run past midnight', () => {
    expect(isLive('eveningSnack', at('2026-08-13T23:30:00'))).toBe(true);
    expect(isLive('eveningSnack', at('2026-08-14T01:00:00'))).toBe(true);
  });
  it('a windowless slot is never late', () => {
    expect(isLive(PLAIN_SLOT, at('2026-08-13T03:00:00'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/habits.test.js`
Expected: FAIL — `Failed to resolve import "../src/domain/habits.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/domain/habits.js`:

```js
// Health habits — pure domain. No DOM, no storage, no globals.
//
// A habit's day runs 5:00 AM to 4:59 AM the next morning. That is not a
// preference: the user's own meal windows start at 5 AM, and it means a 1 AM
// raid breaks the night you are still living rather than the morning you have
// not started. Only habit code calls habitDay() — todayISO() keeps meaning
// exactly what it means everywhere else in the app.

import { isoDate } from './domain.js';

export const HABIT_DAY_START_HOUR = 5;

/** The three blocks, in minutes since 5 AM. They tile 0..1439 with no gap, so
 *  every moment of the day belongs to exactly one of them. */
export const HABIT_BLOCKS = [
  { key: 'morning', label: 'Morning', start: 0, end: 419, window: '5:00 AM – 11:59 AM' },
  { key: 'midday', label: 'Midday', start: 420, end: 779, window: '12:00 PM – 5:59 PM' },
  { key: 'evening', label: 'Evening', start: 780, end: 1439, window: '6:00 PM – 4:59 AM' },
];

export const HABIT_SLOTS = [
  { key: 'breakfast', label: 'Breakfast', block: 'morning' },
  { key: 'morningSnack', label: 'Morning snack', block: 'morning' },
  { key: 'lunch', label: 'Lunch', block: 'midday' },
  { key: 'afternoonSnack', label: 'Afternoon snack', block: 'midday' },
  { key: 'dinner', label: 'Dinner', block: 'evening' },
  { key: 'eveningSnack', label: 'Evening snack', block: 'evening' },
];

/** A plain habit is one tap for the whole day. Giving it a slot key of its own
 *  means both shapes share one log and one set of functions. */
export const PLAIN_SLOT = 'day';
const PLAIN_SLOTS = [{ key: PLAIN_SLOT, label: 'Today', block: null }];

export function slotsFor(habit) {
  return habit && habit.kind === 'meals' ? HABIT_SLOTS : PLAIN_SLOTS;
}

export function habitDay(nowMs) {
  return isoDate(new Date(nowMs - HABIT_DAY_START_HOUR * 3600000));
}

/** Minutes since this habit day began, 0..1439. */
export function habitMinute(nowMs) {
  const d = new Date(nowMs);
  return (d.getHours() * 60 + d.getMinutes() - HABIT_DAY_START_HOUR * 60 + 1440) % 1440;
}

export function blockOf(slotKey) {
  const slot = HABIT_SLOTS.find((s) => s.key === slotKey);
  if (!slot) return null;
  return HABIT_BLOCKS.find((b) => b.key === slot.block) || null;
}

export function blockAt(nowMs) {
  const m = habitMinute(nowMs);
  return HABIT_BLOCKS.find((b) => m >= b.start && m <= b.end) || HABIT_BLOCKS[0];
}

/** Logged inside its own block, or caught up later. Derived from the tap's
 *  timestamp — never stored, so it cannot drift from the clock. */
export function isLive(slotKey, atMs) {
  const b = blockOf(slotKey);
  if (!b) return true;
  const m = habitMinute(atMs);
  return m >= b.start && m <= b.end;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/habits.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — 321 existing plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add src/domain/habits.js tests/habits.test.js
git commit -m "Give health habits a day that starts at 5 AM

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Writing to the log, and the guards that make it immutable

**Files:**
- Modify: `src/domain/habits.js`
- Modify: `tests/habits.test.js`

**Interfaces:**
- Consumes: `habitDay`, `PLAIN_SLOT` from Task 1.
- Produces: `SLOT_VALUES: ['kept','skip','broke']`, `slotAt(habitLog, day, habitId, slotKey) -> {v,at}|null`, `hasAnySlot(habitLog, day, habitId) -> boolean`, `isOffPlan(habitLog, day, habitId) -> boolean`, `logSlot(habitLog, day, habitId, slotKey, value, nowMs) -> habitLog`, `setOffPlan(habitLog, day, habitId, on, nowMs) -> habitLog`. All log functions are pure and return a new log; a refused write returns the **same object reference** it was given.

- [ ] **Step 1: Write the failing test**

Append to `tests/habits.test.js`:

```js
import { SLOT_VALUES, slotAt, hasAnySlot, isOffPlan, logSlot, setOffPlan } from '../src/domain/habits.js';

const NOON = at('2026-08-13T12:30:00');
const DAY = '2026-08-13';

describe('logSlot', () => {
  it('writes a value with the moment it was tapped', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(slotAt(log, DAY, 'h1', 'lunch')).toEqual({ v: 'kept', at: NOON });
  });
  it('does not mutate the log it was given', () => {
    const before = {};
    logSlot(before, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(before).toEqual({});
  });
  it('keeps slots already written', () => {
    let log = logSlot({}, DAY, 'h1', 'breakfast', 'kept', NOON);
    log = logSlot(log, DAY, 'h1', 'lunch', 'broke', NOON);
    expect(Object.keys(log[DAY].h1.slots).sort()).toEqual(['breakfast', 'lunch']);
  });
  it('keeps two habits on the same day apart', () => {
    let log = logSlot({}, DAY, 'h1', 'lunch', 'kept', NOON);
    log = logSlot(log, DAY, 'h2', 'lunch', 'broke', NOON);
    expect(slotAt(log, DAY, 'h1', 'lunch').v).toBe('kept');
    expect(slotAt(log, DAY, 'h2', 'lunch').v).toBe('broke');
  });

  // Add anything, change nothing.
  it('refuses to change a slot that already holds a value', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'broke', NOON);
    const after = logSlot(log, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(after).toBe(log);
    expect(slotAt(after, DAY, 'h1', 'lunch').v).toBe('broke');
  });
  it('refuses a write to any day but the current habit day', () => {
    const log = logSlot({}, '2026-08-12', 'h1', 'lunch', 'kept', NOON);
    expect(log).toEqual({});
  });
  it('accepts a write at 1 AM against the night before', () => {
    const lateMs = at('2026-08-14T01:00:00');
    const log = logSlot({}, DAY, 'h1', 'eveningSnack', 'broke', lateMs);
    expect(slotAt(log, DAY, 'h1', 'eveningSnack').v).toBe('broke');
  });
  it('rejects a value that is not one of the three', () => {
    expect(logSlot({}, DAY, 'h1', 'lunch', 'maybe', NOON)).toEqual({});
    expect(SLOT_VALUES).toEqual(['kept', 'skip', 'broke']);
  });
});

describe('setOffPlan', () => {
  it('marks and unmarks a day nothing has been logged on', () => {
    let log = setOffPlan({}, DAY, 'h1', true, NOON);
    expect(isOffPlan(log, DAY, 'h1')).toBe(true);
    log = setOffPlan(log, DAY, 'h1', false, NOON);
    expect(isOffPlan(log, DAY, 'h1')).toBe(false);
    expect(log).toEqual({});
  });
  it('refuses to launder a broken day', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'broke', NOON);
    const after = setOffPlan(log, DAY, 'h1', true, NOON);
    expect(after).toBe(log);
    expect(isOffPlan(after, DAY, 'h1')).toBe(false);
  });
  it('refuses once anything at all is logged, even a good day', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(setOffPlan(log, DAY, 'h1', true, NOON)).toBe(log);
  });
  it('refuses on any day but the current habit day', () => {
    expect(setOffPlan({}, '2026-08-01', 'h1', true, NOON)).toEqual({});
  });
  it('blocks logging on a day already marked off plan', () => {
    const log = setOffPlan({}, DAY, 'h1', true, NOON);
    expect(logSlot(log, DAY, 'h1', 'lunch', 'kept', NOON)).toBe(log);
  });
  it('reports hasAnySlot honestly', () => {
    expect(hasAnySlot({}, DAY, 'h1')).toBe(false);
    expect(hasAnySlot(logSlot({}, DAY, 'h1', 'lunch', 'skip', NOON), DAY, 'h1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/habits.test.js`
Expected: FAIL — `SLOT_VALUES` and the log functions are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/domain/habits.js`:

```js
export const SLOT_VALUES = ['kept', 'skip', 'broke'];

function entryAt(habitLog, day, habitId) {
  return (habitLog && habitLog[day] && habitLog[day][habitId]) || null;
}

export function slotAt(habitLog, day, habitId, slotKey) {
  const e = entryAt(habitLog, day, habitId);
  return (e && e.slots && e.slots[slotKey]) || null;
}

export function hasAnySlot(habitLog, day, habitId) {
  const e = entryAt(habitLog, day, habitId);
  return !!(e && e.slots && Object.keys(e.slots).length);
}

export function isOffPlan(habitLog, day, habitId) {
  const e = entryAt(habitLog, day, habitId);
  return !!(e && e.off);
}

/** Rewrites one habit's entry on one day, dropping empty days so the log never
 *  accumulates husks. Pure — the input is never touched. */
function writeEntry(habitLog, day, habitId, entry) {
  const next = { ...(habitLog || {}) };
  const dayMap = { ...(next[day] || {}) };
  if (entry) dayMap[habitId] = entry;
  else delete dayMap[habitId];
  if (Object.keys(dayMap).length) next[day] = dayMap;
  else delete next[day];
  return next;
}

/**
 * Add anything, change nothing.
 *
 * A slot that already holds a value is final — not later the same day, not
 * tomorrow, never. This guard is the only place immutability lives, so every
 * caller gets it for free rather than each screen remembering to ask. The
 * streak is the reward, so the streak is what you would be tempted to protect;
 * a log you can rewrite is a log that argues with you at exactly the wrong
 * moment.
 *
 * A refused write returns the same object, so a caller can cheaply tell that
 * nothing happened.
 */
export function logSlot(habitLog, day, habitId, slotKey, value, nowMs) {
  if (!SLOT_VALUES.includes(value)) return habitLog;
  if (day !== habitDay(nowMs)) return habitLog;
  const e = entryAt(habitLog, day, habitId);
  if (e && e.off) return habitLog;
  if (e && e.slots && e.slots[slotKey]) return habitLog;
  const slots = { ...((e && e.slots) || {}), [slotKey]: { v: value, at: nowMs } };
  return writeEntry(habitLog, day, habitId, { slots });
}

/**
 * Off plan is a decision, not a record, so it is the one thing that can be
 * turned back off — but only while the day is still untouched. Without that
 * guard you could break at lunch and then mark the day off plan to launder the
 * streak, which would quietly make every streak in the app meaningless.
 */
export function setOffPlan(habitLog, day, habitId, on, nowMs) {
  if (day !== habitDay(nowMs)) return habitLog;
  if (hasAnySlot(habitLog, day, habitId)) return habitLog;
  return writeEntry(habitLog, day, habitId, on ? { off: true, slots: {} } : null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/habits.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/habits.js tests/habits.test.js
git commit -m "Make a logged habit slot final, and off plan unlaunderable

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Day state and stats

**Files:**
- Modify: `src/domain/habits.js`
- Modify: `tests/habits.test.js`

**Interfaces:**
- Consumes: `entryAt` internals from Task 2, `isScheduledOn` and `addDays` from `src/domain/domain.js`.
- Produces: `habitDayState(habitLog, habit, day) -> 'clean'|'broken'|'neutral'|'off'`, `habitStats(habitLog, habit, today) -> { current, longest, cleanIn30, liveRate, breaksBySlot }`. `liveRate` is a whole-number percentage, or `null` when nothing has ever been logged. `breaksBySlot` is `{ [slotKey]: count }`.

A habit passed to these functions must carry `id`, `kind`, `createdDate`, and either `schedule` or `scheduleHistory`.

- [ ] **Step 1: Write the failing test**

Append to `tests/habits.test.js`:

```js
import { habitDayState, habitStats } from '../src/domain/habits.js';

const KETO = { id: 'h1', kind: 'meals', schedule: 'daily', createdDate: '2026-08-01' };
const nowOn = (day, clock = 'T12:30:00') => at(day + clock);
/** Log a slot as if it were being tapped on that day at midday. */
const put = (log, day, slot, v) => logSlot(log, day, 'h1', slot, v, nowOn(day));

describe('habitDayState', () => {
  it('is neutral when nothing is logged', () => {
    expect(habitDayState({}, KETO, '2026-08-10')).toBe('neutral');
  });
  it('is clean when something was kept and nothing broke', () => {
    const log = put({}, '2026-08-10', 'breakfast', 'kept');
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('clean');
  });
  it('is broken the moment anything breaks, whatever else happened', () => {
    let log = put({}, '2026-08-10', 'breakfast', 'kept');
    log = put(log, '2026-08-10', 'dinner', 'broke');
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('broken');
  });
  it('is neutral when every slot was skipped — not eating is not a triumph', () => {
    let log = put({}, '2026-08-10', 'breakfast', 'skip');
    log = put(log, '2026-08-10', 'lunch', 'skip');
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('neutral');
  });
  it('is off when the day was marked off plan', () => {
    const log = setOffPlan({}, '2026-08-10', 'h1', true, nowOn('2026-08-10'));
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('off');
  });
  it('is off on a day the habit is not scheduled for', () => {
    const weekdays = { ...KETO, schedule: [1, 2, 3, 4, 5] };
    expect(habitDayState({}, weekdays, '2026-08-09')).toBe('off'); // a Sunday
  });
});

describe('habitStats', () => {
  it('counts a run of clean days', () => {
    let log = {};
    ['2026-08-08', '2026-08-09', '2026-08-10'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(3);
  });
  it('lets today be neutral without ending the streak', () => {
    let log = {};
    ['2026-08-08', '2026-08-09'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(2);
  });
  it('steps over a neutral gap rather than ending on it', () => {
    let log = put({}, '2026-08-08', 'breakfast', 'kept');
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(2);
  });
  it('steps over an off-plan day', () => {
    let log = put({}, '2026-08-08', 'breakfast', 'kept');
    log = setOffPlan(log, '2026-08-09', 'h1', true, nowOn('2026-08-09'));
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(2);
  });
  it('ends the streak on a break', () => {
    let log = put({}, '2026-08-08', 'breakfast', 'kept');
    log = put(log, '2026-08-09', 'dinner', 'broke');
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(1);
  });
  it('remembers the longest run after it is broken', () => {
    let log = {};
    ['2026-08-02', '2026-08-03', '2026-08-04'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    log = put(log, '2026-08-05', 'dinner', 'broke');
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    const s = habitStats(log, KETO, '2026-08-10');
    expect(s.longest).toBe(3);
    expect(s.current).toBe(1);
  });
  it('counts clean days in the last thirty', () => {
    let log = {};
    ['2026-08-08', '2026-08-09', '2026-08-10'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    expect(habitStats(log, KETO, '2026-08-10').cleanIn30).toBe(3);
  });
  it('is null on live rate until something is logged', () => {
    expect(habitStats({}, KETO, '2026-08-10').liveRate).toBe(null);
  });
  it('scores logging in the moment against logging late', () => {
    // breakfast tapped at 8 AM is live; breakfast tapped at 8 PM is late
    let log = logSlot({}, '2026-08-10', 'h1', 'breakfast', 'kept', at('2026-08-10T08:00:00'));
    log = logSlot(log, '2026-08-10', 'h1', 'lunch', 'kept', at('2026-08-10T20:00:00'));
    expect(habitStats(log, KETO, '2026-08-10').liveRate).toBe(50);
  });
  it('names the slot that breaks most', () => {
    let log = put({}, '2026-08-08', 'eveningSnack', 'broke');
    log = put(log, '2026-08-09', 'eveningSnack', 'broke');
    log = put(log, '2026-08-10', 'lunch', 'broke');
    expect(habitStats(log, KETO, '2026-08-10').breaksBySlot).toEqual({ eveningSnack: 2, lunch: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/habits.test.js`
Expected: FAIL — `habitDayState` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/domain/habits.js`, extend the existing import line at the top to:

```js
import { isoDate, addDays, isScheduledOn } from './domain.js';
```

Then append:

```js
/**
 * Count breaks, not meals.
 *
 * A day is clean unless something broke it, which is why a skipped meal costs
 * nothing: not eating is not a carb. "At least one kept" is what stops a day of
 * pure skipping reading as a triumph. A day with holes in it is still clean —
 * the day list shows the holes, so a thin streak looks thin. Display, not
 * enforcement: the alternative punishes you for having a meeting.
 */
export function habitDayState(habitLog, habit, day) {
  if (!isScheduledOn(habit, day)) return 'off';
  const e = entryAt(habitLog, day, habit.id);
  if (e && e.off) return 'off';
  const vals = e && e.slots ? Object.keys(e.slots).map((k) => e.slots[k].v) : [];
  if (vals.includes('broke')) return 'broken';
  if (vals.includes('kept')) return 'clean';
  return 'neutral';
}

export function habitStats(habitLog, habit, today) {
  const start = habit.createdDate && habit.createdDate < today ? habit.createdDate : today;

  // Walking back: a break ends the streak, a clean day extends it, and neutral
  // or off-plan days are gaps it steps over. Today is neutral until you log it,
  // which must not be read as a miss — the same allowance calcStreakInfo makes.
  let current = 0;
  let cursor = today;
  while (cursor >= start) {
    const st = habitDayState(habitLog, habit, cursor);
    if (st === 'broken') break;
    if (st === 'clean') current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let running = 0;
  let cur = start;
  let guard = 0;
  while (cur <= today && guard < 20000) {
    const st = habitDayState(habitLog, habit, cur);
    if (st === 'clean') { running++; if (running > longest) longest = running; }
    else if (st === 'broken') running = 0;
    cur = addDays(cur, 1);
    guard++;
  }
  if (current > longest) longest = current;

  let cleanIn30 = 0;
  for (let i = 0; i < 30; i++) {
    if (habitDayState(habitLog, habit, addDays(today, -i)) === 'clean') cleanIn30++;
  }

  // The one number that cannot be gamed: it comes from the clock, not from
  // anything you chose to tap.
  let logged = 0;
  let live = 0;
  const breaksBySlot = {};
  for (const day in habitLog || {}) {
    const e = habitLog[day][habit.id];
    if (!e || !e.slots) continue;
    for (const k in e.slots) {
      logged++;
      if (isLive(k, e.slots[k].at)) live++;
      if (e.slots[k].v === 'broke') breaksBySlot[k] = (breaksBySlot[k] || 0) + 1;
    }
  }

  return {
    current,
    longest,
    cleanIn30,
    breaksBySlot,
    liveRate: logged ? Math.round((live / logged) * 100) : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/habits.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/habits.js tests/habits.test.js
git commit -m "Derive habit day state and streaks from the log

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Presets, and the shape of a habit

**Files:**
- Modify: `src/domain/habits.js`
- Modify: `tests/habits.test.js`

**Interfaces:**
- Consumes: `uid`, `todayISO` from `src/domain/domain.js`.
- Produces: `HABIT_PRESETS: Array<{key,name,emoji,kind,rule}>`, `habitFromPreset(presetKey, schedule, todayStr) -> habit`, `newHabit({name, emoji, kind, rule, schedule}, todayStr) -> habit`.

- [ ] **Step 1: Write the failing test**

Append to `tests/habits.test.js`:

```js
import { HABIT_PRESETS, habitFromPreset, newHabit } from '../src/domain/habits.js';

describe('presets', () => {
  it('offers keto as a meals habit and two plain ones', () => {
    expect(HABIT_PRESETS.map((p) => p.key)).toEqual(['keto', 'alcohol', 'sleep']);
    expect(HABIT_PRESETS[0].kind).toBe('meals');
    expect(HABIT_PRESETS[1].kind).toBe('plain');
  });
  it('copies a preset rather than linking to it', () => {
    const h = habitFromPreset('keto', 'daily', '2026-08-13');
    expect(h.name).toBe('Keto');
    expect(h.kind).toBe('meals');
    expect(h.rule).toBe('Any carb breaks the day.');
    expect(h.preset).toBeUndefined();
  });
  it('seeds schedule history so a later change cannot rewrite the past', () => {
    const h = habitFromPreset('keto', [1, 2, 3, 4, 5], '2026-08-13');
    expect(h.scheduleHistory).toEqual([{ effectiveDate: '2026-08-13', schedule: [1, 2, 3, 4, 5] }]);
    expect(h.createdDate).toBe('2026-08-13');
  });
  it('starts active, with a unique id', () => {
    const a = habitFromPreset('keto', 'daily', '2026-08-13');
    const b = habitFromPreset('keto', 'daily', '2026-08-13');
    expect(a.active).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
  it('returns null for a preset that does not exist', () => {
    expect(habitFromPreset('nope', 'daily', '2026-08-13')).toBe(null);
  });
  it('builds a custom habit from scratch, defaulting to plain', () => {
    const h = newHabit({ name: 'No fizzy drinks', emoji: '🥤', schedule: 'daily' }, '2026-08-13');
    expect(h.kind).toBe('plain');
    expect(h.name).toBe('No fizzy drinks');
    expect(h.scheduleHistory[0].effectiveDate).toBe('2026-08-13');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/habits.test.js`
Expected: FAIL — `HABIT_PRESETS` is not exported.

- [ ] **Step 3: Write minimal implementation**

Extend the import at the top of `src/domain/habits.js` to:

```js
import { isoDate, addDays, isScheduledOn, uid } from './domain.js';
```

Then append:

```js
/**
 * Activating a preset COPIES it. Nothing links back, deliberately: the moment
 * presets are referenced by id, editing one later mutates habits already living
 * on other people's phones, and we own a sync problem nobody asked for.
 */
export const HABIT_PRESETS = [
  { key: 'keto', name: 'Keto', emoji: '🥑', kind: 'meals', rule: 'Any carb breaks the day.' },
  { key: 'alcohol', name: 'No alcohol', emoji: '🚫', kind: 'plain', rule: 'One drink breaks the day.' },
  { key: 'sleep', name: 'Sleep by 11', emoji: '🌙', kind: 'plain', rule: 'Lights out by 11 PM.' },
];

/**
 * `schedule` and `scheduleHistory` are deliberately the same fields an exercise
 * carries, so isScheduledOn and scheduleEffectiveOn work on a habit unchanged
 * rather than being written twice. History is seeded at creation: changing the
 * days later must never rewrite what the past was judged against.
 */
export function newHabit(fields, todayStr) {
  const schedule = fields.schedule || 'daily';
  return {
    id: uid('hab'),
    name: fields.name || 'Habit',
    emoji: fields.emoji || '✅',
    rule: fields.rule || '',
    kind: fields.kind === 'meals' ? 'meals' : 'plain',
    schedule,
    scheduleHistory: [{ effectiveDate: todayStr, schedule }],
    createdDate: todayStr,
    active: true,
  };
}

export function habitFromPreset(presetKey, schedule, todayStr) {
  const p = HABIT_PRESETS.find((x) => x.key === presetKey);
  if (!p) return null;
  return newHabit({ name: p.name, emoji: p.emoji, kind: p.kind, rule: p.rule, schedule }, todayStr);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/habits.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/habits.js tests/habits.test.js
git commit -m "Add habit presets that copy rather than link

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Sync — two new keys and a merge that cannot lose a meal

**Files:**
- Modify: `src/domain/domain.js` (`SNAPSHOT_DATA_KEYS` at line 982, `mergeSyncSnapshots` at line 988)
- Modify: `tests/domain.test.js`

**Interfaces:**
- Consumes: `mergeExerciseLists` (already private in `domain.js`, union by id — generic, reused for habits unchanged).
- Produces: `mergeHabitLogs(winner, loser) -> habitLog` (exported for testing), `SNAPSHOT_DATA_KEYS` now including `'habits'` and `'habitLog'`, and `mergeSyncSnapshots` returning both keys.

- [ ] **Step 1: Write the failing test**

Append to `tests/domain.test.js` (add `mergeHabitLogs` and `SNAPSHOT_DATA_KEYS` to the existing import from `../src/domain/domain.js`):

```js
describe('mergeHabitLogs', () => {
  const slot = (v, at) => ({ v, at });

  it('keeps slots logged on different phones on the same day', () => {
    const a = { '2026-08-13': { h1: { slots: { breakfast: slot('kept', 100) } } } };
    const b = { '2026-08-13': { h1: { slots: { dinner: slot('broke', 200) } } } };
    const out = mergeHabitLogs(a, b);
    expect(Object.keys(out['2026-08-13'].h1.slots).sort()).toEqual(['breakfast', 'dinner']);
  });

  it('takes the earlier tap when both sides hold the same slot', () => {
    // Immutability makes this conflict-free: it is the same tap, so the earlier
    // timestamp is the one that actually happened.
    const a = { '2026-08-13': { h1: { slots: { lunch: slot('kept', 500) } } } };
    const b = { '2026-08-13': { h1: { slots: { lunch: slot('broke', 200) } } } };
    expect(mergeHabitLogs(a, b)['2026-08-13'].h1.slots.lunch).toEqual(slot('broke', 200));
    expect(mergeHabitLogs(b, a)['2026-08-13'].h1.slots.lunch).toEqual(slot('broke', 200));
  });

  it('keeps two habits on the same day apart', () => {
    const a = { '2026-08-13': { h1: { slots: { lunch: slot('kept', 100) } } } };
    const b = { '2026-08-13': { h2: { slots: { lunch: slot('broke', 100) } } } };
    const out = mergeHabitLogs(a, b);
    expect(out['2026-08-13'].h1.slots.lunch.v).toBe('kept');
    expect(out['2026-08-13'].h2.slots.lunch.v).toBe('broke');
  });

  it('lets a real log beat an off-plan day, so nothing logged is ever hidden', () => {
    const a = { '2026-08-13': { h1: { off: true, slots: {} } } };
    const b = { '2026-08-13': { h1: { slots: { lunch: slot('kept', 100) } } } };
    const out = mergeHabitLogs(a, b);
    expect(out['2026-08-13'].h1.off).toBeFalsy();
    expect(out['2026-08-13'].h1.slots.lunch.v).toBe('kept');
  });

  it('keeps an off-plan day that nothing contradicts', () => {
    const a = { '2026-08-13': { h1: { off: true, slots: {} } } };
    expect(mergeHabitLogs(a, {})['2026-08-13'].h1.off).toBe(true);
  });

  it('survives either side being missing', () => {
    expect(mergeHabitLogs(undefined, undefined)).toEqual({});
  });
});

describe('habits in the sync snapshot', () => {
  it('lists both new keys, so a habit change actually pushes', () => {
    expect(SNAPSHOT_DATA_KEYS).toContain('habits');
    expect(SNAPSHOT_DATA_KEYS).toContain('habitLog');
  });

  it('unions habits by id and merges their log', () => {
    const local = {
      updatedAt: 2, exercises: [], setsLog: {}, timersLog: {}, profile: {}, streakOverrides: {},
      habits: [{ id: 'h1', name: 'Keto' }],
      habitLog: { '2026-08-13': { h1: { slots: { lunch: { v: 'kept', at: 1 } } } } },
    };
    const remote = {
      updatedAt: 1, exercises: [], setsLog: {}, timersLog: {}, profile: {}, streakOverrides: {},
      habits: [{ id: 'h2', name: 'No alcohol' }],
      habitLog: { '2026-08-13': { h1: { slots: { dinner: { v: 'broke', at: 2 } } } } },
    };
    const out = mergeSyncSnapshots(local, remote);
    expect(out.habits.map((h) => h.id).sort()).toEqual(['h1', 'h2']);
    expect(Object.keys(out.habitLog['2026-08-13'].h1.slots).sort()).toEqual(['dinner', 'lunch']);
  });

  it('reads an old snapshot that has neither key as empty, never fatal', () => {
    const old = { updatedAt: 1, exercises: [], setsLog: {}, timersLog: {}, profile: {}, streakOverrides: {} };
    const out = mergeSyncSnapshots(old, old);
    expect(out.habits).toEqual([]);
    expect(out.habitLog).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain.test.js`
Expected: FAIL — `mergeHabitLogs` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/domain/domain.js`, immediately after `mergeExerciseLists` (which ends at line 897), insert:

```js
/**
 * Day → habit → slot. mergeByDayKey cannot be reused here: it merges one level
 * deep, so the winning phone's habit entry would replace the loser's entire slot
 * set and silently bin meals logged on the other device — the same class of
 * mistake that once destroyed an avatar.
 *
 * Because a logged slot can never be changed, this merge is conflict-free by
 * construction: where both sides hold a value it is the same tap, and the
 * earlier timestamp is the one that happened. Off plan is only possible on a day
 * with nothing logged, so any real slot beats it and the invariant holds.
 */
export function mergeHabitLogs(winner, loser) {
  const out = {};
  const days = new Set([...Object.keys(loser || {}), ...Object.keys(winner || {})]);
  days.forEach((d) => {
    const w = (winner || {})[d] || {};
    const l = (loser || {})[d] || {};
    const dayMap = {};
    new Set([...Object.keys(l), ...Object.keys(w)]).forEach((id) => {
      const we = w[id] || {};
      const le = l[id] || {};
      const slots = { ...(le.slots || {}) };
      Object.entries(we.slots || {}).forEach(([k, s]) => {
        if (!slots[k] || s.at < slots[k].at) slots[k] = s;
      });
      if (Object.keys(slots).length) dayMap[id] = { slots };
      else if (we.off || le.off) dayMap[id] = { off: true, slots: {} };
    });
    if (Object.keys(dayMap).length) out[d] = dayMap;
  });
  return out;
}
```

Replace `SNAPSHOT_DATA_KEYS` (line 982) with:

```js
export const SNAPSHOT_DATA_KEYS = ['exercises', 'deletedExercises', 'setsLog', 'timersLog', 'profile', 'streakOverrides', 'habits', 'habitLog'];
```

In `mergeSyncSnapshots`, add two lines to the returned object, after `profile`:

```js
    profile: mergeProfiles(winner.profile, loser.profile),
    // Habits are archived, never deleted, so they need no tombstone key — the
    // union by id is the whole story.
    habits: mergeExerciseLists(winner.habits, loser.habits),
    habitLog: mergeHabitLogs(winner.habitLog, loser.habitLog),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/domain.js tests/domain.test.js
git commit -m "Sync habits and their log without losing a meal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: State and persistence in main.js

**Files:**
- Modify: `src/main.js` — `state` (line 74), `loadAll` (line 183), the `persist*` block (lines 242–297), `buildSyncSnapshot` (line 303), `applyMergedSnapshot` (line 317)

**Interfaces:**
- Consumes: everything exported from `src/domain/habits.js`.
- Produces: `state.habits: Array`, `state.habitLog: Object`, `persistHabits() -> Promise<boolean>`, `persistHabitLog() -> Promise<boolean>`. IndexedDB keys are `habits` and `habit-log`.

There is no test for this task — `main.js` has no test coverage. It is verified by loading the app in Task 9.

- [ ] **Step 1: Add the imports**

At the top of `src/main.js`, add a new import beside the existing `domain.js` / `stats.js` imports:

```js
import {
  HABIT_SLOTS, HABIT_BLOCKS, HABIT_PRESETS, PLAIN_SLOT,
  slotsFor, habitDay, blockAt, blockOf, isLive,
  slotAt, hasAnySlot, isOffPlan, logSlot, setOffPlan,
  habitDayState, habitStats, habitFromPreset, newHabit,
} from './domain/habits.js';
```

- [ ] **Step 2: Add the state**

In the `state` object (line 74), after `streakOverrides: {},` add:

```js
  habits: [],
  habitLog: {},
```

- [ ] **Step 3: Load them**

In `loadAll` (line 183), extend the destructuring and the `Promise.all` to include the two new keys, and set them on state. The array becomes:

```js
  const [exercises, setsLog, meta, timersLog, profile, streakOverrides, deletedExercises, habits, habitLog] = await Promise.all([
    db.getItem('exercises'),
    db.getItem('sets-log'),
    db.getItem('app-meta'),
    db.getItem('timers-log'),
    db.getItem('profile'),
    db.getItem('streak-overrides'),
    db.getItem('deleted-exercises'),
    db.getItem('habits'),
    db.getItem('habit-log'),
  ]);
```

and after `state.deletedExercises = deletedExercises || {};` add:

```js
  // Absent reads as empty. Optional data must never be able to kill a screen.
  state.habits = habits || [];
  state.habitLog = habitLog || {};
```

- [ ] **Step 4: Add the persisters**

After `persistStreakOverrides` (ends line 297), add:

```js
async function persistHabits() {
  try {
    await db.setItem('habits', state.habits);
    markDirty();
    return true;
  } catch (e) {
    return false;
  }
}
async function persistHabitLog() {
  try {
    await db.setItem('habit-log', state.habitLog);
    markDirty();
    return true;
  } catch (e) {
    return false;
  }
}
```

- [ ] **Step 5: Put them in the snapshot**

In `buildSyncSnapshot` (line 303), add after `streakOverrides: state.streakOverrides,`:

```js
    habits: state.habits,
    habitLog: state.habitLog,
```

In `applyMergedSnapshot` (line 317), add after `state.streakOverrides = merged.streakOverrides || {};`:

```js
  state.habits = merged.habits || [];
  state.habitLog = merged.habitLog || {};
```

and add to its `Promise.all` array:

```js
    db.setItem('habits', state.habits),
    db.setItem('habit-log', state.habitLog),
```

- [ ] **Step 6: Verify the app still loads**

Run: `npm run build`
Expected: build succeeds with no errors.

Then start the dev server and confirm the app renders as before with no console errors — habits are not on screen yet, so nothing should look different.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "Carry habits and their log through state, storage and sync

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Adding a habit from the Plan tab

**Files:**
- Modify: `src/main.js` — `renderModal` (line 3520), the action switch (`open-add-exercise` at line 4705), the Plan add button (line 2360)
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `HABIT_PRESETS`, `habitFromPreset`, `newHabit`, `persistHabits` from Tasks 4 and 6.
- Produces: modal types `'addChoice'` and `'habitForm'`; actions `open-add`, `add-kind`, `pick-habit-preset`, `save-habit`, `habit-day` (weekday toggle), `habit-sched-mode`.

- [ ] **Step 1: Replace the Add button with a chooser**

At line 2360, change `data-action="open-add-exercise"` to `data-action="open-add"`. Leave the two empty-state buttons (lines 2606 and 3159) pointing at `open-add-exercise` — those say "Add your first exercise" and "Add an exercise", so they should go straight to the exercise form.

- [ ] **Step 2: Add the chooser modal**

Add these two functions near `modalExerciseForm`:

```js
function modalAddChoice() {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>Add</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <button class="add-kind" data-action="add-kind" data-kind="exercise">
        <b>Exercise</b><span>Reps or time, with a target and a streak.</span>
      </button>
      <button class="add-kind" data-action="add-kind" data-kind="habit">
        <b>Health habit</b><span>Every day, no target. Keep it clean, keep the streak.</span>
      </button>
    </div>
  </div>`;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function modalHabitForm() {
  const m = state.modal || {};
  const preset = m.preset || null;
  const p = HABIT_PRESETS.find((x) => x.key === preset) || null;
  const name = m.name !== undefined ? m.name : (p ? p.name : '');
  const emoji = m.emoji !== undefined ? m.emoji : (p ? p.emoji : '✅');
  const kind = m.kind || (p ? p.kind : 'plain');
  const daily = m.days === undefined || m.days === 'daily';
  const days = Array.isArray(m.days) ? m.days : [];
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>Add health habit</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <div class="field">
        <label>Start from</label>
        <div class="preset-grid">
          ${HABIT_PRESETS.map((x) => `<button type="button" class="preset-chip ${x.key === preset ? 'on' : ''}" data-action="pick-habit-preset" data-preset="${x.key}" aria-pressed="${x.key === preset}">
            <span class="preset-emoji">${x.emoji}</span><span>${escapeHtml(x.name)}</span>
          </button>`).join('')}
          <button type="button" class="preset-chip ${preset ? '' : 'on'}" data-action="pick-habit-preset" data-preset="" aria-pressed="${!preset}">
            <span class="preset-emoji">✏️</span><span>Custom</span>
          </button>
        </div>
        ${p ? `<div class="hint">${escapeHtml(p.rule)} You can edit any of this — it is copied, not linked.</div>` : ''}
      </div>
      <div class="field">
        <label>Name</label>
        <input id="f-habit-name" type="text" placeholder="e.g. Keto" value="${escapeHtml(name)}" autocomplete="off">
      </div>
      <div class="field">
        <label>Emoji</label>
        <input id="f-habit-emoji" type="text" maxlength="4" value="${escapeHtml(emoji)}" autocomplete="off">
      </div>
      <div class="field">
        <label>How you track it</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${kind === 'plain' ? 'on' : ''}" data-action="habit-kind" data-kind="plain">One tap a day</button>
          <button type="button" class="sched-mode ${kind === 'meals' ? 'on' : ''}" data-action="habit-kind" data-kind="meals">Meal by meal</button>
        </div>
        <div class="hint">${kind === 'meals'
          ? 'Six slots — breakfast, lunch, dinner and the snacks between them. Any break, and the day is broken.'
          : 'One decision for the whole day.'}</div>
      </div>
      <div class="field">
        <label>Days</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${daily ? 'on' : ''}" data-action="habit-sched-mode" data-mode="daily">Every day</button>
          <button type="button" class="sched-mode ${daily ? '' : 'on'}" data-action="habit-sched-mode" data-mode="days">Chosen days</button>
        </div>
        ${daily ? '' : `<div class="day-picker">
          ${WEEKDAY_NAMES.map((n, i) => `<button type="button" class="day-chip ${days.includes(i) ? 'on' : ''}" data-action="habit-day" data-day="${i}" aria-pressed="${days.includes(i)}">${n}</button>`).join('')}
        </div>`}
        <div class="hint">A day it is not scheduled for is neutral — never a break.</div>
      </div>
      <div class="field">
        <div class="hint">No target. A day is clean unless something breaks it, and once you tap a slot it is final.</div>
      </div>
      <button class="primary-btn wide" data-action="save-habit">Add habit</button>
    </div>
  </div>`;
}
```

- [ ] **Step 3: Register the modals**

In `renderModal` (line 3520), after the `exerciseForm` line add:

```js
  else if (m.type === 'addChoice') root.innerHTML = modalAddChoice();
  else if (m.type === 'habitForm') root.innerHTML = modalHabitForm();
```

- [ ] **Step 4: Wire the actions**

Add a helper next to the other draft-capture functions:

```js
/** Reads the habit form's text inputs into modal state, so the re-renders the
 *  chips cause do not wipe what has been typed. Same reason captureExerciseDraft
 *  exists. */
function captureHabitDraft() {
  if (!state.modal) return;
  const n = document.getElementById('f-habit-name');
  const e = document.getElementById('f-habit-emoji');
  if (n) state.modal.name = n.value;
  if (e) state.modal.emoji = e.value;
}
```

In the action switch, beside `case 'open-add-exercise'`, add:

```js
    case 'open-add': state.modal = { type: 'addChoice' }; renderModal(); break;
    case 'add-kind':
      state.modal = btn.dataset.kind === 'habit'
        ? { type: 'habitForm', preset: 'keto', days: 'daily' }
        : { type: 'exerciseForm', exId: null };
      renderModal();
      break;
    case 'pick-habit-preset': {
      const key = btn.dataset.preset || null;
      const p = HABIT_PRESETS.find((x) => x.key === key) || null;
      // Picking a preset refills the form. It is a starting form, not a link.
      state.modal = { type: 'habitForm', preset: key, days: state.modal.days, kind: p ? p.kind : 'plain', name: p ? p.name : '', emoji: p ? p.emoji : '✅' };
      renderModal();
      break;
    }
    case 'habit-kind':
      captureHabitDraft();
      state.modal.kind = btn.dataset.kind === 'meals' ? 'meals' : 'plain';
      renderModal();
      break;
    case 'habit-sched-mode':
      captureHabitDraft();
      state.modal.days = btn.dataset.mode === 'daily' ? 'daily' : [];
      renderModal();
      break;
    case 'habit-day': {
      captureHabitDraft();
      const d = Number(btn.dataset.day);
      const cur = Array.isArray(state.modal.days) ? state.modal.days : [];
      state.modal.days = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
      renderModal();
      break;
    }
    case 'save-habit': {
      captureHabitDraft();
      const m = state.modal;
      const name = (m.name || '').trim();
      if (!name) return;
      const schedule = Array.isArray(m.days) ? (m.days.length ? m.days.slice().sort((a, b) => a - b) : 'daily') : 'daily';
      const preset = HABIT_PRESETS.find((x) => x.key === m.preset) || null;
      const habit = newHabit({
        name,
        emoji: (m.emoji || '✅').trim() || '✅',
        kind: m.kind || 'plain',
        rule: preset && preset.name === name ? preset.rule : '',
        schedule,
      }, todayISO());
      state.habits = [...state.habits, habit];
      await persistHabits();
      closeModal();
      renderView();
      break;
    }
```

> Note: `habitFromPreset` is not called here — the form always goes through `newHabit`, because the user may have edited the name, emoji, kind or schedule before saving. Keep the export; it is covered by tests and documents the copy-not-link rule.

- [ ] **Step 5: Add the styles**

Append to `src/style.css`:

```css
.add-kind {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
  width: 100%; padding: 16px; margin-bottom: 10px; min-height: 44px;
  background: var(--surface-2); border: 1px solid var(--line); border-radius: 14px;
  color: var(--text); text-align: left; font: inherit;
}
.add-kind b { font-size: 1.05rem; }
.add-kind span { color: var(--muted); font-size: .85rem; }
.preset-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.preset-chip {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 4px; min-height: 44px;
  background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px;
  color: var(--muted); font-size: .72rem; line-height: 1.15; text-align: center;
}
.preset-chip.on { border-color: var(--accent); color: var(--text); }
.preset-emoji { font-size: 1.3rem; }
.day-picker { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-top: 8px; }
.day-chip {
  min-height: 44px; padding: 4px; border-radius: 10px; font-size: .72rem;
  background: var(--surface-2); border: 1px solid var(--line); color: var(--muted);
}
.day-chip.on { border-color: var(--accent); color: var(--text); }
```

If `--surface-2`, `--line`, `--muted`, `--accent` or `--text` are not the names this stylesheet actually uses, read the top of `src/style.css` and substitute the real custom properties. Do not introduce new colours.

- [ ] **Step 6: Verify by using it**

Start the dev server, open Plan at 375px width, tap **Add** → **Health habit**. Confirm: Keto is preselected, switching to Custom empties the name, "Chosen days" reveals seven day chips, typing a name then tapping a chip does not wipe the name, and saving adds the habit. Check every tap target is at least 44px and nothing overflows horizontally.

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/style.css
git commit -m "Let Plan add a health habit as well as an exercise

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The habit card on Today

**Files:**
- Modify: `src/main.js` — `viewToday` (the `html += weighInCardHtml();` line at 2709), the action switch
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `habitDay`, `blockAt`, `slotsFor`, `slotAt`, `isLive`, `isOffPlan`, `logSlot`, `setOffPlan`, `habitDayState`, `habitStats`, `HABIT_BLOCKS`, `PLAIN_SLOT` from Tasks 1–4; `persistHabitLog` from Task 6.
- Produces: actions `log-slot`, `habit-off-plan`.

- [ ] **Step 1: Render the cards**

Add near `weighInCardHtml`:

```js
const SLOT_MARK = { kept: '✓', skip: '–', broke: '✕' };

function slotPillHtml(habit, day, slot, canLog) {
  const rec = slotAt(state.habitLog, day, habit.id, slot.key);
  if (rec) {
    // Filled means logged inside its own window; hollow means caught up later.
    // Derived from the clock, so it is the one mark that cannot be tapped into
    // existence after the fact.
    const live = isLive(slot.key, rec.at);
    return `<div class="slot-pill done ${rec.v} ${live ? 'live' : 'late'}" title="${live ? 'Logged in the moment' : 'Logged later'}">
      <span class="slot-mark">${SLOT_MARK[rec.v]}</span><span>${escapeHtml(slot.label)}</span>
    </div>`;
  }
  if (!canLog) return `<div class="slot-pill empty"><span class="slot-mark">·</span><span>${escapeHtml(slot.label)}</span></div>`;
  return `<div class="slot-row">
    <span class="slot-name">${escapeHtml(slot.label)}</span>
    <span class="slot-btns">
      <button class="slot-btn kept" data-action="log-slot" data-id="${habit.id}" data-slot="${slot.key}" data-v="kept">Kept</button>
      <button class="slot-btn skip" data-action="log-slot" data-id="${habit.id}" data-slot="${slot.key}" data-v="skip">Skipped</button>
      <button class="slot-btn broke" data-action="log-slot" data-id="${habit.id}" data-slot="${slot.key}" data-v="broke">Broke</button>
    </span>
  </div>`;
}

function habitCardHtml(habit, day, nowMs) {
  const st = habitDayState(state.habitLog, habit, day);
  const stats = habitStats(state.habitLog, habit, day);
  const off = isOffPlan(state.habitLog, day, habit.id);
  const untouched = !hasAnySlot(state.habitLog, day, habit.id);
  const nowBlock = blockAt(nowMs);

  let body;
  if (off) {
    body = `<div class="habit-off">🌙 Off plan today — the streak holds.</div>`;
  } else if (habit.kind === 'meals') {
    body = HABIT_BLOCKS.map((b) => {
      const slots = HABIT_SLOTS.filter((s) => s.block === b.key);
      const isNow = b.key === nowBlock.key;
      const done = slots.every((s) => slotAt(state.habitLog, day, habit.id, s.key));
      const cls = isNow ? 'now' : (done ? 'done' : 'other');
      return `<div class="habit-block-row ${cls}">
        <div class="habit-block-name">${b.label}<span>${b.window}</span></div>
        <div class="habit-slots">${slots.map((s) => slotPillHtml(habit, day, s, true)).join('')}</div>
      </div>`;
    }).join('');
  } else {
    body = `<div class="habit-slots">${slotPillHtml(habit, day, slotsFor(habit)[0], true)}</div>`;
  }

  // Between midnight and 5 AM the habit day and the calendar day disagree. Say
  // so, or the card looks broken.
  const nightNote = day !== todayISO()
    ? `<div class="habit-night">Still ${escapeHtml(formatDisplayDate(day, { weekday: 'long' }))} night — a habit day runs 5 AM to 5 AM.</div>`
    : '';

  const stateLabel = st === 'broken' ? 'Broken today'
    : st === 'clean' ? 'Clean today'
    : st === 'off' ? 'Off plan'
    : 'Nothing logged yet';

  return `<div class="habit-card-full state-${st}">
    <div class="habit-head">
      <span class="habit-emoji">${habit.emoji || '✅'}</span>
      <div class="habit-title"><b>${escapeHtml(habit.name)}</b><span>${stateLabel}</span></div>
      <span class="habit-streak">🔥 ${stats.current}</span>
    </div>
    ${habit.rule ? `<div class="habit-rule">${escapeHtml(habit.rule)}</div>` : ''}
    ${nightNote}
    ${body}
    ${untouched && !off ? `<button class="habit-offbtn" data-action="habit-off-plan" data-id="${habit.id}" data-on="1">Take today off plan</button>` : ''}
    ${off ? `<button class="habit-offbtn" data-action="habit-off-plan" data-id="${habit.id}" data-on="0">Actually, I'm on it</button>` : ''}
  </div>`;
}

function habitsSectionHtml() {
  const nowMs = Date.now();
  const day = habitDay(nowMs);
  const active = state.habits.filter((h) => h.active && isScheduledOn(h, day));
  if (!active.length) return '';
  return `<div class="section-label">Health habits</div>`
    + active.map((h) => habitCardHtml(h, day, nowMs)).join('');
}
```

- [ ] **Step 2: Put the section on Today**

At line 2709, change:

```js
  html += weighInCardHtml();
```

to:

```js
  html += habitsSectionHtml();
  html += weighInCardHtml();
```

- [ ] **Step 3: Wire the actions**

In the action switch, add:

```js
    case 'log-slot': {
      const nowMs = Date.now();
      const day = habitDay(nowMs);
      const before = state.habitLog;
      state.habitLog = logSlot(before, day, btn.dataset.id, btn.dataset.slot, btn.dataset.v, nowMs);
      // The guard returns the same object when a write is refused, so there is
      // nothing to save and nothing to redraw.
      if (state.habitLog === before) break;
      await persistHabitLog();
      renderView();
      break;
    }
    case 'habit-off-plan': {
      const nowMs = Date.now();
      const day = habitDay(nowMs);
      const before = state.habitLog;
      state.habitLog = setOffPlan(before, day, btn.dataset.id, btn.dataset.on === '1', nowMs);
      if (state.habitLog === before) break;
      await persistHabitLog();
      renderView();
      break;
    }
```

- [ ] **Step 4: Add the styles**

Append to `src/style.css`:

```css
.habit-card-full {
  padding: 14px; margin-bottom: 12px; border-radius: 16px;
  background: var(--surface-2); border: 1px solid var(--line);
}
.habit-card-full.state-clean { border-color: var(--good, #3ddc84); }
.habit-card-full.state-broken { border-color: var(--bad, #ff5c5c); }
.habit-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.habit-emoji { font-size: 1.6rem; }
.habit-title { flex: 1; display: flex; flex-direction: column; }
.habit-title span { color: var(--muted); font-size: .8rem; }
.habit-streak { font-variant-numeric: tabular-nums; }
.habit-rule, .habit-night, .habit-off { color: var(--muted); font-size: .8rem; margin-bottom: 8px; }
.habit-block-row { padding: 8px 0; border-top: 1px solid var(--line); }
.habit-block-row.other { opacity: .55; }
.habit-block-name { display: flex; justify-content: space-between; font-size: .78rem; color: var(--muted); margin-bottom: 6px; }
.habit-slots { display: flex; flex-direction: column; gap: 6px; }
.slot-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.slot-name { flex: 1; min-width: 96px; font-size: .9rem; }
.slot-btns { display: flex; gap: 6px; }
.slot-btn {
  min-height: 44px; min-width: 44px; padding: 0 10px; border-radius: 10px;
  background: var(--surface); border: 1px solid var(--line); color: var(--muted); font-size: .78rem;
}
.slot-btn.kept { color: var(--good, #3ddc84); }
.slot-btn.broke { color: var(--bad, #ff5c5c); }
.slot-pill {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  padding: 8px 12px; min-height: 44px; border-radius: 999px; font-size: .82rem;
  border: 1px solid var(--line);
}
/* Filled means logged in its own window; hollow means caught up later. */
.slot-pill.live { background: var(--surface); }
.slot-pill.late { background: transparent; border-style: dashed; }
.slot-pill.kept .slot-mark { color: var(--good, #3ddc84); }
.slot-pill.broke .slot-mark { color: var(--bad, #ff5c5c); }
.slot-pill.empty { opacity: .5; }
.habit-offbtn {
  margin-top: 10px; min-height: 44px; width: 100%; border-radius: 12px;
  background: transparent; border: 1px dashed var(--line); color: var(--muted); font-size: .82rem;
}
```

- [ ] **Step 5: Verify by using it**

At 375px: add a Keto habit, confirm Today shows three blocks with the current one prominent. Tap Lunch → Kept and confirm the pill fills and the buttons are gone. **Tap the same slot region again and confirm there is no way to change it.** Tap Dinner → Broke and confirm the card turns to the broken state without reloading. Confirm "Take today off plan" disappears the moment anything is logged. Reload and confirm everything survived.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/style.css
git commit -m "Put the day's habit slots on Today, block by block

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The habit block on Progress, and the guide line

**Files:**
- Modify: `src/main.js` — `viewProgress` (line 3248)
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `habitStats`, `habitDayState`, `habitDay`, `HABIT_SLOTS` from Tasks 1–4.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Render the block**

Add near `weighInBlockHtml`:

```js
function habitProgressHtml() {
  const day = habitDay(Date.now());
  const active = state.habits.filter((h) => h.active);
  if (!active.length) return '';
  return active.map((h) => {
    const s = habitStats(state.habitLog, h, day);
    const strip = Array.from({ length: 30 }, (_, i) => {
      const d = addDays(day, -(29 - i));
      return `<span class="hstrip-cell ${habitDayState(state.habitLog, h, d)}" title="${d}"></span>`;
    }).join('');
    const worst = Object.entries(s.breaksBySlot).sort((a, b) => b[1] - a[1])[0];
    const worstLabel = worst ? (HABIT_SLOTS.find((x) => x.key === worst[0]) || {}).label : null;
    return `<div class="habit-block">
      <div class="habit-block-head">
        <span class="section-label">${h.emoji || '✅'} ${escapeHtml(h.name)}</span>
        <span class="habit-tag">health habit</span>
      </div>
      <div class="hstrip">${strip}</div>
      <div class="bmi-line">🔥 ${s.current} day${s.current === 1 ? '' : 's'} · longest ${s.longest} · ${s.cleanIn30} clean in the last 30</div>
      ${s.liveRate != null ? `<div class="bmi-line">Logged in the moment — ${s.liveRate}%</div>` : ''}
      ${worstLabel && worst[1] > 1 ? `<div class="bmi-line">Breaks most at <b>${escapeHtml(worstLabel)}</b> — ${worst[1]} times.</div>` : ''}
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: Put it on Progress**

At line 3248, change:

```js
  const habit = weighInBlockHtml();
```

to:

```js
  // Habits are not exercises, so an empty plan must not hide them — same reason
  // the weigh-in block sits outside the groups.
  const habit = habitProgressHtml() + weighInBlockHtml();
```

The existing `if (!activeEx.length) return habit || ...` line below it then covers habits for free.

- [ ] **Step 3: Add the styles**

Append to `src/style.css`:

```css
.hstrip { display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; margin: 8px 0; }
.hstrip-cell { height: 18px; border-radius: 3px; background: var(--line); }
.hstrip-cell.clean { background: var(--good, #3ddc84); }
.hstrip-cell.broken { background: var(--bad, #ff5c5c); }
.hstrip-cell.off { background: transparent; border: 1px solid var(--line); }
```

- [ ] **Step 4: Verify by using it**

At 375px, open Progress with a habit that has a few days of history. Confirm the 30-cell strip does not overflow horizontally, the streak line reads correctly, and the "breaks most at" line only appears once a slot has broken more than once.

- [ ] **Step 5: Add the guide entry**

In `src/guide.js`, add a step describing health habits: they are recurring and targetless, a day is clean unless something breaks it, a skipped meal costs nothing, once a slot is tapped it is final, a habit day runs 5 AM to 5 AM, and off plan can only be set on a day nothing has been logged on. Match the surrounding entries' shape exactly — read two of them first.

- [ ] **Step 6: Run everything**

Run: `npm test`
Expected: PASS, all tests.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/style.css src/guide.js
git commit -m "Show a habit's streak, strip and where it breaks on Progress

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Update the handoff and deploy

**Files:**
- Modify: `docs/SESSION-HANDOFF.md`

- [ ] **Step 1: Update the feature map**

Add a **Health habits** row to the feature map table, and correct the existing "Health habit" row so it is clearly about the weigh-in only. Record in "Hard-won facts": the 5 AM habit day, that a logged slot is immutable and that off plan is refused once anything is logged (with the laundering reason), and that `mergeByDayKey` is one level too shallow for `habitLog`.

- [ ] **Step 2: Update the state section**

Set `main` to the new commit and the test count to whatever `npm test` now reports.

- [ ] **Step 3: Commit and push**

```bash
git add docs/SESSION-HANDOFF.md
git commit -m "Bring the handoff up to date for health habits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Byte-verify the deploy**

Wait for Vercel, then build the **pushed** commit locally and compare hashes — `__BUILD_ID__` is the commit SHA, so a build made before committing can never match. Never grep minified output.

```bash
npm run build && shasum dist/assets/*.js
```

Compare against the live asset. Then tell the user to run **Backup & data → Force update now** on their phone.

---

## Self-Review

**Spec coverage:** 5 AM day → Task 1. Slot/day states → Tasks 1, 3. Immutability and the off-plan guard → Task 2. Live vs late → Tasks 1, 3, 8. Presets as a copy → Task 4. Two shapes → Tasks 1, 4, 7. Data shape and archive-not-delete → Tasks 4, 5, 6. Pure layer → Tasks 1–4. Sync → Tasks 5, 6. UI (Plan / Today / Progress) → Tasks 7, 8, 9. Not on the crew card → no task touches `buildCrewCard` or `sanitiseCard`, by construction. Testing → Tasks 1–5 plus the by-using checks in 7–9.

**Type consistency:** `habitDayState` returns `'clean'|'broken'|'neutral'|'off'` and is consumed with those exact strings in Tasks 8 and 9 (`state-${st}` and the strip cell classes, whose CSS covers `clean`, `broken` and `off`; `neutral` falls through to the default cell background deliberately). `habitStats` returns `{current, longest, cleanIn30, liveRate, breaksBySlot}` and Task 9 reads exactly those. `logSlot`/`setOffPlan` return the same reference when refused, which Task 8 relies on.

**Known gap, deliberate:** there is no edit or archive path for a habit once created — the spec's archive-not-delete rule describes the data shape rather than a screen. Adding one is a follow-up, not part of this plan.
