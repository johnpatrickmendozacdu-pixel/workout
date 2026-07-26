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
