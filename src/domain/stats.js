// Lifetime performance stats — pure, derived, never stored.
//
// Everything here is computed from setsLog + timersLog on demand rather than
// kept in a parallel "stats" record. That means no migration, no sync schema
// change, and no possibility of stats drifting out of step with the logs they
// describe: editing a past day recomputes the truth for free.

import { calcTotal, getTimer, getEffectiveTarget, addDays, todayISO, isScheduledOn } from './domain.js';

/** Days (sorted) on which this exercise has any logged set. */
export function workoutDates(exId, setsLog) {
  const dates = [];
  for (const d in setsLog) {
    const arr = setsLog[d] && setsLog[d][exId];
    if (arr && arr.length) dates.push(d);
  }
  return dates.sort();
}

/** Elapsed times (ms) of finished sessions, in date order. Only 'completed'
 *  counts — a session someone gave up on isn't a time. */
export function completedTimes(exId, timersLog) {
  const out = [];
  Object.keys(timersLog).sort().forEach((d) => {
    const t = getTimer(timersLog, d, exId);
    if (t && t.status === 'completed' && t.elapsedMs > 0) out.push({ date: d, ms: t.elapsedMs });
  });
  return out;
}

/**
 * Best run of consecutive days this exercise's target was met, plus how many
 * days it was actually being tracked.
 *
 * A day only participates if the exercise existed and had a target that day —
 * an untargeted day is neutral, neither extending nor breaking the run, since
 * there was nothing to hit. Missing a targeted day ends the run.
 * Reported as best/tracked so "11/15" reads as "best run of 11, over 15 days
 * of training".
 */
export function streakInfo(ex, setsLog, todayOverride) {
  const today = todayOverride || todayISO();
  const dates = workoutDates(ex.id, setsLog);
  let first = ex.createdDate || null;
  if (dates.length && (!first || dates[0] < first)) first = dates[0];
  if (!first) return { best: 0, current: 0, tracked: 0 };

  let best = 0;
  let run = 0;
  let current = 0;
  let tracked = 0;
  let cursor = first;
  let guard = 0;

  while (cursor <= today && guard < 20000) {
    const target = getEffectiveTarget(ex, cursor);
    if (target && target > 0 && isScheduledOn(ex, cursor)) {
      tracked++;
      const total = calcTotal((setsLog[cursor] && setsLog[cursor][ex.id]) || []);
      if (total >= target) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
      // The run still alive at the final tracked day is the current streak.
      current = run;
    }
    cursor = addDays(cursor, 1);
    guard++;
  }

  return { best, current, tracked };
}

/** Month + year of the first logged rep, e.g. "Jul 2026" — the "since" that
 *  gives the lifetime total a period. */
export function lifetimeSince(exId, setsLog) {
  const dates = workoutDates(exId, setsLog);
  if (!dates.length) return null;
  const d = new Date(dates[0] + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * Lifetime stats for one exercise.
 *
 * topSet  — most reps in a SINGLE set (not a daily total).
 * maxReps — highest daily total ever reached (the biggest day).
 */
export function exerciseStats(ex, setsLog, timersLog, todayOverride) {
  let topSet = 0;
  let topSetDate = null;
  let maxReps = 0;
  let maxRepsDate = null;
  let totalSets = 0;
  let totalReps = 0;

  const dates = workoutDates(ex.id, setsLog);
  dates.forEach((d) => {
    const arr = setsLog[d][ex.id];
    totalSets += arr.length;

    const dayTotal = calcTotal(arr);
    totalReps += dayTotal;
    if (dayTotal > maxReps) { maxReps = dayTotal; maxRepsDate = d; }

    arr.forEach((v) => {
      if (v > topSet) { topSet = v; topSetDate = d; }
    });
  });

  const times = completedTimes(ex.id, timersLog);
  const bestTime = times.reduce((best, t) => (best === null || t.ms < best ? t.ms : best), null);
  const avgTime = times.length ? Math.round(times.reduce((a, t) => a + t.ms, 0) / times.length) : null;

  const streak = streakInfo(ex, setsLog, todayOverride);

  // A manual Top Set is a display correction and nothing more: it never
  // rewrites a logged set, so daily totals, Max, lifetime reps and streaks are
  // all left exactly as they were.
  const manual = ex.topSetOverride;
  const hasManual = manual != null && manual !== '' && !isNaN(Number(manual));

  return {
    topSet: hasManual ? Number(manual) : (topSet || null),
    topSetManual: hasManual,
    topSetComputed: topSet || null,
    topSetDate: hasManual ? null : topSetDate,
    maxReps: maxReps || null,
    maxRepsDate,
    totalReps,
    since: lifetimeSince(ex.id, setsLog),
    bestStreak: streak.best,
    currentStreak: streak.current,
    trackedDays: streak.tracked,
    bestTime,
    avgTime,
    totalWorkouts: dates.length,
    totalSets,
    lastWorkout: dates.length ? dates[dates.length - 1] : null,
  };
}

/** Stats for every exercise, keyed by id. */
export function allStats(exercises, setsLog, timersLog, todayOverride) {
  const out = {};
  exercises.forEach((ex) => {
    out[ex.id] = exerciseStats(ex, setsLog, timersLog, todayOverride);
  });
  return out;
}

/** Time of day a session was completed, e.g. "6:42 AM" — the clock log. */
export function formatClock(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

/** Compact thousands for big lifetime numbers: 12400 -> "12.4k". */
export function formatCount(n) {
  if (n == null) return '—';
  if (n < 10000) return n.toLocaleString();
  if (n < 1000000) return (Math.round(n / 100) / 10).toLocaleString() + 'k';
  return (Math.round(n / 100000) / 10).toLocaleString() + 'M';
}
