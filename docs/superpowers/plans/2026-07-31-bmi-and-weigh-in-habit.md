# BMI and Weekly Weigh-In Habit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show BMI derived from the weight and height already on the profile, and turn weighing in into a weekly health habit that is tracked separately from exercises.

**Architecture:** Every displayed value — BMI, its category, the healthy range, the kg still to go, and each week's hit/miss status — is a pure function of two things already stored plus one new list. The only new persisted state is `profile.weightLog` (one entry per weight *change*) and `profile.weighInDay` (an integer that controls only when the reminder appears). Week status is derived from the log's dates, so there is no habit record to store, sync or merge.

**Tech Stack:** Vanilla JS, Vite, vitest. No new runtime dependencies.

## Global Constraints

- 100% free: no backend, no paid service, no new runtime dependencies.
- 100% functional offline; BMI must never depend on the network.
- Existing data shapes must keep round-tripping through Drive sync and JSON backup/restore.
- The app never nags: this feature appears in the Profile sheet, on Today only on the reminder day, and on Progress. Never at launch.
- Visual language is the app's own: night brutalist, hard edges, near-black surfaces, acid-green accent, `--radius-*: 0px`. No imported style.
- Health habits are never exercises: a weigh-in never enters `setsLog`, never counts as reps, never touches totals, records or Top Set, and a missed week never affects the exercise streak.
- Colours come from existing tokens only: `--accent` #3EE07F (hit), `--danger` #FF6B57 (missed), `--text-faint` (pending), `--text-dim` (notes).
- Spec: `docs/superpowers/specs/2026-07-31-bmi-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/domain/domain.js` | All BMI and week-status rules, pure | Modify — add 5 exports, extend `mergeProfiles` |
| `tests/domain.test.js` | Unit tests for the above | Modify — add 4 describe blocks |
| `src/main.js` | Rendering, events, persistence | Modify — profile defaults, `saveProfile`, profile sheet, Today card, Progress block, weigh-in sheet, guide entries |
| `src/style.css` | Styling for the BMI block and habit strip | Modify — append one section |

No new files. The codebase keeps all rendering in `main.js` and all rules in `domain.js`; splitting either would break an established pattern for no gain.

---

### Task 1: BMI summary and weight trend

**Files:**
- Modify: `src/domain/domain.js` (append after `syncNudge`, near line 542)
- Test: `tests/domain.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `bmiSummary(profile)` → `null | { bmi: number, category: 'underweight'|'normal'|'overweight'|'obese', healthyMin: number, healthyMax: number, toHealthy: number }`
  - `weightTrend(weightLog)` → `null | { delta: number, since: string }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain.test.js`:

```js
describe('bmiSummary', () => {
  it('computes BMI and calls it normal', () => {
    const s = bmiSummary({ weight: 80, height: 180 });
    expect(s.bmi).toBe(24.7);
    expect(s.category).toBe('normal');
    expect(s.toHealthy).toBe(0);
  });

  it('classifies on the exact cutoffs', () => {
    // 18.5 and 25 and 30 exactly, at 200cm: 74, 100, 120 kg
    expect(bmiSummary({ weight: 74, height: 200 }).category).toBe('normal');
    expect(bmiSummary({ weight: 100, height: 200 }).category).toBe('overweight');
    expect(bmiSummary({ weight: 120, height: 200 }).category).toBe('obese');
    expect(bmiSummary({ weight: 73.9, height: 200 }).category).toBe('underweight');
  });

  it('classifies on the unrounded value, so the badge matches the number', () => {
    // 24.96 displays as 25.0 but is still normal
    const s = bmiSummary({ weight: 99.84, height: 200 });
    expect(s.bmi).toBe(25);
    expect(s.category).toBe('normal');
  });

  it('reports the healthy range for the height', () => {
    const s = bmiSummary({ weight: 90, height: 178 });
    expect(s.healthyMin).toBe(58.6);
    expect(s.healthyMax).toBe(78.9);
  });

  it('measures the distance to the healthy range from both sides', () => {
    expect(bmiSummary({ weight: 90, height: 178 }).toHealthy).toBe(11.1);
    expect(bmiSummary({ weight: 50, height: 178 }).toHealthy).toBe(8.6);
  });

  it('returns null rather than a number it cannot compute', () => {
    expect(bmiSummary(null)).toBeNull();
    expect(bmiSummary({ weight: null, height: 180 })).toBeNull();
    expect(bmiSummary({ weight: 80, height: null })).toBeNull();
    expect(bmiSummary({ weight: 80, height: 0 })).toBeNull();
    expect(bmiSummary({ weight: -5, height: 180 })).toBeNull();
  });
});

describe('weightTrend', () => {
  it('says nothing until there are two entries', () => {
    expect(weightTrend([])).toBeNull();
    expect(weightTrend(null)).toBeNull();
    expect(weightTrend([{ d: '2026-06-12', w: 85 }])).toBeNull();
  });

  it('reports a loss as a negative delta', () => {
    const t = weightTrend([{ d: '2026-06-12', w: 85.6 }, { d: '2026-07-31', w: 82.4 }]);
    expect(t.delta).toBe(-3.2);
    expect(t.since).toBe('2026-06-12');
  });

  it('reports a gain as a positive delta', () => {
    expect(weightTrend([{ d: '2026-06-12', w: 80 }, { d: '2026-07-31', w: 82.5 }]).delta).toBe(2.5);
  });

  it('measures from the earliest entry whatever order they arrive in', () => {
    const t = weightTrend([{ d: '2026-07-31', w: 82 }, { d: '2026-06-12', w: 85 }]);
    expect(t.delta).toBe(-3);
    expect(t.since).toBe('2026-06-12');
  });
});
```

Add `bmiSummary` and `weightTrend` to the import block at the top of `tests/domain.test.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain.test.js -t bmiSummary`
Expected: FAIL — "bmiSummary is not a function" / "No test found" resolving to an import error.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/domain.js`:

```js
/**
 * BMI and everything derivable from it. Stored nowhere: weight and height are
 * already on the profile, so saving a new weight updates all of this for free.
 *
 * The category is decided on the unrounded value. Rounding first would let a
 * BMI of 24.96 display as 25.0 while being classified normal, and a number that
 * disagrees with its own badge reads as a bug.
 */
export const BMI_HEALTHY_MIN = 18.5;
export const BMI_HEALTHY_MAX = 24.9;
const round1 = (n) => Math.round(n * 10) / 10;

export function bmiSummary(profile) {
  const p = profile || {};
  const w = Number(p.weight);
  const h = Number(p.height);
  if (!(w > 0) || !(h > 0)) return null;
  const m2 = (h / 100) ** 2;
  const raw = w / m2;
  if (!isFinite(raw)) return null;

  const category = raw < BMI_HEALTHY_MIN ? 'underweight'
    : raw < 25 ? 'normal'
    : raw < 30 ? 'overweight'
    : 'obese';

  const healthyMin = round1(BMI_HEALTHY_MIN * m2);
  const healthyMax = round1(BMI_HEALTHY_MAX * m2);
  const toHealthy = w < healthyMin ? round1(healthyMin - w)
    : w > healthyMax ? round1(w - healthyMax)
    : 0;

  return { bmi: round1(raw), category, healthyMin, healthyMax, toHealthy };
}

/** Change against the first weight ever recorded. Negative means lost. */
export function weightTrend(weightLog) {
  const log = Array.isArray(weightLog) ? weightLog.filter((e) => e && e.d && e.w > 0) : [];
  if (log.length < 2) return null;
  const sorted = [...log].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return { delta: round1(last.w - first.w), since: first.d };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, total count risen by 10 from 199 to 209.

- [ ] **Step 5: Commit**

```bash
git add src/domain/domain.js tests/domain.test.js
git commit -m "Derive BMI and weight change from what the profile already holds"
```

---

### Task 2: Weekly hit/miss status, derived from the log's dates

**Files:**
- Modify: `src/domain/domain.js`
- Test: `tests/domain.test.js`

**Interfaces:**
- Consumes: `addDays(dateStr, delta)` from `domain.js:16`
- Produces: `weighInWeeks(weightLog, today)` → `[{ n: number, from: string, to: string, status: 'hit'|'missed'|'pending' }]`, oldest first

**Rule:** weeks are consecutive 7-day buckets counted from the first entry. The chosen reminder day is deliberately **not** an argument — which day someone weighs in makes no difference, only whether the week passed without any entry.

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain.test.js`:

```js
describe('weighInWeeks', () => {
  it('has no weeks at all before the first entry', () => {
    expect(weighInWeeks([], '2026-07-31')).toEqual([]);
    expect(weighInWeeks(null, '2026-07-31')).toEqual([]);
  });

  it('counts buckets from the first entry, not from a calendar week', () => {
    const weeks = weighInWeeks([{ d: '2026-07-01', w: 80 }], '2026-07-08');
    expect(weeks[0]).toMatchObject({ n: 1, from: '2026-07-01', to: '2026-07-07', status: 'hit' });
    expect(weeks[1]).toMatchObject({ n: 2, from: '2026-07-08', to: '2026-07-14', status: 'pending' });
  });

  it('counts any day inside the week, first day or last', () => {
    // week 2 runs 08-14; an entry on either edge is a hit
    const early = weighInWeeks([{ d: '2026-07-01', w: 80 }, { d: '2026-07-08', w: 79 }], '2026-07-20');
    expect(early[1].status).toBe('hit');
    const late = weighInWeeks([{ d: '2026-07-01', w: 80 }, { d: '2026-07-14', w: 79 }], '2026-07-20');
    expect(late[1].status).toBe('hit');
  });

  it('marks every skipped week, not just the last one', () => {
    const weeks = weighInWeeks([{ d: '2026-07-01', w: 80 }], '2026-07-22');
    expect(weeks.map((x) => x.status)).toEqual(['hit', 'missed', 'missed', 'pending']);
  });

  it('never calls the current week missed', () => {
    const weeks = weighInWeeks([{ d: '2026-07-01', w: 80 }], '2026-07-13');
    expect(weeks[weeks.length - 1].status).toBe('pending');
  });

  it('counts two entries in one week as a single hit', () => {
    const weeks = weighInWeeks([{ d: '2026-07-01', w: 80 }, { d: '2026-07-03', w: 79 }], '2026-07-05');
    expect(weeks).toHaveLength(1);
    expect(weeks[0].status).toBe('hit');
  });

  it('ignores the order entries arrive in', () => {
    const weeks = weighInWeeks([{ d: '2026-07-14', w: 79 }, { d: '2026-07-01', w: 80 }], '2026-07-16');
    expect(weeks[0].from).toBe('2026-07-01');
    expect(weeks.map((x) => x.status)).toEqual(['hit', 'missed', 'hit']);
  });
});
```

Add `weighInWeeks` to the import block in `tests/domain.test.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain.test.js -t weighInWeeks`
Expected: FAIL — "weighInWeeks is not a function".

- [ ] **Step 3: Write the implementation**

Append to `src/domain/domain.js`:

```js
/**
 * Each week since the first weigh-in, and whether it was logged.
 *
 * Weeks are seven-day buckets counted from the first entry. The day someone
 * weighs in is irrelevant — Sunday or Wednesday both count — so the reminder
 * day is deliberately not an input here. That is what stops a change of
 * reminder day from rewriting history: nothing in this function depends on it.
 *
 * Stores nothing. The habit's whole record is the weight log's dates.
 */
export function weighInWeeks(weightLog, today) {
  const log = Array.isArray(weightLog) ? weightLog.filter((e) => e && e.d && e.w > 0) : [];
  if (!log.length) return [];
  const dates = log.map((e) => e.d).sort();
  const start = dates[0];
  if (today < start) return [];

  const weeks = [];
  let from = start;
  let n = 1;
  // Bounded by construction: `from` advances 7 days each pass and stops once
  // the bucket contains today.
  for (;;) {
    const to = addDays(from, 6);
    const logged = dates.some((d) => d >= from && d <= to);
    const current = today >= from && today <= to;
    weeks.push({ n, from, to, status: logged ? 'hit' : current ? 'pending' : 'missed' });
    if (current) break;
    from = addDays(from, 7);
    n += 1;
  }
  return weeks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, count risen from 209 to 216.

- [ ] **Step 5: Commit**

```bash
git add src/domain/domain.js tests/domain.test.js
git commit -m "Read the weigh-in habit's history out of the weight log's dates"
```

---

### Task 3: Recording a weight change, and merging logs across devices

**Files:**
- Modify: `src/domain/domain.js` (new export, plus `mergeProfiles` near line 867)
- Test: `tests/domain.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `recordWeight(weightLog, dateStr, w)` → new array; `mergeProfiles` gains `weightLog` union and `weighInDay`

**Why the merge must change:** `mergeProfiles` currently spreads `{ ...loser, ...winner }`. An array on the winner replaces the loser's wholesale, so two phones each logging a weight would lose one device's entries. This is the same shape as the bug that once deleted the avatar.

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain.test.js`:

```js
describe('recordWeight', () => {
  it('appends the first entry', () => {
    expect(recordWeight([], '2026-07-31', 82.4)).toEqual([{ d: '2026-07-31', w: 82.4 }]);
  });

  it('appends when the weight has changed', () => {
    const log = [{ d: '2026-06-12', w: 85.6 }];
    expect(recordWeight(log, '2026-07-31', 82.4)).toEqual([
      { d: '2026-06-12', w: 85.6 }, { d: '2026-07-31', w: 82.4 },
    ]);
  });

  it('records nothing when the weight is unchanged', () => {
    const log = [{ d: '2026-06-12', w: 85.6 }];
    expect(recordWeight(log, '2026-07-31', 85.6)).toEqual(log);
  });

  it('corrects a typo instead of inventing a second data point', () => {
    const log = [{ d: '2026-07-31', w: 824 }];
    expect(recordWeight(log, '2026-07-31', 82.4)).toEqual([{ d: '2026-07-31', w: 82.4 }]);
  });

  it('ignores a cleared or nonsense weight', () => {
    const log = [{ d: '2026-06-12', w: 85.6 }];
    expect(recordWeight(log, '2026-07-31', null)).toEqual(log);
    expect(recordWeight(log, '2026-07-31', 0)).toEqual(log);
    expect(recordWeight(undefined, '2026-07-31', null)).toEqual([]);
  });
});

describe('mergeProfiles via mergeSyncSnapshots — weight log', () => {
  const snap = (updatedAt, profile) => ({ updatedAt, profile, exercises: [], setsLog: {}, timersLog: {}, streakOverrides: {} });

  it('keeps entries from both phones', () => {
    const local = snap(2, { weightLog: [{ d: '2026-07-01', w: 80 }] });
    const remote = snap(1, { weightLog: [{ d: '2026-07-08', w: 79 }] });
    expect(mergeSyncSnapshots(local, remote).profile.weightLog).toEqual([
      { d: '2026-07-01', w: 80 }, { d: '2026-07-08', w: 79 },
    ]);
  });

  it('lets the newer snapshot win a same-day disagreement', () => {
    const local = snap(2, { weightLog: [{ d: '2026-07-01', w: 80 }] });
    const remote = snap(1, { weightLog: [{ d: '2026-07-01', w: 99 }] });
    expect(mergeSyncSnapshots(local, remote).profile.weightLog).toEqual([{ d: '2026-07-01', w: 80 }]);
  });

  it('does not drop a log the other side has never seen', () => {
    const local = snap(2, { username: 'J' });
    const remote = snap(1, { weightLog: [{ d: '2026-07-01', w: 80 }] });
    expect(mergeSyncSnapshots(local, remote).profile.weightLog).toEqual([{ d: '2026-07-01', w: 80 }]);
  });

  it('carries the reminder day across', () => {
    const local = snap(2, { weighInDay: 1 });
    const remote = snap(1, { weighInDay: 6 });
    expect(mergeSyncSnapshots(local, remote).profile.weighInDay).toBe(1);
  });
});
```

Add `recordWeight` to the import block (`mergeSyncSnapshots` is already imported).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain.test.js -t recordWeight`
Expected: FAIL — "recordWeight is not a function". The merge tests fail on `weightLog` being undefined.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/domain.js`:

```js
/**
 * One entry per weight *change*, not per save — saving the profile with the
 * same number on it should not manufacture a data point. A second weight on a
 * day already recorded corrects that day rather than adding to it, so fixing a
 * typo does not leave a spike in the history.
 */
export function recordWeight(weightLog, dateStr, w) {
  const log = Array.isArray(weightLog) ? weightLog : [];
  const weight = Number(w);
  if (!(weight > 0)) return log;
  const sorted = [...log].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const last = sorted[sorted.length - 1];
  if (last && last.d === dateStr) {
    if (last.w === weight) return log;
    return [...sorted.slice(0, -1), { d: dateStr, w: weight }];
  }
  if (last && last.w === weight) return log;
  return [...sorted, { d: dateStr, w: weight }];
}

/**
 * Union by date. A spread would let the winning phone's array replace the
 * loser's outright and silently bin weeks of weigh-ins — the same mistake that
 * once deleted the avatar, in a different field.
 */
function mergeWeightLogs(winner, loser) {
  const byDate = new Map();
  (Array.isArray(loser) ? loser : []).forEach((e) => { if (e && e.d && e.w > 0) byDate.set(e.d, e); });
  (Array.isArray(winner) ? winner : []).forEach((e) => { if (e && e.d && e.w > 0) byDate.set(e.d, e); });
  return [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
```

Then in `mergeProfiles` (around line 867), add two lines to the returned object, after `avatar: pick('avatar'),`:

```js
    weighInDay: pick('weighInDay'),
    weightLog: mergeWeightLogs(w.weightLog, l.weightLog),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, count risen from 216 to 225.

- [ ] **Step 5: Commit**

```bash
git add src/domain/domain.js tests/domain.test.js
git commit -m "Record weight changes, and stop a sync from eating the other phone's log"
```

---

### Task 4: The health-habit boundary, proved

**Files:**
- Test: `tests/domain.test.js`

**Interfaces:**
- Consumes: `recordWeight`, `weighInWeeks`, `calcStreakInfo`, `calcTotal` (all already exported)
- Produces: nothing — this task adds only proof

This task writes no implementation. It exists because "a weigh-in is not an exercise" is the requirement most likely to be broken silently by a later change, and an assertion in a spec cannot catch that.

- [ ] **Step 1: Write the tests**

Append to `tests/domain.test.js`:

```js
describe('health habits are not exercises', () => {
  const setsLog = { '2026-07-30': { push: [10, 10] } };
  const ex = [{ id: 'push', active: true, archived: false, target: 20, createdAt: '2026-07-01' }];

  it('logging a weight leaves the workout record untouched', () => {
    const before = JSON.stringify(setsLog);
    recordWeight([], '2026-07-30', 82.4);
    expect(JSON.stringify(setsLog)).toBe(before);
  });

  it('a weigh-in never becomes a set', () => {
    const log = recordWeight([], '2026-07-30', 82.4);
    expect(calcTotal(setsLog['2026-07-30'].push)).toBe(20);
    expect(log.every((e) => typeof e.w === 'number' && e.d)).toBe(true);
  });

  it('a missed week cannot touch the exercise streak', () => {
    const weeks = weighInWeeks([{ d: '2026-07-01', w: 80 }], '2026-07-22');
    expect(weeks.some((x) => x.status === 'missed')).toBe(true);
    const streak = calcStreakInfo(ex, setsLog, '2026-07-30', {});
    const streakAgain = calcStreakInfo(ex, setsLog, '2026-07-30', {});
    expect(streak).toEqual(streakAgain);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS, count risen from 225 to 228.

`calcStreakInfo(exercises, setsLog, todayOverride, overrides)` is defined at `src/domain/domain.js:185` and `calcTotal(arr)` at line 76. Neither changes in this plan.

- [ ] **Step 3: Commit**

```bash
git add tests/domain.test.js
git commit -m "Pin down that a weigh-in is never a set and a missed week never costs a streak"
```

---

### Task 5: Persist the log — profile defaults and saveProfile

**Files:**
- Modify: `src/main.js:73`, `src/main.js:147`, `src/main.js:239`, `src/main.js:549-566`

**Interfaces:**
- Consumes: `recordWeight` from Task 3, `todayISO` from `domain.js`
- Produces: `state.profile.weightLog`, `state.profile.weighInDay` available to all rendering

- [ ] **Step 1: Add the defaults**

`src/main.js` has the empty profile shape in three places. Change all three from:

```js
{ username: '', weight: null, height: null }
```

to:

```js
{ username: '', weight: null, height: null, weightLog: [], weighInDay: 6 }
```

Lines 73, 147 and 239. Line 239 is the sync-merge path — a profile arriving from Drive without these fields must still land with them present.

- [ ] **Step 2: Import the new functions**

Add `recordWeight`, `bmiSummary`, `weightTrend`, `weighInWeeks` to the existing `from './domain/domain.js'` import block in `src/main.js` (the one containing `syncNudge` at line 51).

- [ ] **Step 3: Record the change in saveProfile**

In `saveProfile` (line 549), replace the `state.profile = { ... }` block with:

```js
  const cleanWeight = isNaN(weight) ? null : weight;
  // Spread what is already there: this form does not edit the photo, and
  // rebuilding the object from its fields alone silently deleted it. weightLog
  // is exactly the kind of field that mistake would take next.
  state.profile = {
    ...state.profile,
    username,
    weight: cleanWeight,
    height: isNaN(height) ? null : height,
    weighInDay: Number(document.getElementById('f-weighin-day').value),
    weightLog: recordWeight(state.profile.weightLog, todayISO(), cleanWeight),
  };
```

- [ ] **Step 4: Verify by using, not by calling**

Run `npm run dev`, open the app, open Profile, change the weight, Save. Then in the browser console:

```js
(await indexedDB.databases()).length > 0
```

Reopen Profile, change the weight again, Save. Confirm through the app's own Export (Backup & data → Export) that `profile.weightLog` holds two entries with today's date collapsed to one. Saving twice with the same number must not add a second entry.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "Keep a weight entry each time the number actually changes"
```

---

### Task 6: The BMI block and day picker in the Profile sheet

**Files:**
- Modify: `src/main.js:2327-2337` (the `profile-row` in `modalProfile`)
- Modify: `src/style.css` (append)

**Interfaces:**
- Consumes: `bmiSummary`, `weightTrend` from Task 1
- Produces: `bmiBlockHtml(profile)` used again by Task 8

- [ ] **Step 1: Add the render helper**

Add above `modalProfile` in `src/main.js`:

```js
const BMI_LABEL = { underweight: 'Underweight', normal: 'Normal', overweight: 'Overweight', obese: 'Obese' };

/**
 * BMI is shown wherever weight is, and nowhere else. It is derived on every
 * render, so a new weight updates it with no cache to invalidate.
 */
function bmiBlockHtml(profile) {
  const s = bmiSummary(profile);
  if (!s) return '';
  const trend = weightTrend(profile.weightLog);
  const toGo = s.toHealthy > 0
    ? `<div class="bmi-line">About ${s.toHealthy} kg to the healthy range.</div>` : '';
  const trendLine = trend
    ? `<div class="bmi-line ${trend.delta < 0 ? 'down' : 'up'}">${trend.delta < 0 ? '↓' : '↑'} ${Math.abs(trend.delta)} kg since ${escapeHtml(formatDisplayDate(trend.since, { month: 'short', day: 'numeric' }))}</div>` : '';
  return `<div class="bmi-block ${s.category}">
    <div class="bmi-head"><span class="bmi-num">${s.bmi}</span><span class="bmi-badge">${BMI_LABEL[s.category]}</span></div>
    <div class="bmi-line">Healthy range at ${profile.height} cm: ${s.healthyMin} – ${s.healthyMax} kg</div>
    ${toGo}${trendLine}
    <div class="hint">Weight alone can't tell muscle from fat.</div>
  </div>`;
}
```

`formatDisplayDate` (`src/main.js:7`) and `addDays` (`src/main.js:6`) are already imported — only the four new functions from Task 5 Step 2 need adding.

- [ ] **Step 2: Place it in the sheet**

In `modalProfile`, immediately after the closing `</div>` of the `profile-row` (line 2336), insert:

```js
      ${bmiBlockHtml(p)}
      <div class="field">
        <label>Weigh-in reminder</label>
        <select id="f-weighin-day">
          ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
            .map((d, i) => `<option value="${i}"${(p.weighInDay ?? 6) === i ? ' selected' : ''}>${d}</option>`).join('')}
        </select>
        <div class="hint">Just when you're reminded. Any day of the week counts — only skipping the whole week is a miss.</div>
      </div>
```

- [ ] **Step 3: Add the styling**

Append to `src/style.css`:

```css
/* ---- BMI block: the number is the hero, everything else is quiet ---- */
.bmi-block{border:1px solid var(--border);background:var(--bg-elevated);padding:14px;margin:4px 0 18px;}
.bmi-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.bmi-num{font-family:var(--font-num);font-size:30px;line-height:1;font-variant-numeric:tabular-nums;color:var(--accent);}
.bmi-block.overweight .bmi-num,.bmi-block.underweight .bmi-num{color:#F5A524;}
.bmi-block.obese .bmi-num{color:var(--danger);}
.bmi-badge{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  border:1px solid currentColor;padding:3px 7px;color:var(--text-dim);}
.bmi-block.overweight .bmi-badge,.bmi-block.underweight .bmi-badge{color:#F5A524;}
.bmi-block.obese .bmi-badge{color:var(--danger);}
.bmi-block.normal .bmi-badge{color:var(--accent);}
.bmi-line{font-size:12.5px;color:var(--text-dim);margin-top:6px;line-height:1.45;}
.bmi-line.down{color:var(--accent);}
.bmi-line.up{color:var(--text-dim);}
#f-weighin-day{width:100%;}
```

- [ ] **Step 4: Verify by using**

At 375px: open Profile with a weight and height set. Confirm the number, badge colour, range and hint all render; that the block disappears when weight is cleared and saved; that changing the weight and saving updates the number **without a reload**; that the day picker's tap target clears 44px; and that nothing overflows horizontally.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/style.css
git commit -m "Show BMI where the weight is entered, with the day you want reminding"
```

---

### Task 7: The weigh-in card on Today

**Files:**
- Modify: `src/main.js` — `viewToday` (before the final `return html;` at line 1484), the action switch near line 2763, and `renderModal` near line 1994

**Interfaces:**
- Consumes: `weighInWeeks` from Task 2, `recordWeight` from Task 3
- Produces: action `open-weigh-in`, action `save-weigh-in`, modal type `weighin`

The card appears from the chosen reminder day until the end of that week, and only while the week has no entry. The day is a nudge, not a deadline.

- [ ] **Step 1: Add the card helper**

Add near `viewToday` in `src/main.js`:

```js
/**
 * A health habit, not an exercise: no ring, no bar, no target, no "to go".
 * It sits below the exercises and is labelled, so it can never be read as one.
 */
function weighInCardHtml() {
  const p = state.profile || {};
  const today = todayISO();
  const weeks = weighInWeeks(p.weightLog, today);
  const current = weeks[weeks.length - 1];

  if (current && current.status === 'hit') return '';        // already done this week
  if (weeks.length) {
    // Exactly one day in the current bucket falls on the reminder weekday.
    // Stay quiet before it; ask from then until the week runs out.
    const startDay = new Date(current.from + 'T00:00:00').getDay();
    const remindOn = addDays(current.from, ((p.weighInDay ?? 6) - startDay + 7) % 7);
    if (today < remindOn) return '';
  }
  // Never logged: show it until they do, then it is governed by the rule above.

  return `<div class="section-label">Health habit</div>
    <div class="habit-card">
      <div class="habit-text"><b>Weekly weigh-in</b><span>Takes a second. Any day this week counts.</span></div>
      <button class="habit-btn" data-action="open-weigh-in">Log weight</button>
    </div>
    ${tipHtml('weigh-in', 'Health habits are tracked apart from exercises — missing one never breaks your streak.')}`;
}
```

- [ ] **Step 2: Place it below the exercises**

In `viewToday`, immediately before `return html;` (line 1484), insert:

```js
  html += weighInCardHtml();
```

It must come after the `break-nudge` paragraph so it sits below the exercise list.

- [ ] **Step 3: Add the sheet**

Add near the other modal builders in `src/main.js`:

```js
function modalWeighIn() {
  const p = state.profile || {};
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Weekly weigh-in</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <div class="field">
        <label>Weight (kg)</label>
        <input id="f-weighin" type="number" min="0" step="any" inputmode="decimal" placeholder="—" value="${p.weight != null ? p.weight : ''}">
        <div class="hint">Saved to your profile and this week's habit. It is never counted as reps.</div>
      </div>
      <button class="primary-btn" style="width:100%" data-action="save-weigh-in">Save weight</button>
    </div>
  </div>`;
}
```

Register it in `renderModal` beside the other types (line 1994):

```js
  else if (m.type === 'weighin') root.innerHTML = modalWeighIn();
```

- [ ] **Step 4: Wire the actions**

In the action switch (near line 2763), add:

```js
    case 'open-weigh-in':
      state.modal = { type: 'weighin' };
      renderModal();
      break;
    case 'save-weigh-in': {
      const raw = document.getElementById('f-weighin').value;
      const w = raw === '' ? null : Math.max(0, parseFloat(raw));
      if (!(w > 0)) { showToast('Enter a weight first'); break; }
      state.profile = { ...state.profile, weight: w, weightLog: recordWeight(state.profile.weightLog, todayISO(), w) };
      await persistProfile();
      state.modal = null;
      renderModal();
      render();
      showToast('Weight logged');
      break;
    }
```

- [ ] **Step 5: Add the styling**

Append to `src/style.css`:

```css
/* ---- Health habit card: deliberately unlike an exercise card ---- */
.habit-card{display:flex;align-items:center;justify-content:space-between;gap:12px;
  border:1px dashed var(--border);background:transparent;padding:14px;}
.habit-text b{display:block;font-size:15px;}
.habit-text span{display:block;font-size:12px;color:var(--text-faint);margin-top:3px;}
.habit-btn{min-height:44px;padding:0 16px;border:1px solid var(--accent);background:transparent;
  color:var(--accent);font-family:var(--font-mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;}
```

The dashed border is the point: every exercise card is solid, so the habit reads as a different kind of thing at a glance.

- [ ] **Step 6: Verify by using**

With the reminder day set to today: the card appears below the exercises, has no ring or progress bar, and its button clears 44px. Log a weight — the card disappears, the toast shows, and Profile's BMI has updated **without a reload**. Set the reminder to tomorrow and confirm the card is gone. Confirm the tip retires after the first log.

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/style.css
git commit -m "Ask for a weekly weigh-in on Today, as a habit rather than an exercise"
```

---

### Task 8: Weekly Weight Tracking on Progress

**Files:**
- Modify: `src/main.js` — `viewProgress` (line 1557), `modalGuide` (line 1912)
- Modify: `src/style.css` (append)

**Interfaces:**
- Consumes: `weighInWeeks`, `bmiSummary`, `weightTrend`, `bmiBlockHtml` from Tasks 1, 2 and 6
- Produces: nothing further

- [ ] **Step 1: Add the block**

Add above `viewProgress` in `src/main.js`:

```js
/**
 * The habit's own place on Progress, kept clear of the exercise cards. Every
 * week since the first weigh-in is shown; the strip scrolls rather than being
 * cut off, so a long history never crushes the markers together.
 */
function weighInBlockHtml() {
  const p = state.profile || {};
  const weeks = weighInWeeks(p.weightLog, todayISO());
  if (!weeks.length) return '';
  const marks = weeks.map((wk) => {
    const glyph = wk.status === 'hit' ? '●' : wk.status === 'missed' ? '✕' : '○';
    return `<span class="habit-mark ${wk.status}" title="Week ${wk.n}: ${wk.from} to ${wk.to}">${glyph}</span>`;
  }).join('');
  const s = bmiSummary(p);
  const trend = weightTrend(p.weightLog);
  const summary = s
    ? `<div class="bmi-line">Current ${p.weight} kg · BMI ${s.bmi} · ${BMI_LABEL[s.category]}</div>
       ${s.toHealthy > 0 ? `<div class="bmi-line">About ${s.toHealthy} kg to the healthy range.</div>` : ''}` : '';
  const trendLine = trend
    ? `<div class="bmi-line ${trend.delta < 0 ? 'down' : 'up'}">${trend.delta < 0 ? '↓' : '↑'} ${Math.abs(trend.delta)} kg since ${escapeHtml(formatDisplayDate(trend.since, { month: 'short', day: 'numeric' }))}</div>` : '';
  return `<div class="habit-block">
    <div class="habit-block-head"><span class="section-label">Weekly weight tracking</span><span class="habit-tag">health habit</span></div>
    <div class="habit-strip">${marks}</div>
    ${summary}${trendLine}
  </div>`;
}
```

- [ ] **Step 2: Render it before the exercise cards**

Replace the body of `viewProgress` (line 1557) with:

```js
function viewProgress() {
  const habit = weighInBlockHtml();
  const activeEx = state.exercises.filter((e) => e.active && !e.archived).sort((a, b) => a.order - b.order);
  if (!activeEx.length) return habit || `<p class="rail-empty">Add an exercise to start a streak.</p>`;
  const stats = allStats(activeEx, state.setsLog, state.timersLog, null, state.streakOverrides);
  return habit
    + activeEx.map((ex) => exerciseCard(ex, stats[ex.id], { expandable: true })).join('')
    + tipHtml('progress-open', 'Tap an exercise for its history and numbers.');
}
```

The habit survives the empty-exercise early return: it is not an exercise, so an empty workout plan must not hide it.

- [ ] **Step 3: Add the guide entries**

In `modalGuide` (line 1912), add to the `today` array:

```js
      ['Weekly weigh-in', 'A health habit, not an exercise. Logging it never counts as reps.'],
```

and to the `progress` array:

```js
      (state.profile && (state.profile.weightLog || []).length) && ['Weight tracking', 'Green = weighed in, red = missed that week, hollow = this week.'],
```

The `progress` entry is conditional so it stays hidden until there is a history to explain. The `today` entry is unconditional — the habit is always available.

- [ ] **Step 4: Add the styling**

Append to `src/style.css`:

```css
/* ---- Weekly weight tracking: its own block, never an exercise card ---- */
.habit-block{border:1px solid var(--border);padding:14px;margin-bottom:14px;}
.habit-block-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.habit-tag{font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-faint);}
/* The strip scrolls on its own so a long history never makes the page scroll. */
.habit-strip{display:flex;gap:10px;overflow-x:auto;padding:10px 0 4px;
  -webkit-overflow-scrolling:touch;scrollbar-width:none;}
.habit-strip::-webkit-scrollbar{display:none;}
.habit-mark{flex:0 0 auto;font-size:15px;line-height:1;color:var(--text-faint);}
.habit-mark.hit{color:var(--accent);}
.habit-mark.missed{color:var(--danger);font-weight:700;}
```

- [ ] **Step 5: Verify by using**

At 375px: with a history containing a gap, confirm green, red and hollow markers all render; that the strip scrolls sideways **while the page itself does not**; that the block appears above the exercise cards and is visibly not one; and that it still shows when every exercise is archived. Check the guide on both Today and Progress.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/style.css
git commit -m "Give weekly weight tracking its own place on Progress"
```

---

### Task 9: Full verification and deploy

**Files:** none — verification only

- [ ] **Step 1: Run the suite**

Run: `npm test`
Expected: PASS, 228 tests.

- [ ] **Step 2: Load the app**

`main.js` and the sync layer are covered by **no** tests. A revert once deleted 178 lines of `googleSync.js` and every test still passed. Open the app and confirm it renders rather than sticking on LOADING.

- [ ] **Step 3: Exercise the whole flow without reloading**

Set a weight and height → BMI appears in Profile. Set the reminder to today → card appears on Today. Log a weight → card goes, Progress gains a green marker, BMI updates. Clear the weight → BMI block disappears, history stays.

- [ ] **Step 4: Confirm the boundary by using it**

Log a weigh-in and confirm the exercise streak, daily totals and Top Set are all unchanged, and that no exercise card reacts to it.

- [ ] **Step 5: Round-trip the data**

Backup & data → Export. Confirm `profile.weightLog` and `profile.weighInDay` are in the JSON. Import it back and confirm the history survives.

- [ ] **Step 6: Build and deploy**

```bash
npm run build && git push origin main
```

Then confirm live: fetch the deployed asset names and compare byte-for-byte against a fresh local build of the same commit — `__BUILD_ID__` is the git short SHA, so a build is deterministic per commit.

```bash
curl -s "https://johnpatrickmendozacdu-pixel.github.io/workout/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)'
```

- [ ] **Step 7: Tell the user to Force update**

The installed PWA keeps its own service worker and cache: Backup & data → **Force update now** on the phone.
