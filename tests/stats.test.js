import { describe, it, expect } from 'vitest';
import {
  workoutDates,
  completedTimes,
  exerciseStats,
  formatDuration,
  detectRecords,
  detectMilestones,
  achievementsFor,
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

describe('exerciseStats', () => {
  const s = exerciseStats(ex(), setsLog, timersLog, TODAY);

  it('finds the highest single set and its date', () => {
    expect(s.topSet).toBe(60);
    expect(s.topSetDate).toBe('2026-07-27');
  });

  it('computes best and average completion time from completed sessions only', () => {
    expect(s.bestTime).toBe(1787000);
    expect(formatDuration(s.bestTime)).toBe('29:47');
    expect(s.avgTime).toBe(1889500);
  });

  it('totals workouts, sets and reps', () => {
    expect(s.totalWorkouts).toBe(3);
    expect(s.totalSets).toBe(7);
    expect(s.totalReps).toBe(315);
  });

  it('reports the most recent workout date', () => {
    expect(s.lastWorkout).toBe('2026-07-28');
  });

  it('returns empty-but-valid stats for an exercise with no history', () => {
    const s0 = exerciseStats(ex({ id: 'zzz' }), setsLog, timersLog, TODAY);
    expect(s0.topSet).toBeNull();
    expect(s0.bestTime).toBeNull();
    expect(s0.avgTime).toBeNull();
    expect(s0.totalWorkouts).toBe(0);
    expect(s0.totalReps).toBe(0);
    expect(s0.lastWorkout).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats minutes:seconds and hours when needed', () => {
    expect(formatDuration(1787000)).toBe('29:47');
    expect(formatDuration(59000)).toBe('0:59');
    expect(formatDuration(3661000)).toBe('1:01:01');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('detectRecords', () => {
  const base = { topSet: 50, bestTime: 2000000, longestStreak: 3, totalReps: 100 };

  it('announces a beaten top set', () => {
    const r = detectRecords(base, { ...base, topSet: 60 }, ex());
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('top-set');
    expect(r[0].detail).toContain('60');
  });

  it('announces a faster best time, never a slower one', () => {
    expect(detectRecords(base, { ...base, bestTime: 1787000 }, ex())[0].type).toBe('best-time');
    expect(detectRecords(base, { ...base, bestTime: 2500000 }, ex())).toHaveLength(0);
  });

  it('announces a longer streak but not a streak of one', () => {
    expect(detectRecords(base, { ...base, longestStreak: 4 }, ex())[0].type).toBe('streak');
    expect(detectRecords({ ...base, longestStreak: 0 }, { ...base, longestStreak: 1 }, ex())).toHaveLength(0);
  });

  it('says nothing when nothing improved', () => {
    expect(detectRecords(base, base, ex())).toEqual([]);
  });

  it('treats a first-ever time as a record', () => {
    const r = detectRecords({ ...base, bestTime: null }, { ...base, bestTime: 900000 }, ex());
    expect(r[0].type).toBe('best-time');
  });
});

describe('detectMilestones', () => {
  it('fires once when a lifetime rep threshold is crossed', () => {
    const m = detectMilestones({ totalReps: 480 }, { totalReps: 520 }, ex());
    expect(m).toHaveLength(1);
    expect(m[0].detail).toContain('500');
  });

  it('does not re-fire a threshold already passed', () => {
    expect(detectMilestones({ totalReps: 520 }, { totalReps: 600 }, ex())).toEqual([]);
  });

  it('can cross two thresholds at once', () => {
    expect(detectMilestones({ totalReps: 90 }, { totalReps: 1200 }, ex())).toHaveLength(3);
  });
});

describe('achievementsFor', () => {
  it('combines records and milestones', () => {
    const prev = { topSet: 10, bestTime: null, longestStreak: 0, totalReps: 90 };
    const next = { topSet: 20, bestTime: 60000, longestStreak: 0, totalReps: 150 };
    const a = achievementsFor(prev, next, ex());
    expect(a.map((x) => x.type).sort()).toEqual(['best-time', 'milestone', 'top-set']);
  });
});
