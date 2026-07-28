// Lifetime performance stats — pure, derived, never stored.
//
// Everything here is computed from setsLog + timersLog on demand rather than
// kept in a parallel "stats" record. That means no migration, no sync schema
// change, and no possibility of stats drifting out of step with the logs they
// describe: editing a past day recomputes the truth for free. Personal records
// are detected by diffing these derived values across a change, so a record
// can never be "missed" or double-counted.

import { calcTotal, calcStreakInfo, getTimer, formatDisplayDate } from './domain.js';

/** Days (sorted) on which this exercise has any logged set. */
export function workoutDates(exId, setsLog) {
  const dates = [];
  for (const d in setsLog) {
    const arr = setsLog[d] && setsLog[d][exId];
    if (arr && arr.length) dates.push(d);
  }
  return dates.sort();
}

/** Elapsed times (ms) of finished sessions for this exercise, in date order.
 *  Only 'completed' counts — a session someone gave up on isn't a time. */
export function completedTimes(exId, timersLog) {
  const out = [];
  Object.keys(timersLog).sort().forEach((d) => {
    const t = getTimer(timersLog, d, exId);
    if (t && t.status === 'completed' && t.elapsedMs > 0) out.push({ date: d, ms: t.elapsedMs });
  });
  return out;
}

/**
 * Lifetime stats for one exercise. Streak fields are scoped to this exercise
 * alone (calcStreakInfo over a single-exercise list), which is what a
 * per-exercise dashboard should show — the global streak stays on Progress.
 */
export function exerciseStats(ex, setsLog, timersLog, todayOverride, overrides) {
  let topSet = 0;
  let topSetDate = null;
  let totalSets = 0;
  let totalReps = 0;

  const dates = workoutDates(ex.id, setsLog);
  dates.forEach((d) => {
    const arr = setsLog[d][ex.id];
    totalSets += arr.length;
    totalReps += calcTotal(arr);
    arr.forEach((v) => {
      if (v > topSet) { topSet = v; topSetDate = d; }
    });
  });

  const times = completedTimes(ex.id, timersLog);
  const bestTime = times.reduce((best, t) => (best === null || t.ms < best ? t.ms : best), null);
  const avgTime = times.length ? Math.round(times.reduce((a, t) => a + t.ms, 0) / times.length) : null;

  const streaks = calcStreakInfo([ex], setsLog, todayOverride, overrides);

  return {
    topSet: topSet || null,
    topSetDate,
    bestTime,
    avgTime,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    totalWorkouts: dates.length,
    totalSets,
    totalReps,
    lastWorkout: dates.length ? dates[dates.length - 1] : null,
  };
}

/** Stats for every exercise, keyed by id. */
export function allStats(exercises, setsLog, timersLog, todayOverride, overrides) {
  const out = {};
  exercises.forEach((ex) => {
    out[ex.id] = exerciseStats(ex, setsLog, timersLog, todayOverride, overrides);
  });
  return out;
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Diff two stat snapshots for one exercise and describe what improved.
 * Returns achievement objects ready to be shown and stored. A first-ever value
 * counts as a record only when there is prior history to beat, so seeding an
 * empty app doesn't spray notifications.
 */
export function detectRecords(prev, next, ex) {
  const out = [];
  const name = ex.name;

  if (next.topSet && (!prev.topSet || next.topSet > prev.topSet)) {
    out.push({
      type: 'top-set',
      icon: '🏆',
      title: 'New Top Set',
      detail: `${name} · ${next.topSet} ${ex.unit} in one set`,
      value: next.topSet,
    });
  }

  if (next.bestTime != null && (prev.bestTime == null || next.bestTime < prev.bestTime)) {
    out.push({
      type: 'best-time',
      icon: '⚡',
      title: 'New Best Time',
      detail: `${name} · ${formatDuration(next.bestTime)}`,
      value: next.bestTime,
    });
  }

  if (next.longestStreak > prev.longestStreak && next.longestStreak > 1) {
    out.push({
      type: 'streak',
      icon: '🔥',
      title: 'Longest Streak',
      detail: `${name} · ${next.longestStreak} days`,
      value: next.longestStreak,
    });
  }

  return out;
}

/** Milestone thresholds worth celebrating once each, on lifetime reps. */
const REP_MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function detectMilestones(prev, next, ex) {
  return REP_MILESTONES.filter((m) => prev.totalReps < m && next.totalReps >= m).map((m) => ({
    type: 'milestone',
    icon: '🎖️',
    title: 'Milestone',
    detail: `${ex.name} · ${m.toLocaleString()} ${ex.unit} lifetime`,
    value: m,
  }));
}

/** Everything worth announcing about one exercise after a change. */
export function achievementsFor(prev, next, ex) {
  return [...detectRecords(prev, next, ex), ...detectMilestones(prev, next, ex)];
}

export function describeLastWorkout(dateStr, todayStr) {
  if (!dateStr) return 'Never';
  if (dateStr === todayStr) return 'Today';
  return formatDisplayDate(dateStr, { month: 'short', day: 'numeric' });
}
