import { describe, it, expect } from 'vitest';
import {
  addDays,
  getEffectiveTarget,
  calcTotal,
  calcDayStats,
  recordProof,
  bumpTargetIfPR,
  getEffectiveTarget,
  retakesLeft,
  proofRequiredOn,
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
  bankTimeSession,
  stampFinished,
  isTimeMode,
  minutesFromMs,
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
  progressValue,
  targetMet,
  targetUnit,
  calcDayStats,
  mergeHabitLogs,
  SNAPSHOT_DATA_KEYS,
  storedTokenUsable,
  bmiSummary,
  weightTrend,
  weeklyAverages,
  deepEqual,
  proofMediaLive,
  expiredProofMedia,
  dropFromByDay,
  purgeExerciseFromByDay,
  sameSnapshotData,
  recordWeight,
  mergeTombstones,
  syncNudge,
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

  it('records a new day even at the same weight, so a daily log marks the day done', () => {
    const log = [{ d: '2026-06-12', w: 85.6 }];
    expect(recordWeight(log, '2026-07-31', 85.6)).toEqual([
      { d: '2026-06-12', w: 85.6 }, { d: '2026-07-31', w: 85.6 },
    ]);
  });

  it('does not double-log the same day at the same weight', () => {
    const log = [{ d: '2026-07-31', w: 85.6 }];
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

describe('one-time workouts are scheduled on exactly one day', () => {
  const oneOff = { id: 'ot', oneTimeDate: '2026-08-04', schedule: 'daily' };

  it('is scheduled on its own date', () => {
    expect(isScheduledOn(oneOff, '2026-08-04')).toBe(true);
  });

  it('is not scheduled on any other day, so it can never be a missed day', () => {
    expect(isScheduledOn(oneOff, '2026-08-05')).toBe(false);
    expect(isScheduledOn(oneOff, '2026-08-03')).toBe(false);
  });

  it('ignores a schedule it happens to carry — the date wins', () => {
    const withDays = { id: 'ot2', oneTimeDate: '2026-08-04', schedule: [0, 1, 2, 3, 4, 5, 6] };
    expect(isScheduledOn(withDays, '2026-08-05')).toBe(false);
  });

  it('leaves ordinary exercises alone', () => {
    expect(isScheduledOn({ id: 'a', schedule: 'daily' }, '2026-08-05')).toBe(true);
  });
});

describe('a one-off is labelled One time, not a weekday list', () => {
  it('labels by the one-off flag rather than the schedule it happens to carry', () => {
    expect(scheduleLabel({ schedule: 'one-time' })).toBe('One time');
    expect(scheduleLabel({ schedule: 'daily', oneTimeDate: '2026-08-04' })).toBe('One time');
  });
});

describe('sameSnapshotData — the sync re-render guard', () => {
  const base = () => ({
    exercises: [{ id: 'a', name: 'Push' }],
    deletedExercises: {}, setsLog: { '2026-08-01': { a: [10] } },
    timersLog: {}, profile: { username: 'J' }, streakOverrides: {},
  });

  it('sees identical data as identical, even with different key order', () => {
    const a = base();
    const b = base();
    b.setsLog = { '2026-08-01': { a: [10] } }; // rebuilt object, same content
    // reorder profile keys
    b.profile = { username: 'J' };
    expect(sameSnapshotData(a, b)).toBe(true);
  });

  it('ignores metadata differences (updatedAt, version)', () => {
    const a = { ...base(), updatedAt: 1, version: 1 };
    const b = { ...base(), updatedAt: 999, version: 1 };
    expect(sameSnapshotData(a, b)).toBe(true);
  });

  it('detects a real change', () => {
    const a = base();
    const b = base();
    b.setsLog = { '2026-08-01': { a: [10, 5] } }; // remote added a set
    expect(sameSnapshotData(a, b)).toBe(false);
  });

  it('detects a new exercise from another device', () => {
    const a = base();
    const b = base();
    b.exercises = [{ id: 'a', name: 'Push' }, { id: 'b', name: 'Squat' }];
    expect(sameSnapshotData(a, b)).toBe(false);
  });
});

describe('deepEqual', () => {
  it('is order-insensitive for object keys', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it('is order-sensitive for arrays', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
  it('handles nested and null', () => {
    expect(deepEqual({ x: { y: [1, { z: null }] } }, { x: { y: [1, { z: null }] } })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('time exercises', () => {
  it('only counts as time mode when the exercise says so', () => {
    expect(isTimeMode({ mode: 'time' })).toBe(true);
    expect(isTimeMode({ unit: 'min' })).toBe(false);   // an old exercise counting minutes is still reps
    expect(isTimeMode(null)).toBe(false);
  });

  it('reads the clock in tenths of a minute', () => {
    expect(minutesFromMs(30 * 60000)).toBe(30);
    expect(minutesFromMs(90 * 1000)).toBe(1.5);
    expect(minutesFromMs(0)).toBe(0);
    expect(minutesFromMs(null)).toBe(0);
  });

  it('banks a session as ONE entry, never split', () => {
    const log = bankTimeSession({}, '2026-08-10', 'ex1', 110);
    expect(log['2026-08-10'].ex1).toEqual([110]);      // splitIntoSets would have made six
  });

  it('overwrites rather than accumulating, because the clock only grows', () => {
    let log = bankTimeSession({}, '2026-08-10', 'ex1', 12);
    log = bankTimeSession(log, '2026-08-10', 'ex1', 30);
    expect(log['2026-08-10'].ex1).toEqual([30]);
    expect(calcTotal(log['2026-08-10'].ex1)).toBe(30);
  });

  it('clears the day when the clock is reset to nothing', () => {
    let log = bankTimeSession({}, '2026-08-10', 'ex1', 30);
    log = bankTimeSession(log, '2026-08-10', 'ex1', 0);
    expect(log['2026-08-10'].ex1).toBeUndefined();
  });

  it('leaves other exercises on the day alone', () => {
    const log = bankTimeSession({ '2026-08-10': { other: [10] } }, '2026-08-10', 'ex1', 5);
    expect(log['2026-08-10'].other).toEqual([10]);
  });

  it('makes the day complete once the banked minutes reach the target', () => {
    const ex = { id: 'ex1', mode: 'time', unit: 'min', active: true, schedule: 'daily',
      targetHistory: [{ effectiveDate: '2026-08-01', target: 30 }] };
    const log = bankTimeSession({}, '2026-08-10', 'ex1', 30);
    expect(calcDayStats([ex], log, '2026-08-10', {}).allComplete).toBe(true);
  });
});


describe('stampFinished', () => {
  const base = { '2026-08-12': { ex1: { status: 'paused', elapsedMs: 1000, runStartedAt: null } } };

  it('records when the day was finished', () => {
    const out = stampFinished(base, '2026-08-12', 'ex1', 1770000000000);
    expect(out['2026-08-12'].ex1.finishedAt).toBe(1770000000000);
  });

  it('never overwrites, so the stamp is when you got there', () => {
    const first = stampFinished(base, '2026-08-12', 'ex1', 100);
    const again = stampFinished(first, '2026-08-12', 'ex1', 999);
    expect(again['2026-08-12'].ex1.finishedAt).toBe(100);
    expect(again).toBe(first);                       // unchanged, same reference
  });

  it('does nothing without a timer to stamp', () => {
    expect(stampFinished({}, '2026-08-12', 'ex1', 100)).toEqual({});
  });
});

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

describe('sets as the target, not reps', () => {
  const repsEx = { id: 'r', active: true, createdDate: '2026-08-01', schedule: 'daily',
    targetHistory: [{ effectiveDate: '2026-08-01', target: 40 }] };
  const setsEx = { id: 's', active: true, createdDate: '2026-08-01', schedule: 'daily',
    targetMode: 'sets', targetHistory: [{ effectiveDate: '2026-08-01', target: 3 }] };

  it('counts reps in reps mode and sets in sets mode', () => {
    expect(progressValue(repsEx, [8, 8, 15])).toBe(31);
    expect(progressValue(setsEx, [8, 8, 15])).toBe(3);
  });

  it('treats a missing mode as reps, so nothing already logged changes meaning', () => {
    expect(progressValue({}, [10, 10])).toBe(20);
    expect(progressValue(undefined, [10, 10])).toBe(20);
  });

  it('finishes three sets of anything', () => {
    // the user's own example: 8, 8, 15 against a target of 3 sets
    expect(targetMet(setsEx, [8, 8, 15], 3)).toBe(true);
    expect(targetMet(setsEx, [8, 8], 3)).toBe(false);
  });

  it('does not finish on reps alone in sets mode', () => {
    // 500 reps in two sets is still two sets
    expect(targetMet(setsEx, [250, 250], 3)).toBe(false);
  });

  it('drives the streak, not just the label', () => {
    const log = { '2026-08-10': { s: [8, 8, 15] } };
    const stats = calcDayStats([setsEx], log, '2026-08-10', {});
    expect(stats.allComplete).toBe(true);
    const short = calcDayStats([setsEx], { '2026-08-10': { s: [8, 8] } }, '2026-08-10', {});
    expect(short.allComplete).toBe(false);
  });

  it('reports the unit it is counted in', () => {
    expect(targetUnit(setsEx)).toBe('sets');
    expect(targetUnit({ unit: 'reps' })).toBe('reps');
    expect(targetUnit({ unit: 'km' })).toBe('km');
  });
});

describe('proof of workout', () => {
  const ex = { id: 'e1', active: true, createdDate: '2026-08-01', schedule: 'daily',
    targetHistory: [{ effectiveDate: '2026-08-01', target: 10 }] };
  const done = { '2026-08-20': { e1: [10] } };

  it('leaves days before the rule alone', () => {
    const old = { '2026-08-05': { e1: [10] } };
    const stats = calcDayStats([ex], old, '2026-08-05', {}, { log: {}, since: '2026-08-16' });
    expect(stats.allComplete).toBe(true);
  });

  it('withholds completion once the rule applies and there is no photo', () => {
    const stats = calcDayStats([ex], done, '2026-08-20', {}, { log: {}, since: '2026-08-16' });
    expect(stats.allComplete).toBe(false);
    expect(stats.completedCount).toBe(0);
  });

  it('completes once proof is recorded', () => {
    const log = recordProof({}, '2026-08-20', 'e1', 1000);
    const stats = calcDayStats([ex], done, '2026-08-20', {}, { log, since: '2026-08-16' });
    expect(stats.allComplete).toBe(true);
  });

  it('never gates when no proof rule is passed at all', () => {
    expect(calcDayStats([ex], done, '2026-08-20', {}).allComplete).toBe(true);
  });

  it('counts retakes and stops at three', () => {
    let log = recordProof({}, '2026-08-20', 'e1', 1);
    expect(retakesLeft(log, '2026-08-20', 'e1')).toBe(3);
    for (let i = 0; i < 3; i++) log = recordProof(log, '2026-08-20', 'e1', i + 2);
    expect(retakesLeft(log, '2026-08-20', 'e1')).toBe(0);
    const frozen = recordProof(log, '2026-08-20', 'e1', 99);
    expect(frozen).toBe(log);
  });

  it('keeps the day finished even when the picture is gone', () => {
    // a new phone has the record but no images — history must survive
    const log = recordProof({}, '2026-08-20', 'e1', 1000);
    const stats = calcDayStats([ex], done, '2026-08-20', {}, { log, since: '2026-08-16' });
    expect(stats.allComplete).toBe(true);
  });
});

describe('bumpTargetIfPR in sets mode', () => {
  const setsEx = { id: 'sx', targetMode: 'sets',
    targetHistory: [{ effectiveDate: '2026-08-01', target: 3 }] };

  it('never rewrites a sets target from a rep total', () => {
    // two sets of three: 6 reps must not beat "3 sets"
    const after = bumpTargetIfPR(setsEx, '2026-08-16', 6);
    expect(after).toBe(setsEx);
    expect(getEffectiveTarget(after, '2026-08-16')).toBe(3);
  });

  it('still raises a reps target on a genuine PR', () => {
    const repsEx = { id: 'r', targetHistory: [{ effectiveDate: '2026-08-01', target: 40 }] };
    expect(getEffectiveTarget(bumpTargetIfPR(repsEx, '2026-08-16', 55), '2026-08-16')).toBe(55);
  });
});

describe('proof media lifetime', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const log = {
    '2026-08-17': { ex1: { at: 1000000, retakes: 0 }, ex2: { at: 1000000, retakes: 0 } },
    '2026-08-16': { ex1: { at: 1000000 - 2 * DAY, retakes: 0 } },
  };

  it('keeps media younger than 24 hours', () => {
    expect(proofMediaLive(log, '2026-08-17', 'ex1', 1000000 + 1000)).toBe(true);
  });

  it('expires media older than 24 hours', () => {
    expect(proofMediaLive(log, '2026-08-17', 'ex1', 1000000 + DAY + 1)).toBe(false);
  });

  it('treats media with no proof record as expired', () => {
    expect(proofMediaLive(log, '2026-08-17', 'nope', 1000000)).toBe(false);
  });

  it('lists every expired entry as date and exercise', () => {
    const byDay = { '2026-08-17': { ex1: 'a', ex2: 'b' }, '2026-08-16': { ex1: 'c' } };
    expect(expiredProofMedia(byDay, log, 1000000 + 1000)).toEqual([
      { date: '2026-08-16', exId: 'ex1' },
    ]);
  });

  it('drops listed entries and removes days left empty', () => {
    const byDay = { '2026-08-17': { ex1: 'a', ex2: 'b' }, '2026-08-16': { ex1: 'c' } };
    const next = dropFromByDay(byDay, [{ date: '2026-08-16', exId: 'ex1' }, { date: '2026-08-17', exId: 'ex1' }]);
    expect(next).toEqual({ '2026-08-17': { ex2: 'b' } });
    expect(byDay['2026-08-16']).toBeTruthy();
  });

  it('purges one exercise from every day and drops days left empty', () => {
    const byDay = { '2026-08-17': { ex1: 'a', ex2: 'b' }, '2026-08-16': { ex1: 'c' } };
    expect(purgeExerciseFromByDay(byDay, 'ex1')).toEqual({ '2026-08-17': { ex2: 'b' } });
  });

  it('returns the same object when a purge changes nothing', () => {
    const byDay = { '2026-08-17': { ex2: 'b' } };
    expect(purgeExerciseFromByDay(byDay, 'ex1')).toBe(byDay);
  });
});
