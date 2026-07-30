// Lifetime performance stats — pure, derived, never stored.
//
// Everything here is computed from setsLog + timersLog on demand rather than
// kept in a parallel "stats" record. That means no migration, no sync schema
// change, and no possibility of stats drifting out of step with the logs they
// describe: editing a past day recomputes the truth for free.

import { calcTotal, getTimer, getEffectiveTarget, workoutSealed, addDays, todayISO, isScheduledOn, isBreakDay } from './domain.js';

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
export function streakInfo(ex, setsLog, todayOverride, overrides) {
  const today = todayOverride || todayISO();
  const dates = workoutDates(ex.id, setsLog);
  let first = ex.createdDate || null;
  if (dates.length && (!first || dates[0] < first)) first = dates[0];
  if (!first) return { best: 0, current: 0, tracked: 0 };

  let best = 0;
  let run = 0;
  let current = 0;
  let tracked = 0;
  let breaks = 0;
  let cursor = first;
  let guard = 0;

  while (cursor <= today && guard < 20000) {
    const target = getEffectiveTarget(ex, cursor);
    if (target && target > 0 && isScheduledOn(ex, cursor)) {
      tracked++;
      const total = calcTotal((setsLog[cursor] && setsLog[cursor][ex.id]) || []);
      // A claimed rest day keeps the run alive, and is counted as one of its days.
      if (isBreakDay(overrides, cursor, ex.id)) { run++; breaks++; if (run > best) best = run; }
      else if (total >= target) {
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

  return { best, current, tracked, breaks };
}

/**
 * The last `n` days for one exercise, oldest first, each classified for the
 * strip on its card. Derived from the same logs as every other figure, so the
 * dots can never disagree with the streak number printed beside them.
 *
 *   hit    — target met that day
 *   break  — claimed as rest, keeps the run alive
 *   miss   — was due, not met
 *   rest   — not scheduled that day, so nothing was due
 *   none   — before the exercise existed, or it had no target
 */
export function recentDayStates(ex, setsLog, overrides, n = 7, todayOverride) {
  const today = todayOverride || todayISO();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    let state;
    if (ex.createdDate && date < ex.createdDate) state = 'none';
    else if (!isScheduledOn(ex, date)) state = 'rest';
    else if (isBreakDay(overrides, date, ex.id)) state = 'break';
    else {
      const target = getEffectiveTarget(ex, date);
      if (!target || target <= 0) state = 'none';
      else {
        const total = calcTotal((setsLog[date] && setsLog[date][ex.id]) || []);
        state = total >= target ? 'hit' : 'miss';
      }
    }
    out.push({ date, state, isToday: date === today });
  }
  return out;
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
 *
 * Records wait for the day to close; counters do not. Today is left out of
 * Top Set and Best day until it is sealed, so a record never means "best so
 * far this afternoon" — it climbed with every set you logged, which made it
 * provisional for the whole session. Lifetime reps, total sets and streaks all
 * keep counting today live, because those are running counts, not records.
 *
 * Best time already worked this way (completedTimes admits only closed
 * sessions), so this makes one rule out of two behaviours rather than adding
 * a new idea. "Sealed" is the existing definition from domain.js — no second,
 * weaker notion of done.
 */
export function exerciseStats(ex, setsLog, timersLog, todayOverride, overrides) {
  let topSet = 0;
  let topSetDate = null;
  let maxReps = 0;
  let maxRepsDate = null;
  let totalSets = 0;
  let totalReps = 0;

  const today = todayOverride || todayISO();
  const dates = workoutDates(ex.id, setsLog);
  dates.forEach((d) => {
    const arr = setsLog[d][ex.id];
    totalSets += arr.length;

    const dayTotal = calcTotal(arr);
    totalReps += dayTotal;

    // An unfinished today is still a running total, not a result to beat.
    const provisional = d === today
      && !workoutSealed(getTimer(timersLog || {}, d, ex.id), dayTotal, getEffectiveTarget(ex, d));
    if (provisional) return;

    if (dayTotal > maxReps) { maxReps = dayTotal; maxRepsDate = d; }
    arr.forEach((v) => {
      if (v > topSet) { topSet = v; topSetDate = d; }
    });
  });

  const times = completedTimes(ex.id, timersLog);
  const bestTime = times.reduce((best, t) => (best === null || t.ms < best ? t.ms : best), null);
  const avgTime = times.length ? Math.round(times.reduce((a, t) => a + t.ms, 0) / times.length) : null;

  const streak = streakInfo(ex, setsLog, todayOverride, overrides);

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
    breakDays: streak.breaks,
    bestTime,
    avgTime,
    totalWorkouts: dates.length,
    totalSets,
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

/**
 * A window onto one exercise's history, newest first.
 *
 * Reach and render are deliberately separate. Walking the calendar is cheap —
 * a decade is a few thousand arithmetic steps — but putting a few thousand
 * rows in the DOM is not. So this counts the whole history and returns only
 * the slice asked for, letting the list reach back as far as the data goes
 * while the page only ever holds what has actually been opened.
 *
 * Bounded by the exercise's own beginning (its createdDate, or its first
 * logged day), so it stops where the history genuinely stops rather than at
 * an arbitrary number.
 */
export function dayHistory(ex, setsLog, overrides, limit, todayOverride) {
  const today = todayOverride || todayISO();
  const logged = workoutDates(ex.id, setsLog);
  let first = ex.createdDate || null;
  if (logged.length && (!first || logged[0] < first)) first = logged[0];
  if (!first) return { rows: [], remaining: 0, total: 0 };

  const rows = [];
  let total = 0;
  let cursor = today;
  let guard = 0;

  while (cursor >= first && guard < 20000) {
    if (isScheduledOn(ex, cursor)) {
      total++;
      if (rows.length < limit) {
        const target = getEffectiveTarget(ex, cursor);
        const totalReps = calcTotal((setsLog[cursor] && setsLog[cursor][ex.id]) || []);
        rows.push({
          date: cursor,
          isToday: cursor === today,
          target: target || null,
          total: totalReps,
          rest: isBreakDay(overrides, cursor, ex.id),
          hit: !!target && totalReps >= target,
        });
      }
    }
    cursor = addDays(cursor, -1);
    guard++;
  }

  return { rows, remaining: Math.max(0, total - rows.length), total };
}

/**
 * How hot a streak reads. The strip only ever shows a week, so once it fills
 * the number has to carry the magnitude on its own — these tiers let it
 * intensify instead of the strip growing arms.
 *
 *   0  under a week — plain
 *   1  a full week held
 *   2  a fortnight
 *   3  a month
 *   4  a hundred days
 */
export function streakTier(days) {
  if (!days || days < 7) return 0;
  if (days < 14) return 1;
  if (days < 30) return 2;
  if (days < 100) return 3;
  return 4;
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
