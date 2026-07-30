import { describe, it, expect } from 'vitest';
import {
  workoutDates,
  completedTimes,
  streakInfo,
  lifetimeSince,
  exerciseStats,
  formatDuration,
  formatCount,
  recentDayStates,
  streakTier,
  dayHistory,
  trajectorySeries,
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

describe('records wait for the day to close', () => {
  // Yesterday is finished and holds the standing records: best set 50, best day 70.
  const past = { '2026-07-27': { a: [50, 20] } };
  // Today beats both records but is still short of the 100 target, so it is open.
  const openBeatsBoth = { ...past, '2026-07-28': { a: [60, 30] } }; // set 60, day 90
  // Today beats both AND meets the target, so it seals itself.
  const sealedBeatsBoth = { ...past, '2026-07-28': { a: [60, 55] } }; // set 60, day 115

  it('a set logged today does not become Top Set while the day is open', () => {
    const s = exerciseStats(ex(), openBeatsBoth, {}, TODAY);
    expect(s.topSet).toBe(50);
    expect(s.topSetDate).toBe('2026-07-27');
  });

  it('a day in progress does not become Best day while it is open', () => {
    const s = exerciseStats(ex(), openBeatsBoth, {}, TODAY);
    expect(s.maxReps).toBe(70);
    expect(s.maxRepsDate).toBe('2026-07-27');
  });

  it('both records update the moment the target is met', () => {
    // 115 of 100 seals the day on its own, with no timer involved at all
    const s = exerciseStats(ex(), sealedBeatsBoth, {}, TODAY);
    expect(s.topSet).toBe(60);
    expect(s.topSetDate).toBe('2026-07-28');
    expect(s.maxReps).toBe(115);
  });

  it('holds the records while you deliberately push past the target', () => {
    // Keep going marks the session pushingOn, so a met target does not seal it
    const timers = { '2026-07-28': { a: { status: 'running', elapsedMs: 0, runStartedAt: 1, pushingOn: true } } };
    const s = exerciseStats(ex(), sealedBeatsBoth, timers, TODAY);
    expect(s.topSet).toBe(50);
    expect(s.maxReps).toBe(70);
  });

  it('closing the session seals an open day and releases the records', () => {
    const closed = { '2026-07-28': { a: { status: 'completed', elapsedMs: 1000, runStartedAt: null } } };
    const s = exerciseStats(ex(), openBeatsBoth, closed, TODAY);
    expect(s.topSet).toBe(60);
    expect(s.maxReps).toBe(90);
  });

  it('giving up also closes the day, and what you did still counts', () => {
    const quit = { '2026-07-28': { a: { status: 'gaveup', elapsedMs: 1000, runStartedAt: null } } };
    const s = exerciseStats(ex(), openBeatsBoth, quit, TODAY);
    expect(s.topSet).toBe(60);
    expect(s.maxReps).toBe(90);
  });

  it('counters keep counting today even while the records wait', () => {
    const s = exerciseStats(ex(), openBeatsBoth, {}, TODAY);
    expect(s.topSet).toBe(50);      // record still yesterday's
    expect(s.totalReps).toBe(160);  // but today's 90 is counted
    expect(s.totalSets).toBe(4);
  });

  it('a targetless exercise admits today only once its session is closed', () => {
    const noTarget = ex({ targetHistory: [{ effectiveDate: '2026-07-20', target: null }] });
    expect(exerciseStats(noTarget, openBeatsBoth, {}, TODAY).topSet).toBe(50);

    const closed = { '2026-07-28': { a: { status: 'completed', elapsedMs: 1000, runStartedAt: null } } };
    const done = exerciseStats(noTarget, openBeatsBoth, closed, TODAY);
    expect(done.topSet).toBe(60);
    expect(done.maxReps).toBe(90);
  });

  it('leaves past days alone whether or not they were ever sealed', () => {
    // 07-27 has no timer and no seal, but it is not today, so it counts
    const s = exerciseStats(ex(), past, {}, TODAY);
    expect(s.topSet).toBe(50);
    expect(s.maxReps).toBe(70);
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


describe('recentDayStates (the 7-day strip)', () => {
  const e = ex({ createdDate: '2026-07-24', targetHistory: [{ effectiveDate: '2026-07-24', target: 100 }] });
  const log = {
    '2026-07-26': { a: [100] },   // hit
    '2026-07-27': { a: [40] },    // miss
    '2026-07-28': { a: [100] },   // hit
  };
  const overrides = { '2026-07-25': { a: 'break' } };

  it('classifies hit, miss, break and pre-history days', () => {
    const days = recentDayStates(e, log, overrides, 7, '2026-07-28');
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.state]));
    expect(byDate['2026-07-28']).toBe('hit');
    expect(byDate['2026-07-27']).toBe('miss');
    expect(byDate['2026-07-26']).toBe('hit');
    expect(byDate['2026-07-25']).toBe('break');
    expect(byDate['2026-07-23']).toBe('none');   // before it existed
  });

  it('returns exactly n days, oldest first, ending today', () => {
    const days = recentDayStates(e, log, overrides, 7, '2026-07-28');
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-07-22');   // seven days back, inclusive
    expect(days[6].date).toBe('2026-07-28');
    expect(days[6].isToday).toBe(true);
  });

  it('marks an unscheduled day as rest, not a miss', () => {
    const monOnly = ex({ createdDate: '2026-07-22', schedule: [1], targetHistory: [{ effectiveDate: '2026-07-22', target: 100 }] });
    const days = recentDayStates(monOnly, {}, {}, 7, '2026-07-28');
    const tue = days.find((d) => d.date === '2026-07-28');
    const mon = days.find((d) => d.date === '2026-07-27');
    expect(tue.state).toBe('rest');
    expect(mon.state).toBe('miss');
  });
});


describe('streakTier', () => {
  it('stays plain until a full week is held', () => {
    expect(streakTier(0)).toBe(0);
    expect(streakTier(6)).toBe(0);
    expect(streakTier(7)).toBe(1);
  });

  it('steps up at a fortnight, a month and a hundred days', () => {
    expect(streakTier(13)).toBe(1);
    expect(streakTier(14)).toBe(2);
    expect(streakTier(29)).toBe(2);
    expect(streakTier(30)).toBe(3);
    expect(streakTier(99)).toBe(3);
    expect(streakTier(100)).toBe(4);
    expect(streakTier(9999)).toBe(4);
  });

  it('never fails on missing input', () => {
    expect(streakTier(null)).toBe(0);
    expect(streakTier(undefined)).toBe(0);
  });
});


describe('dayHistory (reach without rendering)', () => {
  const e = ex({ createdDate: '2026-01-01', targetHistory: [{ effectiveDate: '2026-01-01', target: 100 }] });
  const log = { '2026-07-28': { a: [100] }, '2026-03-02': { a: [40] } };

  it('returns only the slice asked for, but counts the whole history', () => {
    const w = dayHistory(e, log, {}, 7, '2026-07-28');
    expect(w.rows).toHaveLength(7);
    expect(w.total).toBe(209);              // Jan 1 to Jul 28 inclusive
    expect(w.remaining).toBe(202);
  });

  it('reaches as far back as the data goes when the window is opened up', () => {
    const w = dayHistory(e, log, {}, 500, '2026-07-28');
    expect(w.rows).toHaveLength(209);       // the whole history, not a fixed cap
    expect(w.remaining).toBe(0);
  });

  it('stops at the exercise\'s own beginning, not an arbitrary limit', () => {
    const young = ex({ createdDate: '2026-07-20', targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
    const recentOnly = { '2026-07-28': { a: [100] } };
    const w = dayHistory(young, recentOnly, {}, 500, '2026-07-28');
    expect(w.total).toBe(9);
    expect(w.rows[w.rows.length - 1].date).toBe('2026-07-20');
  });

  it('reaches back past createdDate when sets were logged earlier still', () => {
    const young = ex({ createdDate: '2026-07-20', targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
    const w = dayHistory(young, log, {}, 500, '2026-07-28');
    expect(w.rows[w.rows.length - 1].date).toBe('2026-03-02'); // the earliest real data wins
  });

  it('counts only scheduled days, so a rest day never pads the list', () => {
    const monOnly = ex({ createdDate: '2026-07-01', schedule: [1], targetHistory: [{ effectiveDate: '2026-07-01', target: 100 }] });
    const w = dayHistory(monOnly, {}, {}, 50, '2026-07-28');
    expect(w.total).toBe(4);                 // four Mondays in that range
    w.rows.forEach((r) => expect(new Date(r.date + 'T00:00:00').getDay()).toBe(1));
  });

  it('marks hit, rest and today correctly', () => {
    const w = dayHistory(e, log, { '2026-07-27': { a: 'break' } }, 3, '2026-07-28');
    expect(w.rows[0]).toMatchObject({ date: '2026-07-28', isToday: true, hit: true });
    expect(w.rows[1]).toMatchObject({ date: '2026-07-27', rest: true });
    expect(w.rows[2]).toMatchObject({ date: '2026-07-26', hit: false });
  });

  it('is empty and safe for an exercise with no history', () => {
    expect(dayHistory(ex({ createdDate: null }), {}, {}, 7, '2026-07-28')).toEqual({ rows: [], remaining: 0, total: 0 });
  });
});

describe('trajectorySeries', () => {
  const WIN = 30;
  // window of 30 days ending 2026-07-28 starts on 2026-06-29
  const exT = () => ex({
    targetHistory: [
      { effectiveDate: '2026-07-20', target: 100 },
      { effectiveDate: '2026-07-27', target: 120 },
    ],
  });

  it('plots only days that were actually logged, in date order', () => {
    const log = {
      '2026-07-22': { a: [50, 30] },  // 80
      '2026-07-26': { a: [100] },     // 100
      '2026-07-28': { a: [60] },      // 60
    };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    expect(s.points.map((p) => p.date)).toEqual(['2026-07-22', '2026-07-26', '2026-07-28']);
    expect(s.points.map((p) => p.total)).toEqual([80, 100, 60]);
  });

  it('positions each point by real calendar date, so gaps stay gaps', () => {
    const log = { '2026-07-22': { a: [10] }, '2026-07-28': { a: [10] } };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    // last day of the window is index 29; six days earlier is 23
    expect(s.points.map((p) => p.dayIndex)).toEqual([23, 29]);
    expect(s.span).toBe(WIN);
  });

  it('reads the target that applied on each day, stepping when it changed', () => {
    const log = { '2026-07-26': { a: [10] }, '2026-07-28': { a: [10] } };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    expect(s.points.map((p) => p.target)).toEqual([100, 120]);
  });

  it('flags the days that reached their target', () => {
    const log = {
      '2026-07-26': { a: [100] }, // target 100 -> hit
      '2026-07-27': { a: [100] }, // target 120 -> short
      '2026-07-28': { a: [130] }, // target 120 -> hit
    };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    expect(s.points.map((p) => p.hit)).toEqual([true, false, true]);
  });

  it('scales to include a target that was never reached', () => {
    const log = { '2026-07-28': { a: [20] } };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    expect(s.maxY).toBeGreaterThanOrEqual(120);
  });

  it('leaves out days older than the window', () => {
    const log = { '2026-05-01': { a: [999] }, '2026-07-28': { a: [10] } };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    expect(s.points.map((p) => p.date)).toEqual(['2026-07-28']);
    expect(s.maxY).toBeLessThan(999);
  });

  it('reports the range so the renderer can fit it instead of pinning to zero', () => {
    const log = { '2026-07-22': { a: [60] }, '2026-07-26': { a: [130] } };
    const s = trajectorySeries(exT(), log, WIN, TODAY);
    expect(s.minY).toBe(60);
    expect(s.maxY).toBeGreaterThanOrEqual(130);
  });

  it('returns nothing to draw, safely, for an exercise with no history', () => {
    const s = trajectorySeries(exT(), {}, WIN, TODAY);
    expect(s.points).toEqual([]);
    expect(s.maxY).toBeGreaterThan(0); // never divide by zero downstream
  });

  it('handles an untargeted exercise without claiming hits', () => {
    const noTarget = ex({ targetHistory: [{ effectiveDate: '2026-07-20', target: null }] });
    const s = trajectorySeries(noTarget, { '2026-07-28': { a: [40] } }, WIN, TODAY);
    expect(s.points[0].hit).toBe(false);
    expect(s.points[0].target).toBeNull();
    expect(s.maxY).toBeGreaterThanOrEqual(40);
  });
});
