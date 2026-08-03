import { describe, it, expect } from 'vitest';
import {
  addDays,
  getEffectiveTarget,
  calcTotal,
  calcDayStats,
  calcStreakInfo,
  calcWeeklyCompletion,
  addSet,
  removeSetAt,
  undoLastSet,
  updateSetAt,
  decrementLast,
  removeExercise,
  purgeExerciseSets,
  setDayTotal,
  splitIntoSets,
  getTimer,
  timerPhase,
  sessionSealed,
  workoutSealed,
  markPushingOn,
  reopenTimer,
  timerElapsedMs,
  startTimer,
  pauseTimer,
  resumeTimer,
  finishTimer,
  resetTimer,
  bumpTargetIfPR,
  setTargetForDay,
  isScheduledOn,
  convertWeight,
  formatWeight,
  weightProgression,
  scheduleEffectiveOn,
  isBreakDay,
  setDayOverride,
  migrateOverrides,
  scheduleLabel,
  versionStatus,
  validateBackup,
  mergeBackup,
  buildBackup,
  mergeSyncSnapshots,
  emomPhase,
  emomBeepSchedule,
  countInLeft,
  activeEmomId,
  storedTokenUsable,
  bmiSummary,
  weightTrend,
  weeklyAverages,
  recordWeight,
  mergeTombstones,
  syncNudge,
  enforceSingleEmom,
  emomSessionsToPause,
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
    expect(timers[TODAY].a).toMatchObject({ status: 'completed', elapsedMs: 20000, runStartedAt: null });
    expect(timers[TODAY].a.finishedAt).toBe(21000); // clock log: when it was finished
  });

  it('finishTimer("gaveup") also works while paused', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 6000); // elapsedMs=5000
    timers = finishTimer(timers, TODAY, 'a', 99999, 'gaveup');
    expect(timers[TODAY].a).toMatchObject({ status: 'gaveup', elapsedMs: 5000, runStartedAt: null });
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

  it('a session is sealed only once it has been deliberately closed', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    expect(sessionSealed(getTimer(timers, TODAY, 'a'))).toBe(false);
    // crossing the target pauses but does NOT seal — "Keep going" has to stay open
    timers = pauseTimer(timers, TODAY, 'a', 6000);
    expect(sessionSealed(getTimer(timers, TODAY, 'a'))).toBe(false);
    expect(sessionSealed(null)).toBe(false);

    expect(sessionSealed(getTimer(finishTimer(timers, TODAY, 'a', 7000, 'completed'), TODAY, 'a'))).toBe(true);
    expect(sessionSealed(getTimer(finishTimer(timers, TODAY, 'a', 7000, 'gaveup'), TODAY, 'a'))).toBe(true);
  });

  it('meeting the target seals the day even if the session was never closed', () => {
    // the common case: reps logged, target met, sheet dismissed without tapping
    const timers = pauseTimer(startTimer({}, TODAY, 'a', 1000), TODAY, 'a', 6000);
    expect(workoutSealed(getTimer(timers, TODAY, 'a'), 100, 100)).toBe(true);
    expect(workoutSealed(getTimer(timers, TODAY, 'a'), 120, 100)).toBe(true);
    expect(workoutSealed(getTimer(timers, TODAY, 'a'), 99, 100)).toBe(false);
  });

  it('a day with no timer at all still seals on its target', () => {
    // days finished before timers existed, and totals typed in by hand
    expect(workoutSealed(null, 100, 100)).toBe(true);
    expect(workoutSealed(null, 40, 100)).toBe(false);
  });

  it('an exercise with no target never seals on reps alone', () => {
    expect(workoutSealed(null, 500, null)).toBe(false);
    expect(workoutSealed(null, 500, 0)).toBe(false);
  });

  it('choosing to keep going holds the day open, and keeps holding it', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 6000);
    timers = markPushingOn(timers, TODAY, 'a');
    expect(workoutSealed(getTimer(timers, TODAY, 'a'), 120, 100)).toBe(false);
    // pausing again mid-push must not re-seal what you chose to keep open
    timers = resumeTimer(timers, TODAY, 'a', 10000);
    timers = pauseTimer(timers, TODAY, 'a', 12000);
    expect(getTimer(timers, TODAY, 'a').pushingOn).toBe(true);
    expect(workoutSealed(getTimer(timers, TODAY, 'a'), 120, 100)).toBe(false);
    // but deliberately closing it still seals
    const closed = finishTimer(timers, TODAY, 'a', 13000, 'completed');
    expect(workoutSealed(getTimer(closed, TODAY, 'a'), 120, 100)).toBe(true);
  });

  it('reopening a target-sealed day with no timer marks it open for pushing on', () => {
    const timers = reopenTimer({}, TODAY, 'a');
    expect(workoutSealed(getTimer(timers, TODAY, 'a'), 100, 100)).toBe(false);
    expect(getTimer(timers, TODAY, 'a')).toMatchObject({ status: 'paused', elapsedMs: 0, pushingOn: true });
  });

  it('reopenTimer unseals to paused, keeping the time already earned', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = finishTimer(timers, TODAY, 'a', 21000, 'completed');
    timers = reopenTimer(timers, TODAY, 'a');
    expect(timers[TODAY].a).toMatchObject({ status: 'paused', elapsedMs: 20000, runStartedAt: null });
    expect(timers[TODAY].a.finishedAt).toBeNull();
    expect(sessionSealed(getTimer(timers, TODAY, 'a'))).toBe(false);
    // and it can be resumed from there without losing the 20s
    timers = resumeTimer(timers, TODAY, 'a', 30000);
    expect(timerElapsedMs(getTimer(timers, TODAY, 'a'), 35000)).toBe(25000);
  });

  it('reopening a running session only marks it, never stops the clock', () => {
    const running = startTimer({}, TODAY, 'a', 1000);
    const after = reopenTimer(running, TODAY, 'a');
    expect(getTimer(after, TODAY, 'a')).toMatchObject({ status: 'running', runStartedAt: 1000, pushingOn: true });
  });

  it('timerPhase names the not-yet-started case instead of leaving it null', () => {
    expect(timerPhase(null)).toBe('idle');
    expect(timerPhase(getTimer({}, TODAY, 'a'))).toBe('idle');
  });

  it('timerPhase reports the status of a timer that exists', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    expect(timerPhase(getTimer(timers, TODAY, 'a'))).toBe('running');
    timers = pauseTimer(timers, TODAY, 'a', 6000);
    expect(timerPhase(getTimer(timers, TODAY, 'a'))).toBe('paused');

    const won = finishTimer(timers, TODAY, 'a', 7000, 'completed');
    expect(timerPhase(getTimer(won, TODAY, 'a'))).toBe('completed');
    const quit = finishTimer(timers, TODAY, 'a', 7000, 'gaveup');
    expect(timerPhase(getTimer(quit, TODAY, 'a'))).toBe('gaveup');
  });
});

describe('take a break', () => {
  const ex = makeExercise({ createdDate: '2026-07-20', targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
  const log = {
    '2026-07-24': { a: [100] },
    '2026-07-25': { a: [100] },
    // 26th missed entirely — claimed as a break
    '2026-07-27': { a: [100] },
  };
  const overrides = { '2026-07-26': 'break' };

  it('recognises a claimed rest day', () => {
    expect(isBreakDay(overrides, '2026-07-26')).toBe(true);
    expect(isBreakDay(overrides, '2026-07-25')).toBe(false);
    expect(isBreakDay(undefined, '2026-07-26')).toBe(false);
  });

  it('keeps the streak alive across the break', () => {
    const withBreak = calcStreakInfo([ex], log, '2026-07-27', overrides);
    expect(withBreak.current).toBe(4);
    // without it, the missed day ends the run
    expect(calcStreakInfo([ex], log, '2026-07-27').current).toBe(1);
  });

  it('counts the break as one of the streak days, reported separately', () => {
    const info = calcStreakInfo([ex], log, '2026-07-27', overrides);
    expect(info.current).toBe(4);
    expect(info.breaks).toBe(1);   // 4 days, 1 of them a break
  });

  it('marks the day itself as a break', () => {
    const stats = calcDayStats([ex], log, '2026-07-26', overrides);
    expect(stats.isBreak).toBe(true);
    expect(stats.allComplete).toBe(true);
  });

  it('a normal manual override is not a break', () => {
    const stats = calcDayStats([ex], log, '2026-07-26', { '2026-07-26': true });
    expect(stats.isBreak).toBe(false);
    expect(stats.allComplete).toBe(true);
  });
});

describe('breaks are per exercise', () => {
  const push = makeExercise({ id: 'push', createdDate: '2026-07-20', targetHistory: [{ effectiveDate: '2026-07-20', target: 100 }] });
  const squat = makeExercise({ id: 'squat', createdDate: '2026-07-20', targetHistory: [{ effectiveDate: '2026-07-20', target: 50 }] });
  const log = { '2026-07-26': {} }; // neither trained

  it('resting one exercise does not excuse another', () => {
    const ov = setDayOverride({}, '2026-07-26', 'push', 'break');
    expect(isBreakDay(ov, '2026-07-26', 'push')).toBe(true);
    expect(isBreakDay(ov, '2026-07-26', 'squat')).toBe(false);

    const stats = calcDayStats([push, squat], log, '2026-07-26', ov);
    expect(stats.allComplete).toBe(false);  // squats were still missed
    const pushDetail = stats.details.find((d) => d.ex.id === 'push');
    const squatDetail = stats.details.find((d) => d.ex.id === 'squat');
    expect(pushDetail.isBreak).toBe(true);
    expect(squatDetail.isBreak).toBe(false);
  });

  it('resting every exercise makes the whole day rest', () => {
    let ov = setDayOverride({}, '2026-07-26', 'push', 'break');
    ov = setDayOverride(ov, '2026-07-26', 'squat', 'break');
    const stats = calcDayStats([push, squat], log, '2026-07-26', ov);
    expect(stats.allComplete).toBe(true);
    expect(stats.isBreak).toBe(true);
  });

  it('removing a break restores the miss', () => {
    let ov = setDayOverride({}, '2026-07-26', 'push', 'break');
    ov = setDayOverride(ov, '2026-07-26', 'push', null);
    expect(isBreakDay(ov, '2026-07-26', 'push')).toBe(false);
    expect(ov['2026-07-26']).toBeUndefined();
  });

  it('migrates an old day-level break to apply to every exercise', () => {
    const migrated = migrateOverrides({ '2026-07-26': 'break' });
    expect(isBreakDay(migrated, '2026-07-26', 'push')).toBe(true);
    expect(isBreakDay(migrated, '2026-07-26', 'squat')).toBe(true);
  });
});

describe('scheduling', () => {
  it('treats a missing or daily schedule as every day', () => {
    expect(isScheduledOn(makeExercise(), '2026-07-26')).toBe(true);
    expect(isScheduledOn(makeExercise({ schedule: 'daily' }), '2026-07-26')).toBe(true);
  });

  it('only counts the chosen weekdays', () => {
    const monWedFri = makeExercise({ schedule: [1, 3, 5] });
    expect(isScheduledOn(monWedFri, '2026-07-27')).toBe(true);  // Monday
    expect(isScheduledOn(monWedFri, '2026-07-28')).toBe(false); // Tuesday
  });

  it('a rest day is not a missed day', () => {
    const monOnly = makeExercise({ createdDate: '2026-07-20', schedule: [1] });
    const stats = calcDayStats([monOnly], {}, '2026-07-28'); // a Tuesday
    expect(stats.targetedCount).toBe(0);
    expect(stats.countsForStreak).toBe(false);
  });

  it('names common patterns plainly', () => {
    expect(scheduleLabel(makeExercise())).toBe('Every day');
    expect(scheduleLabel(makeExercise({ schedule: [1, 2, 3, 4, 5] }))).toBe('Weekdays');
    expect(scheduleLabel(makeExercise({ schedule: [0, 6] }))).toBe('Weekends');
    expect(scheduleLabel(makeExercise({ schedule: [1, 3] }))).toBe('Mon Wed');
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

describe('setTargetForDay', () => {
  it('changes only the named day, leaving later days on the original target', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const updated = setTargetForDay(ex, '2026-07-22', 100);
    expect(getEffectiveTarget(updated, '2026-07-22')).toBe(100);
    expect(getEffectiveTarget(updated, '2026-07-23')).toBe(200);
    expect(getEffectiveTarget(updated, '2026-07-26')).toBe(200);
    expect(getEffectiveTarget(updated, '2026-07-21')).toBe(200);
  });

  it('does not mutate the original exercise', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const before = JSON.stringify(ex);
    setTargetForDay(ex, '2026-07-22', 100);
    expect(JSON.stringify(ex)).toBe(before);
  });

  it('preserves a later explicit target change instead of writing a redundant restore entry', () => {
    const ex = makeExercise({
      targetHistory: [
        { effectiveDate: '2026-07-20', target: 200 },
        { effectiveDate: '2026-07-23', target: 300 },
      ],
    });
    const updated = setTargetForDay(ex, '2026-07-22', 100);
    expect(getEffectiveTarget(updated, '2026-07-22')).toBe(100);
    expect(getEffectiveTarget(updated, '2026-07-23')).toBe(300);
    expect(getEffectiveTarget(updated, '2026-07-24')).toBe(300);
  });

  it('restores the carried value when the edited day sits directly before an untouched stretch', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const updated = setTargetForDay(ex, '2026-07-25', 50);
    const restore = updated.targetHistory.find((h) => h.effectiveDate === '2026-07-26');
    expect(restore).toBeTruthy();
    expect(restore.target).toBe(200);
  });

  it('replaces rather than duplicates when the same day is edited twice', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const once = setTargetForDay(ex, '2026-07-22', 100);
    const twice = setTargetForDay(once, '2026-07-22', 75);
    const entries = twice.targetHistory.filter((h) => h.effectiveDate === '2026-07-22');
    expect(entries).toHaveLength(1);
    expect(getEffectiveTarget(twice, '2026-07-22')).toBe(75);
    expect(getEffectiveTarget(twice, '2026-07-23')).toBe(200);
  });

  it('clearing a target makes that day untargeted but leaves later days targeted', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const updated = setTargetForDay(ex, '2026-07-22', null);
    expect(getEffectiveTarget(updated, '2026-07-22')).toBe(null);
    expect(getEffectiveTarget(updated, '2026-07-23')).toBe(200);
  });

  it('normalizes zero, negative, and NaN targets to untargeted', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    expect(getEffectiveTarget(setTargetForDay(ex, '2026-07-22', 0), '2026-07-22')).toBe(null);
    expect(getEffectiveTarget(setTargetForDay(ex, '2026-07-22', -5), '2026-07-22')).toBe(null);
    expect(getEffectiveTarget(setTargetForDay(ex, '2026-07-22', NaN), '2026-07-22')).toBe(null);
  });

  it('adds a target to a day that previously had none', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: null }] });
    const updated = setTargetForDay(ex, '2026-07-22', 60);
    expect(getEffectiveTarget(updated, '2026-07-22')).toBe(60);
    expect(getEffectiveTarget(updated, '2026-07-23')).toBe(null);
  });

  it('handles an exercise with no target history at all', () => {
    const ex = makeExercise({ targetHistory: [] });
    const updated = setTargetForDay(ex, '2026-07-22', 60);
    expect(getEffectiveTarget(updated, '2026-07-22')).toBe(60);
    expect(getEffectiveTarget(updated, '2026-07-23')).toBe(null);
  });

  it('returns the same reference when the value is unchanged', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    expect(setTargetForDay(ex, '2026-07-22', 200)).toBe(ex);
  });

  it('flips a day to complete in calcDayStats once the target drops to the logged total', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const setsLog = { '2026-07-25': { a: [105] } };
    expect(calcDayStats([ex], setsLog, '2026-07-25').allComplete).toBe(false);
    const updated = setTargetForDay(ex, '2026-07-25', 100);
    const stats = calcDayStats([updated], setsLog, '2026-07-25');
    expect(stats.allComplete).toBe(true);
    expect(stats.completedCount).toBe(1);
    expect(stats.targetedCount).toBe(1);
  });

  it('extends the current streak once a broken day is corrected', () => {
    const ex = makeExercise({ targetHistory: [{ effectiveDate: '2026-07-20', target: 200 }] });
    const setsLog = {
      '2026-07-24': { a: [105] },
      '2026-07-25': { a: [200] },
      '2026-07-26': { a: [200] },
    };
    expect(calcStreakInfo([ex], setsLog, TODAY).current).toBe(2);
    const updated = setTargetForDay(ex, '2026-07-24', 100);
    expect(calcStreakInfo([updated], setsLog, TODAY).current).toBe(3);
  });
});

describe('versionStatus', () => {
  it('reports latest, stale, and unknown', () => {
    expect(versionStatus('abc', 'abc')).toBe('latest');
    expect(versionStatus('abc', 'def')).toBe('stale');
    expect(versionStatus('abc', null)).toBe('unknown');
  });
});

describe('splitIntoSets', () => {
  it('never returns one set equal to a whole big day', () => {
    const sets = splitIntoSets(110);
    expect(Math.max(...sets)).toBeLessThan(110);
    expect(sets.reduce((a, b) => a + b, 0)).toBe(110);
  });
  it('leaves a small total as a single set', () => {
    expect(splitIntoSets(16)).toEqual([16]);
  });
  it('preserves the total exactly', () => {
    [21, 45, 97, 200, 333].forEach((t) => {
      expect(splitIntoSets(t).reduce((a, b) => a + b, 0)).toBe(t);
    });
  });
});

describe('setDayTotal', () => {
  it('reaches a higher total by adding the difference, keeping real sets intact', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = addSet(log, TODAY, 'a', 10);
    log = setDayTotal(log, TODAY, 'a', 50);
    expect(log[TODAY].a).toEqual([12, 10, 28]);
    expect(calcTotal(log[TODAY].a)).toBe(50);
  });

  it('reaches a lower total by trimming from the end, never inventing a giant set', () => {
    let log = addSet({}, TODAY, 'a', 20);
    log = addSet(log, TODAY, 'a', 20);
    log = addSet(log, TODAY, 'a', 20);
    log = setDayTotal(log, TODAY, 'a', 25);
    expect(calcTotal(log[TODAY].a)).toBe(25);
    expect(Math.max(...log[TODAY].a)).toBeLessThanOrEqual(20);
  });

  it('does not fabricate a giant set when a total is typed with nothing logged', () => {
    // This is how a 110-rep DAY became a 110-rep "top set".
    const log = setDayTotal({}, TODAY, 'a', 110);
    expect(Math.max(...log[TODAY].a)).toBeLessThan(110);
    expect(calcTotal(log[TODAY].a)).toBe(110);
  });

  it('does not corrupt Top Set when a day total is edited', () => {
    // The old behaviour collapsed the day into one set, so a 105-rep DAY
    // masqueraded as a 105-rep single set and became the Top Set.
    let log = addSet({}, TODAY, 'a', 20);
    log = addSet(log, TODAY, 'a', 20);
    log = setDayTotal(log, TODAY, 'a', 105);
    expect(Math.max(...log[TODAY].a)).toBeLessThan(105);
  });

  it('clears the day entirely for a value <= 0', () => {
    let log = addSet({}, TODAY, 'a', 12);
    log = setDayTotal(log, TODAY, 'a', 0);
    expect(log[TODAY].a).toBeUndefined();
  });

  it('can set a total on a day with no prior sets, split so no set is inflated', () => {
    const log = setDayTotal({}, TODAY, 'a', 30);
    expect(calcTotal(log[TODAY].a)).toBe(30);
    expect(Math.max(...log[TODAY].a)).toBeLessThan(30);
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

describe('mergeSyncSnapshots', () => {
  const snap = (overrides = {}) => ({
    version: 1,
    updatedAt: 1000,
    exercises: [makeExercise()],
    setsLog: {},
    timersLog: {},
    streakOverrides: {},
    profile: { username: '', weight: null, height: null },
    ...overrides,
  });

  it('keeps a day that exists only locally, even when the remote is newer', () => {
    // The exact bug: trained offline on the phone, another copy wrote later.
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [40, 60] } } });
    const remote = snap({ updatedAt: 9000, setsLog: { '2026-07-29': { a: [20] } } });
    const merged = mergeSyncSnapshots(local, remote);
    expect(merged.setsLog['2026-07-30'].a).toEqual([40, 60]);
    expect(merged.setsLog['2026-07-29'].a).toEqual([20]);
  });

  it('unions two exercises logged on the same day by different devices', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [10] } } });
    const remote = snap({ updatedAt: 9000, setsLog: { '2026-07-30': { b: [7] } } });
    const merged = mergeSyncSnapshots(local, remote);
    expect(merged.setsLog['2026-07-30']).toEqual({ a: [10], b: [7] });
  });

  it('gives a genuine conflict to the more recently written side', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [10] } } });
    const remote = snap({ updatedAt: 9000, setsLog: { '2026-07-30': { a: [99] } } });
    expect(mergeSyncSnapshots(local, remote).setsLog['2026-07-30'].a).toEqual([99]);

    const localNewer = snap({ updatedAt: 9000, setsLog: { '2026-07-30': { a: [10] } } });
    const remoteOlder = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [99] } } });
    expect(mergeSyncSnapshots(localNewer, remoteOlder).setsLog['2026-07-30'].a).toEqual([10]);
  });

  it('prefers the device in your hand when timestamps tie', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [10] } } });
    const remote = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [99] } } });
    expect(mergeSyncSnapshots(local, remote).setsLog['2026-07-30'].a).toEqual([10]);
  });

  it('carries the newest updatedAt forward so the merge is never stale', () => {
    expect(mergeSyncSnapshots(snap({ updatedAt: 5000 }), snap({ updatedAt: 9000 })).updatedAt).toBe(9000);
    expect(mergeSyncSnapshots(snap({ updatedAt: 9000 }), snap({ updatedAt: 5000 })).updatedAt).toBe(9000);
  });

  it('unions exercises by id and keeps ones only the other device has', () => {
    const mine = makeExercise({ id: 'a', name: 'Push-ups' });
    const theirs = makeExercise({ id: 'z', name: 'Dips' });
    const merged = mergeSyncSnapshots(
      snap({ updatedAt: 5000, exercises: [mine] }),
      snap({ updatedAt: 9000, exercises: [theirs] }),
    );
    expect(merged.exercises.map((e) => e.id).sort()).toEqual(['a', 'z']);
  });

  it('takes the newer side\'s version of an exercise they both have', () => {
    const merged = mergeSyncSnapshots(
      snap({ updatedAt: 5000, exercises: [makeExercise({ id: 'a', name: 'Old name' })] }),
      snap({ updatedAt: 9000, exercises: [makeExercise({ id: 'a', name: 'New name' })] }),
    );
    expect(merged.exercises).toHaveLength(1);
    expect(merged.exercises[0].name).toBe('New name');
  });

  it('unions timers and rest days the same way as sets', () => {
    const local = snap({
      updatedAt: 5000,
      timersLog: { '2026-07-30': { a: { status: 'completed', elapsedMs: 60000, runStartedAt: null } } },
      streakOverrides: { '2026-07-29': { a: 'break' } },
    });
    const remote = snap({
      updatedAt: 9000,
      timersLog: { '2026-07-29': { a: { status: 'gaveup', elapsedMs: 1000, runStartedAt: null } } },
      streakOverrides: { '2026-07-28': { b: 'break' } },
    });
    const merged = mergeSyncSnapshots(local, remote);
    expect(merged.timersLog['2026-07-30'].a.elapsedMs).toBe(60000);
    expect(merged.timersLog['2026-07-29'].a.status).toBe('gaveup');
    expect(merged.streakOverrides['2026-07-29'].a).toBe('break');
    expect(merged.streakOverrides['2026-07-28'].b).toBe('break');
  });

  it('never blanks a filled profile with an empty newer one', () => {
    const local = snap({ updatedAt: 5000, profile: { username: 'Johnny', weight: 70, height: 175 } });
    const remote = snap({ updatedAt: 9000, profile: { username: '', weight: null, height: null } });
    expect(mergeSyncSnapshots(local, remote).profile.username).toBe('Johnny');
  });

  it('takes a newer profile when it actually has something in it', () => {
    const local = snap({ updatedAt: 5000, profile: { username: 'Old', weight: null, height: null } });
    const remote = snap({ updatedAt: 9000, profile: { username: 'New', weight: 80, height: 180 } });
    expect(mergeSyncSnapshots(local, remote).profile.username).toBe('New');
  });

  it('returns local untouched when there is nothing in the cloud yet', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [10] } } });
    expect(mergeSyncSnapshots(local, null)).toBe(local);
    expect(mergeSyncSnapshots(local, undefined)).toBe(local);
  });

  it('survives a remote snapshot with missing sections', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [10] } } });
    const merged = mergeSyncSnapshots(local, { updatedAt: 9000 });
    expect(merged.setsLog['2026-07-30'].a).toEqual([10]);
    expect(merged.exercises.map((e) => e.id)).toEqual(['a']);
    expect(merged.timersLog).toEqual({});
  });

  it('is idempotent, so repeated syncs settle instead of oscillating', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [40] } } });
    const remote = snap({ updatedAt: 9000, setsLog: { '2026-07-29': { a: [20] }, '2026-07-30': { b: [5] } } });
    const once = mergeSyncSnapshots(local, remote);
    expect(mergeSyncSnapshots(once, remote)).toEqual(once);
    expect(mergeSyncSnapshots(once, local)).toEqual(once);
  });

  it('reaches the same days and exercises whichever order it merges in', () => {
    const local = snap({ updatedAt: 5000, setsLog: { '2026-07-30': { a: [40] } }, exercises: [makeExercise({ id: 'a' })] });
    const remote = snap({ updatedAt: 9000, setsLog: { '2026-07-29': { z: [20] } }, exercises: [makeExercise({ id: 'z' })] });
    const ab = mergeSyncSnapshots(local, remote);
    const ba = mergeSyncSnapshots(remote, local);
    const keys = (s) => Object.keys(s.setsLog).sort().map((d) => d + ':' + Object.keys(s.setsLog[d]).sort().join(',')).join('|');
    expect(keys(ab)).toBe(keys(ba));
    expect(ab.exercises.map((e) => e.id).sort()).toEqual(ba.exercises.map((e) => e.id).sort());
  });
});

describe('emomPhase', () => {
  const S = 1000;

  it('opens in work on round one', () => {
    expect(emomPhase(0, 60, 60)).toEqual({ phase: 'work', round: 1, secondsLeft: 60, cycleSec: 120 });
  });

  it('counts down the work period to its last second', () => {
    expect(emomPhase(59 * S, 60, 60)).toMatchObject({ phase: 'work', round: 1, secondsLeft: 1 });
  });

  it('crosses into rest exactly on the minute', () => {
    expect(emomPhase(60 * S, 60, 60)).toMatchObject({ phase: 'rest', round: 1, secondsLeft: 60 });
  });

  it('counts down rest to its last second, still round one', () => {
    expect(emomPhase(119 * S, 60, 60)).toMatchObject({ phase: 'rest', round: 1, secondsLeft: 1 });
  });

  it('rolls into round two at the top of the next cycle', () => {
    expect(emomPhase(120 * S, 60, 60)).toMatchObject({ phase: 'work', round: 2, secondsLeft: 60 });
  });

  it('handles an asymmetric cycle', () => {
    expect(emomPhase(0, 40, 20)).toMatchObject({ phase: 'work', round: 1, secondsLeft: 40, cycleSec: 60 });
    expect(emomPhase(39 * S, 40, 20)).toMatchObject({ phase: 'work', secondsLeft: 1 });
    expect(emomPhase(40 * S, 40, 20)).toMatchObject({ phase: 'rest', secondsLeft: 20 });
    expect(emomPhase(59 * S, 40, 20)).toMatchObject({ phase: 'rest', secondsLeft: 1 });
    expect(emomPhase(60 * S, 40, 20)).toMatchObject({ phase: 'work', round: 2 });
  });

  it('treats a zero rest as continuous work that still counts rounds', () => {
    expect(emomPhase(0, 30, 0)).toMatchObject({ phase: 'work', round: 1, secondsLeft: 30 });
    expect(emomPhase(29 * S, 30, 0)).toMatchObject({ phase: 'work', round: 1, secondsLeft: 1 });
    expect(emomPhase(30 * S, 30, 0)).toMatchObject({ phase: 'work', round: 2, secondsLeft: 30 });
  });

  it('ignores sub-second time rather than flickering', () => {
    expect(emomPhase(59_900, 60, 60)).toMatchObject({ phase: 'work', secondsLeft: 1 });
    expect(emomPhase(60_100, 60, 60)).toMatchObject({ phase: 'rest', secondsLeft: 60 });
  });

  it('refuses a cycle it cannot divide by', () => {
    expect(emomPhase(0, 0, 0)).toBeNull();
    expect(emomPhase(0, -5, 0)).toBeNull();
    expect(emomPhase(0, 60, -60)).toBeNull();
    expect(emomPhase(0, null, null)).toBeNull();
  });

  it('follows the workout clock, so a paused clock holds its phase', () => {
    // The whole design rests on this: EMOM stores nothing and reads elapsedMs,
    // which already excludes paused time.
    let timers = startTimer({}, TODAY, 'a', 0);
    timers = pauseTimer(timers, TODAY, 'a', 70 * S); // 70s of work done, then paused
    const t = getTimer(timers, TODAY, 'a');
    const held = emomPhase(timerElapsedMs(t, 70 * S), 60, 60);
    const muchLater = emomPhase(timerElapsedMs(t, 999 * S), 60, 60);
    expect(held).toMatchObject({ phase: 'rest', round: 1, secondsLeft: 50 });
    expect(muchLater).toEqual(held);
  });
});

describe('EMOM count-in and beep schedule', () => {
  const S = 1000;
  const NOW = 1_000_000;

  it('holds both clocks at zero through the count-in, then starts them together', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 5 * S);
    const t = getTimer(timers, TODAY, 'a');

    // during the count-in nothing has started yet
    expect(timerElapsedMs(t, NOW)).toBe(0);
    expect(timerElapsedMs(t, NOW + 4 * S)).toBe(0);
    expect(emomPhase(timerElapsedMs(t, NOW + 4 * S), 60, 60)).toMatchObject({ phase: 'work', round: 1, secondsLeft: 60 });

    // the instant it ends, the workout clock moves and round 1 begins in full
    expect(timerElapsedMs(t, NOW + 5 * S)).toBe(0);
    expect(timerElapsedMs(t, NOW + 6 * S)).toBe(1000);
    expect(emomPhase(timerElapsedMs(t, NOW + 65 * S), 60, 60)).toMatchObject({ phase: 'rest', round: 1 });
  });

  it('counts the count-in down five to one and then says go', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 5 * S);
    const t = getTimer(timers, TODAY, 'a');
    const ev = emomBeepSchedule(t, 60, 60, NOW, 6 * S);
    expect(ev.map((e) => e.kind)).toEqual(['tick', 'tick', 'tick', 'tick', 'tick', 'work']);
    expect(ev.map((e) => e.atMs - NOW)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });

  it('ticks the last five seconds of work and sounds the rest tone at the change', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 0);
    const t = getTimer(timers, TODAY, 'a');
    // 54s in: the work period ends at 60s
    const ev = emomBeepSchedule(t, 60, 60, NOW + 54 * S, 7 * S);
    expect(ev.map((e) => e.kind)).toEqual(['tick', 'tick', 'tick', 'tick', 'tick', 'rest']);
    expect(ev.map((e) => (e.atMs - NOW) / 1000)).toEqual([55, 56, 57, 58, 59, 60]);
  });

  it('sounds the work tone coming out of rest', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 0);
    const t = getTimer(timers, TODAY, 'a');
    const ev = emomBeepSchedule(t, 60, 60, NOW + 114 * S, 7 * S);
    expect(ev[ev.length - 1]).toMatchObject({ kind: 'work', atMs: NOW + 120 * S });
  });

  it('still sounds the tick that lands on the tap that started the count-in', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 5 * S);
    const t = getTimer(timers, TODAY, 'a');
    // scheduling runs a few ms after the tap, as it does in the app
    const ev = emomBeepSchedule(t, 60, 60, NOW + 40, 3 * S);
    expect(ev[0]).toMatchObject({ kind: 'tick', atMs: NOW });
  });

  it('never books a beep twice, and never one already past', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 0);
    const t = getTimer(timers, TODAY, 'a');
    const ev = emomBeepSchedule(t, 60, 60, NOW + 57 * S, 10 * S);
    const times = ev.map((e) => e.atMs);
    expect(new Set(times).size).toBe(times.length);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(NOW + 57 * S);
  });

  it('looks only as far ahead as it is asked to', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 0);
    const t = getTimer(timers, TODAY, 'a');
    expect(emomBeepSchedule(t, 60, 60, NOW, 2 * S)).toEqual([]);
    expect(emomBeepSchedule(t, 60, 60, NOW + 56 * S, 2 * S).length).toBeGreaterThan(0);
  });

  it('clips the countdown to a phase too short to hold it', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 0);
    const t = getTimer(timers, TODAY, 'a');
    // work 30, rest 2: the rest period can only hold two ticks
    const ev = emomBeepSchedule(t, 30, 2, NOW + 30 * S, 3 * S);
    const ticks = ev.filter((e) => e.kind === 'tick');
    expect(ticks.length).toBeLessThanOrEqual(2);
    expect(ev[ev.length - 1].kind).toBe('work');
  });

  it('stays silent while the session is paused', () => {
    let timers = startTimer({}, TODAY, 'a', NOW, 0);
    timers = pauseTimer(timers, TODAY, 'a', NOW + 54 * S);
    expect(emomBeepSchedule(getTimer(timers, TODAY, 'a'), 60, 60, NOW + 54 * S, 8 * S)).toEqual([]);
  });

  it('reports how much count-in is left, and nothing once it has run', () => {
    const timers = startTimer({}, TODAY, 'a', NOW, 5 * S);
    const t = getTimer(timers, TODAY, 'a');
    expect(countInLeft(t, NOW)).toBe(5);
    expect(countInLeft(t, NOW + 4200)).toBe(1);
    expect(countInLeft(t, NOW + 5 * S)).toBe(0);
    expect(countInLeft(getTimer(startTimer({}, TODAY, 'b', NOW, 0), TODAY, 'b'), NOW)).toBe(0);
  });
});

describe('activeEmomId', () => {
  const emom = (id) => makeExercise({ id, timerMode: 'emom', emomWorkSec: 60, emomRestSec: 60 });
  const normal = (id) => makeExercise({ id, timerMode: 'normal' });
  const running = (at) => ({ status: 'running', elapsedMs: 0, runStartedAt: at });

  it('is nothing when no EMOM session is running', () => {
    expect(activeEmomId({}, [emom('a')], TODAY, null)).toBeNull();
    expect(activeEmomId({ [TODAY]: { a: { status: 'paused', elapsedMs: 5, runStartedAt: null } } }, [emom('a')], TODAY, null)).toBeNull();
  });

  it('ignores a running timer on a normal-mode exercise', () => {
    expect(activeEmomId({ [TODAY]: { a: running(100) } }, [normal('a')], TODAY, null)).toBeNull();
  });

  it('is the only running EMOM session when there is one', () => {
    expect(activeEmomId({ [TODAY]: { a: running(100) } }, [emom('a')], TODAY, null)).toBe('a');
  });

  it('is the most recently started when several are running', () => {
    const timers = { [TODAY]: { a: running(100), b: running(900) } };
    expect(activeEmomId(timers, [emom('a'), emom('b')], TODAY, null)).toBe('b');
  });

  it('follows the card you actually have open, even if it started earlier', () => {
    const timers = { [TODAY]: { a: running(100), b: running(900) } };
    expect(activeEmomId(timers, [emom('a'), emom('b')], TODAY, 'a')).toBe('a');
  });

  it('falls back to the most recent when the open card is not a running EMOM session', () => {
    const timers = { [TODAY]: { a: running(100), b: running(900) } };
    expect(activeEmomId(timers, [emom('a'), emom('b'), normal('z')], TODAY, 'z')).toBe('b');
  });
});

describe('one EMOM session at a time', () => {
  const emom = (id) => makeExercise({ id, timerMode: 'emom', emomWorkSec: 60, emomRestSec: 60 });
  const normal = (id) => makeExercise({ id, timerMode: 'normal' });

  it('pauses another running EMOM session when one takes over', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = startTimer(timers, TODAY, 'b', 5000);
    const after = enforceSingleEmom(timers, [emom('a'), emom('b')], TODAY, 'b', 9000);
    expect(after[TODAY].a).toMatchObject({ status: 'paused', elapsedMs: 8000 });
    expect(after[TODAY].b).toMatchObject({ status: 'running', runStartedAt: 5000 });
  });

  it('keeps the time the paused session had already earned', () => {
    let timers = startTimer({}, TODAY, 'a', 0);
    timers = startTimer(timers, TODAY, 'b', 30000);
    const after = enforceSingleEmom(timers, [emom('a'), emom('b')], TODAY, 'b', 30000);
    expect(timerElapsedMs(after[TODAY].a, 999999)).toBe(30000);
  });

  it('leaves a normal-mode clock running — the rule is about EMOM', () => {
    let timers = startTimer({}, TODAY, 'n', 1000);
    timers = startTimer(timers, TODAY, 'b', 5000);
    const after = enforceSingleEmom(timers, [normal('n'), emom('b')], TODAY, 'b', 9000);
    expect(after[TODAY].n.status).toBe('running');
  });

  it('leaves sessions that are already paused or closed alone', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = pauseTimer(timers, TODAY, 'a', 3000);
    timers = startTimer(timers, TODAY, 'c', 4000);
    timers = finishTimer(timers, TODAY, 'c', 6000, 'completed');
    timers = startTimer(timers, TODAY, 'b', 7000);
    const after = enforceSingleEmom(timers, [emom('a'), emom('b'), emom('c')], TODAY, 'b', 9000);
    expect(after[TODAY].a).toMatchObject({ status: 'paused', elapsedMs: 2000 });
    expect(after[TODAY].c.status).toBe('completed');
  });

  it('is a no-op when nothing else is running', () => {
    const timers = startTimer({}, TODAY, 'b', 5000);
    expect(enforceSingleEmom(timers, [emom('b')], TODAY, 'b', 9000)).toBe(timers);
  });

  it('reports nothing to pause versus something paused, so the app can say so', () => {
    let timers = startTimer({}, TODAY, 'a', 1000);
    timers = startTimer(timers, TODAY, 'b', 5000);
    expect(emomSessionsToPause(timers, [emom('a'), emom('b')], TODAY, 'b')).toEqual(['a']);
    expect(emomSessionsToPause(timers, [emom('a'), emom('b')], TODAY, 'a')).toEqual(['b']);
  });
});

describe('merging profiles field by field', () => {
  const snap = (updatedAt, profile) => ({
    version: 1, updatedAt, exercises: [], setsLog: {}, timersLog: {}, streakOverrides: {}, profile,
  });

  it('keeps a photo the newer side simply does not carry', () => {
    // the exact loss: one copy has the picture, a later write elsewhere does not
    const local = snap(5000, { username: 'Johnny', weight: 70, height: 175, avatar: 'data:image/jpeg;base64,AAA' });
    const remote = snap(9000, { username: 'Johnny', weight: 70, height: 175 });
    expect(mergeSyncSnapshots(local, remote).profile.avatar).toBe('data:image/jpeg;base64,AAA');
  });

  it('lets the newer side replace a photo it actually has', () => {
    const local = snap(5000, { username: 'Johnny', avatar: 'data:image/jpeg;base64,OLD' });
    const remote = snap(9000, { username: 'Johnny', avatar: 'data:image/jpeg;base64,NEW' });
    expect(mergeSyncSnapshots(local, remote).profile.avatar).toBe('data:image/jpeg;base64,NEW');
  });

  it('keeps a username, weight and height the newer side has not set', () => {
    const local = snap(5000, { username: 'Johnny', weight: 70, height: 175 });
    const remote = snap(9000, { username: '', weight: null, height: null, avatar: 'data:x' });
    const p = mergeSyncSnapshots(local, remote).profile;
    expect(p).toMatchObject({ username: 'Johnny', weight: 70, height: 175, avatar: 'data:x' });
  });

  it('prefers the newer side wherever it has actually filled a field in', () => {
    const local = snap(5000, { username: 'Old', weight: 70, height: 175 });
    const remote = snap(9000, { username: 'New', weight: 80, height: 180 });
    expect(mergeSyncSnapshots(local, remote).profile).toMatchObject({ username: 'New', weight: 80, height: 180 });
  });

  it('survives a snapshot with no profile at all', () => {
    const local = snap(5000, { username: 'Johnny', avatar: 'data:x' });
    expect(mergeSyncSnapshots(local, snap(9000, undefined)).profile).toMatchObject({ username: 'Johnny', avatar: 'data:x' });
  });
});

describe('storedTokenUsable', () => {
  const NOW = 1_000_000;
  it('accepts a token with real life left in it', () => {
    expect(storedTokenUsable({ token: 't', expiresAt: NOW + 10 * 60000 }, NOW)).toBe(true);
  });
  it('rejects one that has expired', () => {
    expect(storedTokenUsable({ token: 't', expiresAt: NOW - 1 }, NOW)).toBe(false);
  });
  it('rejects one about to expire, so a sync cannot die mid-flight', () => {
    expect(storedTokenUsable({ token: 't', expiresAt: NOW + 5000 }, NOW)).toBe(false);
  });
  it('rejects junk', () => {
    expect(storedTokenUsable(null, NOW)).toBe(false);
    expect(storedTokenUsable({ expiresAt: NOW + 60000 }, NOW)).toBe(false);
    expect(storedTokenUsable({ token: 't' }, NOW)).toBe(false);
  });
});

describe('syncNudge', () => {
  const DAY = 86400000;
  const NOW = 1_700_000_000_000;

  it('says nothing while a sync is recent', () => {
    expect(syncNudge(NOW - 2 * DAY, NOW)).toBeNull();
    expect(syncNudge(NOW - 6.9 * DAY, NOW)).toBeNull();
  });

  it('speaks up once a week has passed', () => {
    expect(syncNudge(NOW - 7 * DAY, NOW)).toEqual({ days: 7 });
    expect(syncNudge(NOW - 21 * DAY, NOW)).toEqual({ days: 21 });
  });

  it('rounds down, so it never overstates how stale things are', () => {
    expect(syncNudge(NOW - 9.8 * DAY, NOW)).toEqual({ days: 9 });
  });

  it('treats never-synced as worth mentioning', () => {
    expect(syncNudge(0, NOW)).toEqual({ days: null });
    expect(syncNudge(null, NOW)).toEqual({ days: null });
  });

  it('never nags about a clock that has drifted forward', () => {
    expect(syncNudge(NOW + 5 * DAY, NOW)).toBeNull();
  });
});

describe('bmiSummary', () => {
  it('computes BMI and calls it normal', () => {
    const s = bmiSummary({ weight: 80, height: 180 });
    expect(s.bmi).toBe(24.7);
    expect(s.category).toBe('normal');
    expect(s.toHealthy).toBe(0);
  });

  it('classifies on the exact cutoffs', () => {
    expect(bmiSummary({ weight: 74, height: 200 }).category).toBe('normal');
    expect(bmiSummary({ weight: 100, height: 200 }).category).toBe('overweight');
    expect(bmiSummary({ weight: 120, height: 200 }).category).toBe('obese');
    expect(bmiSummary({ weight: 73.9, height: 200 }).category).toBe('underweight');
  });

  it('classifies on the unrounded value, so the badge matches the number', () => {
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

describe('weeklyAverages', () => {
  it('has no weeks before the first entry', () => {
    expect(weeklyAverages([], '2026-07-31')).toEqual([]);
    expect(weeklyAverages(null, '2026-07-31')).toEqual([]);
  });

  it('averages each week from the first entry, one decimal', () => {
    const log = [{ d: '2026-07-01', w: 80 }, { d: '2026-07-03', w: 79 }]; // week 1: (80+79)/2 = 79.5
    const w = weeklyAverages(log, '2026-07-05');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ n: 1, weekStart: '2026-07-01', weekEnd: '2026-07-07', avg: 79.5, count: 2, isCurrent: true });
  });

  it('omits weeks with no entry rather than plotting a zero', () => {
    // entry in week 1 and week 3 only; week 2 is a gap
    const log = [{ d: '2026-07-01', w: 80 }, { d: '2026-07-15', w: 78 }];
    const w = weeklyAverages(log, '2026-07-20');
    expect(w.map((x) => x.n)).toEqual([1, 3]);
    expect(w.map((x) => x.avg)).toEqual([80, 78]);
  });

  it('flags the current week and finalizes past weeks', () => {
    const log = [{ d: '2026-07-01', w: 80 }, { d: '2026-07-09', w: 78 }];
    const w = weeklyAverages(log, '2026-07-10');
    expect(w[0].isCurrent).toBe(false);
    expect(w[w.length - 1].isCurrent).toBe(true);
  });

  it('ignores the order entries arrive in', () => {
    const log = [{ d: '2026-07-09', w: 78 }, { d: '2026-07-01', w: 80 }];
    expect(weeklyAverages(log, '2026-07-10').map((x) => x.avg)).toEqual([80, 78]);
  });
});

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

describe('mergeSyncSnapshots — weight log', () => {
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

  it('logging a weight cannot touch the exercise streak', () => {
    const streak = calcStreakInfo(ex, setsLog, '2026-07-30', {});
    recordWeight([], '2026-07-30', 82.4);
    expect(calcStreakInfo(ex, setsLog, '2026-07-30', {})).toEqual(streak);
  });
});

describe('mergeTombstones', () => {
  it('keeps the newer deletion when both sides have the same id', () => {
    expect(mergeTombstones({ a: 100 }, { a: 200 })).toEqual({ a: 200 });
    expect(mergeTombstones({ a: 300 }, { a: 200 })).toEqual({ a: 300 });
  });
  it('unions ids from both sides', () => {
    expect(mergeTombstones({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });
  it('handles missing sides', () => {
    expect(mergeTombstones(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeTombstones({ a: 1 }, null)).toEqual({ a: 1 });
  });
});

describe('mergeSyncSnapshots — deletes stay deleted', () => {
  const snap = (updatedAt, extra) => ({ updatedAt, exercises: [], setsLog: {}, timersLog: {}, streakOverrides: {}, profile: {}, ...extra });

  it('does not resurrect an exercise the local device deleted', () => {
    // local deleted 'push' just now; remote (older) still has it
    const local = snap(200, { exercises: [], deletedExercises: { push: 150 } });
    const remote = snap(100, { exercises: [{ id: 'push', name: 'Push Ups' }] });
    const merged = mergeSyncSnapshots(local, remote);
    expect(merged.exercises.find((e) => e.id === 'push')).toBeUndefined();
    expect(merged.deletedExercises.push).toBe(150);
  });

  it('keeps a genuinely new exercise that reuses no old id', () => {
    const local = snap(200, { exercises: [{ id: 'squat', name: 'Squats' }], deletedExercises: { push: 150 } });
    const remote = snap(100, { exercises: [{ id: 'push', name: 'Push Ups' }] });
    const merged = mergeSyncSnapshots(local, remote);
    expect(merged.exercises.map((e) => e.id)).toEqual(['squat']);
  });
});

describe('schedule change never rewrites history (bug A)', () => {
  // Trained every day Mon 20th – Fri 24th, target 10, all met.
  const log = {};
  for (let d = 20; d <= 24; d++) log[`2026-07-${d}`] = { push: [10] };
  const daily = {
    id: 'push', name: 'Push', active: true, createdDate: '2026-07-20',
    targetHistory: [{ effectiveDate: '2026-07-20', target: 10 }],
    schedule: 'daily',
    scheduleHistory: [{ effectiveDate: '2026-07-20', schedule: 'daily' }],
  };

  it('a day you trained still counts after switching to selected days only', () => {
    // Switch to Mon/Thu today; the daily history must be untouched.
    const switched = { ...daily, schedule: [1, 4],
      scheduleHistory: [
        { effectiveDate: '2026-07-20', schedule: 'daily' },
        { effectiveDate: '2026-07-27', schedule: [1, 4] },
      ] };
    const before = calcStreakInfo([daily], log, '2026-07-24');
    const after = calcStreakInfo([switched], log, '2026-07-24');
    expect(after.longest).toBe(before.longest); // streak identical
    expect(after.longest).toBe(5);           // all five trained days kept
  });

  it('a trained but unscheduled day is still in that day’s stats', () => {
    // Wed 22nd is not in a Mon/Thu schedule, but it was trained.
    const monThu = { ...daily, schedule: [1, 4],
      scheduleHistory: [{ effectiveDate: '2026-07-20', schedule: [1, 4] }] };
    const stats = calcDayStats([monThu], log, '2026-07-22');
    expect(stats.countsForStreak).toBe(true);
    expect(stats.allComplete).toBe(true);
  });

  it('an empty unscheduled day stays a neutral rest day', () => {
    const monThu = { ...daily, schedule: [1, 4],
      scheduleHistory: [{ effectiveDate: '2026-07-20', schedule: [1, 4] }] };
    const stats = calcDayStats([monThu], {}, '2026-07-22'); // Wed, no reps
    expect(stats.countsForStreak).toBe(false);
  });
});

describe('scheduleEffectiveOn picks the schedule in effect', () => {
  const ex = {
    schedule: [1, 4],
    scheduleHistory: [
      { effectiveDate: '2026-07-20', schedule: 'daily' },
      { effectiveDate: '2026-07-27', schedule: [1, 4] },
    ],
  };
  it('returns the past schedule for a past date', () => {
    expect(scheduleEffectiveOn(ex, '2026-07-25')).toBe('daily');
  });
  it('returns the new schedule from its effective date on', () => {
    expect(scheduleEffectiveOn(ex, '2026-07-28')).toEqual([1, 4]);
  });
  it('falls back to the flat schedule with no history', () => {
    expect(scheduleEffectiveOn({ schedule: 'daily' }, '2026-07-25')).toBe('daily');
  });
});

describe('weight conversion and formatting (equipment B)', () => {
  it('converts kg to lb and back, one decimal, preserving the weight', () => {
    expect(convertWeight(12, 'kg', 'lb')).toBe(26.5);
    expect(convertWeight(26.5, 'lb', 'kg')).toBe(12);
  });
  it('is a no-op when units match', () => {
    expect(convertWeight(20, 'kg', 'kg')).toBe(20);
  });
  it('formats a whole number without a decimal, keeps the unit', () => {
    expect(formatWeight(12, 'kg')).toBe('12 kg');
    expect(formatWeight(26.5, 'lb')).toBe('26.5 lb');
  });
  it('shows nothing without a weight', () => {
    expect(formatWeight(null, 'kg')).toBe('');
    expect(formatWeight(0, 'kg')).toBe('');
  });
});

describe('weightProgression (D)', () => {
  it('is null for a bodyweight exercise', () => {
    expect(weightProgression({ equipment: 'bodyweight', weight: 10 })).toBeNull();
  });
  it('shows current when never changed', () => {
    const ex = { equipment: 'dumbbell', weightHistory: [{ effectiveDate: '2026-07-01', weight: 12, unit: 'kg' }] };
    expect(weightProgression(ex)).toMatchObject({ start: 12, current: 12, unit: 'kg', changed: false });
  });
  it('shows start and current once it has gone up', () => {
    const ex = { equipment: 'dumbbell', weightHistory: [
      { effectiveDate: '2026-07-01', weight: 12, unit: 'kg' },
      { effectiveDate: '2026-07-20', weight: 14, unit: 'kg' },
    ] };
    expect(weightProgression(ex)).toMatchObject({ start: 12, current: 14, changed: true });
  });
  it('falls back to the flat weight with no history', () => {
    expect(weightProgression({ equipment: 'dumbbell', weight: 8, weightUnit: 'lb' })).toMatchObject({ current: 8, unit: 'lb', changed: false });
  });
});
