import { describe, it, expect } from 'vitest';
import {
  addDays,
  getEffectiveTarget,
  calcTotal,
  calcDayStats,
  calcStreakInfo,
  calcWeeklyCompletion,
  bestDayForExercise,
  addSet,
  removeSetAt,
  undoLastSet,
  updateSetAt,
  decrementLast,
  removeExercise,
  purgeExerciseSets,
  setDayTotal,
  getTimer,
  timerElapsedMs,
  startTimer,
  pauseTimer,
  resumeTimer,
  finishTimer,
  resetTimer,
  bumpTargetIfPR,
  validateBackup,
  mergeBackup,
  buildBackup,
} from '../src/domain/domain.js';

const TODAY = '2026-07-26';

function makeExercise(overrides = {}) {
  return {
    id: 'a',
    name: 'Push-ups',
    unit: 'reps',
    active: true,
    archived: false,
    createdDate: '2026-07-20',
    targetHistory: [{ effectiveDate: '2026-07-20', target: 20 }],
    ...overrides,
  };
}

describe('calcTotal', () => {
  it('sums a set list', () => {
    expect(calcTotal([12, 10, 8])).toBe(30);
  });
  it('returns 0 for empty/undefined', () => {
    expect(calcTotal([])).toBe(0);
    expect(calcTotal(undefined)).toBe(0);
  });
});

describe('addSet / removeSetAt / undoLastSet', () => {
  it('appends a set immutably', () => {
    const before = {};
    const after = addSet(before, TODAY, 'a', 12);
    expect(before).toEqual({}); // original untouched
    expect(after[TODAY].a).toEqual([12]);
  });

  it('logging 12, 10, 8 then undo drops the last one (30 -> 22)', () => {
    let log = {};
    log = addSet(log, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 10);
    log = addSet(log, TODAY, 'a', 8);
    expect(calcTotal(log[TODAY].a)).toBe(30);

    log = undoLastSet(log, TODAY, 'a');
    expect(calcTotal(log[TODAY].a)).toBe(22);
    expect(log[TODAY].a).toEqual([12, 10]);
  });

  it('ignores zero/negative values', () => {
    let log = addSet({}, TODAY, 'a', 0);
    expect(log[TODAY]).toBeUndefined();
    log = addSet({}, TODAY, 'a', -5);
    expect(log[TODAY]).toBeUndefined();
  });

  it('removeSetAt can delete a non-latest historical set', () => {
    let log = {};
    log = addSet(log, TODAY, 'a', 5);
    log = addSet(log, TODAY, 'a', 7);
    log = addSet(log, TODAY, 'a', 9);
    log = removeSetAt(log, TODAY, 'a', 0); // remove the first (5)
    expect(log[TODAY].a).toEqual([7, 9]);
  });

  it('undo on an exercise with no sets is a no-op', () => {
    const log = undoLastSet({}, TODAY, 'a');
    expect(log).toEqual({});
  });

  it('updateSetAt overwrites a specific set (fixing a typo)', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 999); // typo
    log = updateSetAt(log, TODAY, 'a', 1, 9);
    expect(log[TODAY].a).toEqual([12, 9]);
  });

  it('updateSetAt with a value <= 0 removes that set instead', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 8);
    log = updateSetAt(log, TODAY, 'a', 0, 0);
    expect(log[TODAY].a).toEqual([8]);
  });

  it('decrementLast reduces the most recent set', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 10);
    log = decrementLast(log, TODAY, 'a', 4);
    expect(log[TODAY].a).toEqual([12, 6]);
  });

  it('decrementLast removes the set entirely if it would drop to zero or below', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 3);
    log = decrementLast(log, TODAY, 'a', 5);
    expect(log[TODAY].a).toEqual([12]);
  });
});

describe('workout timer', () => {
  it('startTimer creates a running record, and is a no-op if one already exists', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    expect(timers[TODAY].a).toEqual({ status: 'running', elapsedMs: 0, runStartedAt: 1000 });
    timers = startTimer(timers, TODAY, 'a', 5000); // should NOT reset
    expect(timers[TODAY].a.runStartedAt).toBe(1000);
  });

  it('timerElapsedMs adds live running time to the stored baseline', () => {
    const timers = startTimer({}, TODAY, 'a', 1000);
    const elapsed = timerElapsedMs(timers[TODAY].a, 4000);
    expect(elapsed).toBe(3000);
  });

  it('pauseTimer freezes elapsed time and stops the running clock', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 6000);
    expect(timers[TODAY].a).toEqual({ status: 'paused', elapsedMs: 5000, runStartedAt: null });
    // further "now" values shouldn't change a paused timer's elapsed time
    expect(timerElapsedMs(timers[TODAY].a, 999999)).toBe(5000);
  });

  it('resetTimer clears the day\'s timer entirely so the next set starts fresh', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 6000);
    timers = resetTimer(timers, TODAY, 'a');
    expect(timers[TODAY].a).toBeUndefined();
    // starting again afterward begins a brand-new record from 0
    timers = startTimer(timers, TODAY, 'a', 9000);
    expect(timers[TODAY].a).toEqual({ status: 'running', elapsedMs: 0, runStartedAt: 9000 });
  });

  it('resetTimer is a no-op when there is nothing to reset', () => {
    const timers = resetTimer({}, TODAY, 'a');
    expect(timers).toEqual({});
  });

  it('resumeTimer picks back up from the frozen elapsed baseline', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 6000); // elapsedMs=5000
    timers = resumeTimer(timers, TODAY, 'a', 10000);
    expect(timers[TODAY].a).toEqual({ status: 'running', elapsedMs: 5000, runStartedAt: 10000 });
    expect(timerElapsedMs(timers[TODAY].a, 12000)).toBe(7000);
  });

  it('finishTimer("completed") locks in the final elapsed time', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = finishTimer(timers, TODAY, 'a', 21000, 'completed');
    expect(timers[TODAY].a).toEqual({ status: 'completed', elapsedMs: 20000, runStartedAt: null });
  });

  it('finishTimer("gaveup") also works while paused', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 6000); // elapsedMs=5000
    timers = finishTimer(timers, TODAY, 'a', 99999, 'gaveup');
    expect(timers[TODAY].a).toEqual({ status: 'gaveup', elapsedMs: 5000, runStartedAt: null });
  });

  it('a finished timer cannot be paused, resumed, or re-finished', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = finishTimer(timers, TODAY, 'a', 5000, 'completed');
    const afterPause = pauseTimer(timers, TODAY, 'a', 9000);
    const afterResume = resumeTimer(timers, TODAY, 'a', 9000);
    expect(afterPause).toBe(timers);
    expect(afterResume).toBe(timers);
  });

  it('getTimer returns null when nothing has been logged yet', () => {
    expect(getTimer({}, TODAY, 'a')).toBeNull();
  });
});

describe('bumpTargetIfPR', () => {
  it('raises today\'s target when the total beats it, and returns a new object', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
    const updated = bumpTargetIfPR(ex, TODAY, 105);
    expect(updated).not.toBe(ex);
    expect(getEffectiveTarget(updated, TODAY)).toBe(105);
  });

  it('leaves the exercise untouched (same reference) if the total does not beat the target', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
    const updated = bumpTargetIfPR(ex, TODAY, 90);
    expect(updated).toBe(ex);
  });

  it('is a no-op for an untargeted exercise', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: null }] });
    const updated = bumpTargetIfPR(ex, TODAY, 999);
    expect(updated).toBe(ex);
  });

  it('a second, later PR carries forward as the new baseline for the next day', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
    const afterToday = bumpTargetIfPR(ex, TODAY, 105);
    const tomorrow = addDays(TODAY, 1);
    expect(getEffectiveTarget(afterToday, tomorrow)).toBe(105);
    const afterTomorrow = bumpTargetIfPR(afterToday, tomorrow, 110);
    expect(getEffectiveTarget(afterTomorrow, tomorrow)).toBe(110);
  });
});

describe('setDayTotal', () => {
  it('collapses existing sets into one set equal to the new total', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 10);
    log = setDayTotal(log, TODAY, 'a', 50);
    expect(log[TODAY].a).toEqual([50]);
    expect(calcTotal(log[TODAY].a)).toBe(50);
  });

  it('clears the day entirely for a value <= 0', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = setDayTotal(log, TODAY, 'a', 0);
    expect(log[TODAY].a).toBeUndefined();
  });

  it('can set a total on a day with no prior sets', () => {
    const log = setDayTotal({}, TODAY, 'a', 30);
    expect(log[TODAY].a).toEqual([30]);
  });
});

describe('removeExercise / purgeExerciseSets', () => {
  it('removeExercise permanently drops the exercise from the list', () => {
    const exercises = [makeExercise({ id: 'a' }), makeExercise({ id: 'b' })];
    const after = removeExercise(exercises, 'a');
    expect(after.map((e) => e.id)).toEqual(['b']);
  });

  it('purgeExerciseSets strips one exercise\'s history across every day, leaving others intact', () => {
    let log = addSet({}, TODAY, 'a', 10);
    log = addSet(log, TODAY, 'b', 5);
    log = addSet(log, '2026-07-25', 'a', 7);
    const after = purgeExerciseSets(log, 'a');
    expect(after[TODAY].a).toBeUndefined();
    expect(after[TODAY].b).toEqual([5]);
    expect(after['2026-07-25'].a).toBeUndefined();
  });
});

describe('target history', () => {
  it('retains the historic target after a later change', () => {
    const ex = makeExercise({
      targetHistory: [
        { effectiveDate: '2026-07-01', target: 10 },
        { effectiveDate: '2026-07-15', target: 30 },
      ],
    });
    expect(getEffectiveTarget(ex, '2026-07-10')).toBe(10);
    expect(getEffectiveTarget(ex, '2026-07-20')).toBe(30);
    expect(getEffectiveTarget(ex, '2026-06-01')).toBe(null);
  });

  it('an exercise created after a given date is excluded from that day\'s stats', () => {
    const ex = makeExercise({ id: 'd', createdDate: '2026-07-27' });
    const stats = calcDayStats([ex], {}, '2026-07-26');
    expect(stats.targetedCount).toBe(0);
  });
});

describe('calcDayStats (daily completion)', () => {
  it('ignores untargeted exercises for completion, but still reports their total', () => {
    const targeted = makeExercise({ id: 'a' });
    const untargeted = makeExercise({
      id: 'b',
      name: 'Plank',
      targetHistory: [{ effectiveDate: '2026-07-20', target: null }],
    });
    const setsLog = { [TODAY]: { a: [20], b: [60] } };
    const stats = calcDayStats([targeted, untargeted], setsLog, TODAY);
    expect(stats.targetedCount).toBe(1);
    expect(stats.allComplete).toBe(true);
    const untargetedDetail = stats.details.find((d) => d.ex.id === 'b');
    expect(untargetedDetail.hasTarget).toBe(false);
    expect(untargetedDetail.total).toBe(60);
  });

  it('a day with unmet target is not complete', () => {
    const ex = makeExercise();
    const setsLog = { [TODAY]: { a: [5] } };
    const stats = calcDayStats([ex], setsLog, TODAY);
    expect(stats.allComplete).toBe(false);
  });

  it('a manual override forces a day to count as complete regardless of real totals', () => {
    const ex = makeExercise();
    const setsLog = { [TODAY]: { a: [5] } }; // way under target
    const stats = calcDayStats([ex], setsLog, TODAY, { [TODAY]: true });
    expect(stats.allComplete).toBe(true);
    expect(stats.overridden).toBe(true);
    // the real numbers are still reported accurately, only completion is overridden
    expect(stats.completedCount).toBe(0);
    expect(stats.targetedCount).toBe(1);
  });

  it('a manual override can also force an otherwise-complete day to not count', () => {
    const ex = makeExercise();
    const setsLog = { [TODAY]: { a: [20] } }; // meets target
    const stats = calcDayStats([ex], setsLog, TODAY, { [TODAY]: false });
    expect(stats.allComplete).toBe(false);
    expect(stats.overridden).toBe(true);
  });

  it('a day with zero targeted exercises only counts for streak purposes if manually overridden', () => {
    const untargeted = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: null }] });
    const noOverride = calcDayStats([untargeted], {}, TODAY);
    expect(noOverride.countsForStreak).toBe(false);
    const withOverride = calcDayStats([untargeted], {}, TODAY, { [TODAY]: true });
    expect(withOverride.countsForStreak).toBe(true);
    expect(withOverride.allComplete).toBe(true);
  });
});

describe('calcStreakInfo', () => {
  it('counts a run of complete days and stops at a broken one', () => {
    const ex = makeExercise();
    const setsLog = {
      '2026-07-22': { a: [10, 10] }, // complete (20/20)
      '2026-07-23': { a: [5, 5] },   // incomplete (10/20) -> breaks streak before this run
      '2026-07-24': { a: [20] },     // complete
      '2026-07-25': { a: [25] },     // complete
      '2026-07-26': { a: [20] },     // complete (today)
    };
    const { current, longest } = calcStreakInfo([ex], setsLog, TODAY);
    expect(current).toBe(3); // 24, 25, 26
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it('an incomplete today does not count, but does not error', () => {
    const ex = makeExercise();
    const setsLog = { [TODAY]: { a: [1] } };
    const { current } = calcStreakInfo([ex], setsLog, TODAY);
    expect(current).toBe(0);
  });

  it('a day with no targeted exercises is neutral (does not break an in-progress streak)', () => {
    // exercise created *after* an earlier complete day, so that earlier day has 0 targeted exercises
    const ex = makeExercise({ createdDate: TODAY, targetHistory: [{ effectiveDate: TODAY, target: 10 }] });
    const setsLog = { [TODAY]: { a: [10] } };
    const { current } = calcStreakInfo([ex], setsLog, TODAY);
    expect(current).toBe(1);
  });

  it('overriding a missed day to "complete" repairs an otherwise-broken streak', () => {
    const ex = makeExercise();
    const setsLog = {
      '2026-07-24': { a: [5] },  // missed, would break the streak
      '2026-07-25': { a: [20] },
      '2026-07-26': { a: [20] }, // today
    };
    const withoutOverride = calcStreakInfo([ex], setsLog, TODAY);
    expect(withoutOverride.current).toBe(2); // 25, 26 only
    const withOverride = calcStreakInfo([ex], setsLog, TODAY, { '2026-07-24': true });
    expect(withOverride.current).toBe(3); // 24 now counts too
  });
});

describe('calcWeeklyCompletion', () => {
  it('returns null when nothing targeted in the last 7 days', () => {
    expect(calcWeeklyCompletion([], {}, TODAY)).toBe(null);
  });
  it('computes a percentage of complete days among targeted days', () => {
    const ex = makeExercise();
    const setsLog = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays(TODAY, -i);
      setsLog[d] = { a: i % 2 === 0 ? [20] : [1] }; // alternate complete/incomplete
    }
    const pct = calcWeeklyCompletion([ex], setsLog, TODAY);
    expect(pct).toBe(57); // 4/7 complete, rounded
  });
});

describe('bestDayForExercise', () => {
  it('finds the highest single-day total', () => {
    const ex = makeExercise();
    const setsLog = {
      '2026-07-20': { a: [10] },
      '2026-07-21': { a: [15, 15] },
      '2026-07-22': { a: [5] },
    };
    expect(bestDayForExercise(ex, setsLog)).toEqual({ date: '2026-07-21', total: 30 });
  });
  it('returns null when the exercise has never been logged', () => {
    expect(bestDayForExercise(makeExercise(), {})).toBe(null);
  });
});

describe('backup validation and merge', () => {
  it('accepts a well-formed backup', () => {
    const backup = buildBackup([makeExercise()], { [TODAY]: { a: [10] } });
    expect(validateBackup(backup)).toBe(null);
  });
  it('rejects non-object input', () => {
    expect(validateBackup(null)).toMatch(/not valid/i);
    expect(validateBackup('nope')).toMatch(/not valid/i);
  });
  it('rejects a missing exercise list', () => {
    expect(validateBackup({ setsLog: {} })).toMatch(/exercise list/i);
  });
  it('rejects an exercise missing required fields', () => {
    expect(validateBackup({ exercises: [{ name: 'no id' }], setsLog: {} })).toMatch(/missing required/i);
  });

  it('merge adds new exercises/sets without touching existing local data', () => {
    const local = [makeExercise({ id: 'a' })];
    const localSets = { [TODAY]: { a: [10] } };
    const imported = {
      exercises: [makeExercise({ id: 'a' }), makeExercise({ id: 'z', name: 'Squats' })],
      setsLog: { [TODAY]: { a: [999], z: [5] } }, // conflicting 'a' entry should be ignored
    };
    const result = mergeBackup(local, localSets, imported);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['a', 'z']);
    expect(result.setsLog[TODAY].a).toEqual([10]); // local kept, not overwritten
    expect(result.setsLog[TODAY].z).toEqual([5]); // new data added
  });
});
