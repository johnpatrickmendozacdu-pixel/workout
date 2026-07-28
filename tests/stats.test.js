import { describe, it, expect } from 'vitest';
import {
  workoutDates,
  completedTimes,
  streakInfo,
  lifetimeSince,
  exerciseStats,
  formatDuration,
  formatCount,
} from '../src/domain/stats.js';

const TODAY = '2026-07-28';

function ex(overrides = {}) {
  return {
    id: 'a',
    name: 'Push Ups',
    unit: 'reps',
    active: true,
    archived: false,
    createdDate: '2026-07-20',
    targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }],
    ...overrides,
  };
}

const setsLog = {
  '2026-07-26': { a: [40, 35, 30] },   // 105
  '2026-07-27': { a: [50, 60] },       // 110
  '2026-07-28': { a: [45, 55] },       // 100
};

const timersLog = {
  '2026-07-26': { a: { status: 'completed', elapsedMs: 1787000, runStartedAt: null } }, // 29:47
  '2026-07-27': { a: { status: 'completed', elapsedMs: 1992000, runStartedAt: null } }, // 33:12
  '2026-07-28': { a: { status: 'gaveup', elapsedMs: 5000, runStartedAt: null } },
};

describe('workoutDates / completedTimes', () => {
  it('lists only days with logged sets, sorted', () => {
    expect(workoutDates('a', setsLog)).toEqual(['2026-07-26', '2026-07-27', '2026-07-28']);
  });
  it('ignores empty arrays and other exercises', () => {
    expect(workoutDates('a', { '2026-07-26': { a: [] }, '2026-07-27': { b: [10] } })).toEqual([]);
  });
  it('counts only completed sessions as times', () => {
    expect(completedTimes('a', timersLog).map((t) => t.ms)).toEqual([1787000, 1992000]);
  });
});

describe('Top Set vs Max Reps', () => {
  const s = exerciseStats(ex(), setsLog, timersLog, TODAY);

  it('Top Set is the biggest SINGLE set, never a daily total', () => {
    expect(s.topSet).toBe(60);
    expect(s.topSetDate).toBe('2026-07-27');
  });

  it('Max Reps is the biggest DAILY total, never a single set', () => {
    expect(s.maxReps).toBe(110);
    expect(s.maxRepsDate).toBe('2026-07-27');
  });

  it('keeps them distinct when the best set and the best day differ', () => {
    const log = { '2026-01-01': { a: [90] }, '2026-01-02': { a: [30, 30, 30, 30] } };
    const s2 = exerciseStats(ex(), log, {}, TODAY);
    expect(s2.topSet).toBe(90);   // one huge set
    expect(s2.maxReps).toBe(120); // but a bigger day in total
  });
});

describe('lifetime reps and period', () => {
  it('sums every rep ever', () => {
    expect(exerciseStats(ex(), setsLog, timersLog, TODAY).totalReps).toBe(315);
  });
  it('reports the month and year of the first rep', () => {
    expect(lifetimeSince('a', setsLog)).toBe('Jul 2026');
  });
  it('has no period before any reps exist', () => {
    expect(lifetimeSince('a', {})).toBeNull();
  });
});

describe('streakInfo', () => {
  it('counts consecutive days the target was met', () => {
    const s = streakInfo(ex({ createdDate: '2026-07-26' }), setsLog, TODAY);
    expect(s.best).toBe(3);
    expect(s.tracked).toBe(3);
  });

  it('ends the run on a missed day and keeps the best run', () => {
    const log = {
      '2026-07-21': { a: [100] },
      '2026-07-22': { a: [100] },
      '2026-07-23': { a: [40] },   // missed
      '2026-07-24': { a: [100] },
    };
    const s = streakInfo(ex({ createdDate: '2026-07-21', targetHistory: [{ effectiveDate: '2026-07-21', target: 100 }] }), log, '2026-07-24');
    expect(s.best).toBe(2);
    expect(s.current).toBe(1);
  });

  it('reports best over tracked days, e.g. 11 of 15', () => {
    const log = {};
    for (let i = 1; i <= 11; i++) log[`2026-07-${String(i).padStart(2, '0')}`] = { a: [100] };
    const e = ex({ createdDate: '2026-07-01', targetHistory: [{ effectiveDate: '2026-07-01', target: 100 }] });
    const s = streakInfo(e, log, '2026-07-15');
    expect(s.best).toBe(11);
    expect(s.tracked).toBe(15);
  });

  it('treats an untargeted day as neutral rather than a miss', () => {
    const e = ex({
      createdDate: '2026-07-01',
      targetHistory: [
        { effectiveDate: '2026-07-01', target: 100 },
        { effectiveDate: '2026-07-02', target: null },
        { effectiveDate: '2026-07-03', target: 100 },
      ],
    });
    const log = { '2026-07-01': { a: [100] }, '2026-07-03': { a: [100] } };
    const s = streakInfo(e, log, '2026-07-03');
    expect(s.best).toBe(2);   // the untargeted day did not break it
    expect(s.tracked).toBe(2); // and did not count as a training day
  });

  it('returns zeros for an exercise with no history at all', () => {
    expect(streakInfo(ex({ createdDate: null }), {}, TODAY)).toEqual({ best: 0, current: 0, tracked: 0 });
  });
});

describe('times', () => {
  const s = exerciseStats(ex(), setsLog, timersLog, TODAY);
  it('best and average come from completed sessions only', () => {
    expect(formatDuration(s.bestTime)).toBe('29:47');
    expect(s.avgTime).toBe(1889500);
  });
  it('formats durations, including hours', () => {
    expect(formatDuration(59000)).toBe('0:59');
    expect(formatDuration(3661000)).toBe('1:01:01');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('empty exercise', () => {
  it('returns valid empty stats rather than throwing', () => {
    const s = exerciseStats(ex({ id: 'zzz' }), setsLog, timersLog, TODAY);
    expect(s.topSet).toBeNull();
    expect(s.maxReps).toBeNull();
    expect(s.totalReps).toBe(0);
    expect(s.bestTime).toBeNull();
    expect(s.since).toBeNull();
    expect(s.lastWorkout).toBeNull();
  });
});

describe('formatCount', () => {
  it('keeps small numbers exact and compacts large ones', () => {
    expect(formatCount(315)).toBe('315');
    expect(formatCount(9999)).toBe('9,999');
    expect(formatCount(12400)).toBe('12.4k');
    expect(formatCount(1250000)).toBe('1.3M');
  });
});
