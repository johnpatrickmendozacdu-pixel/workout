// Lifetime performance stats — pure, derived, never stored.
//
// Everything here is computed from setsLog + timersLog on demand rather than
// kept in a parallel "stats" record. That means no migration, no sync schema
// change, and no possibility of stats drifting out of step with the logs they
// describe: editing a past day recomputes the truth for free.

import { calcTotal, getTimer, getEffectiveTarget, workoutSealed, addDays, todayISO, isScheduledOn, isBreakDay, progressValue } from './domain.js';

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
/**
 * Group exercises by the schedule in effect today, so the days they share put
 * them under one heading. Derived every render and never stored, so an exercise
 * moves to its new group the instant its days change. Ordered so daily comes
 * first, then by earliest weekday, then larger groups before smaller.
 */
export function groupBySchedule(exercises, dateStr, scheduleEffectiveOn) {
  const groups = new Map();
  for (const ex of exercises) {
    // A one-off has no weekly pattern, so it cannot share a group with one. It
    // gets its own, or it would sit under "Every day" claiming a schedule it
    // does not have.
    const sched = ex.oneTimeDate ? 'one-time' : scheduleEffectiveOn(ex, dateStr);
    const isOneTime = sched === 'one-time';
    const isDaily = !isOneTime && (!sched || sched === 'daily' || (Array.isArray(sched) && (sched.length === 0 || sched.length === 7)));
    const days = isOneTime ? 'one-time' : (isDaily ? 'daily' : sched.slice().sort((a, b) => a - b));
    const key = isOneTime ? 'one-time' : (isDaily ? 'daily' : days.join(','));
    if (!groups.has(key)) groups.set(key, { key, days, exercises: [] });
    groups.get(key).exercises.push(ex);
  }
  const earliest = (days) => {
    if (days === 'daily') return -1; // daily sorts first
    if (days === 'one-time') return 8; // and a one-off sorts last, below the plan
    const ordered = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
    return ordered.length ? [1, 2, 3, 4, 5, 6, 0].indexOf(ordered[0]) : 7;
  };
  return [...groups.values()].sort((a, b) => {
    const ea = earliest(a.days), eb = earliest(b.days);
    if (ea !== eb) return ea - eb;
    return b.exercises.length - a.exercises.length;
  });
}

export function completedTimes(exId, timersLog) {
  const out = [];
  Object.keys(timersLog).sort().forEach((d) => {
    const t = getTimer(timersLog, d, exId);
    if (t && t.status === 'completed' && t.elapsedMs > 0) out.push({ date: d, ms: t.elapsedMs });
  });
  return out;
}

/**
 * Combo time for a group of exercises that share a schedule: how long the whole
 * day's group takes together. A combo day is a date on which EVERY exercise in
 * the group had a closed session — a partial day is not the combo — and its
 * time is the sum of those sessions. Returns total across all combo days, plus
 * average and best (fastest) combo day. A group of one degenerates to that
 * exercise's own totals, which is correct.
 */
export function comboTimes(groupExercises, timersLog) {
  if (!groupExercises || !groupExercises.length) return { total: 0, avg: null, best: null, days: 0 };
  const dates = new Set();
  Object.keys(timersLog || {}).forEach((d) => dates.add(d));
  const dayMs = [];
  for (const d of dates) {
    let sum = 0;
    let allDone = true;
    for (const ex of groupExercises) {
      const t = getTimer(timersLog, d, ex.id);
      if (t && (t.status === 'completed' || t.status === 'gaveup') && t.elapsedMs > 0) sum += t.elapsedMs;
      else { allDone = false; break; }
    }
    if (allDone && sum > 0) dayMs.push(sum);
  }
  if (!dayMs.length) return { total: 0, avg: null, best: null, days: 0 };
  const total = dayMs.reduce((a, b) => a + b, 0);
  return { total, avg: Math.round(total / dayMs.length), best: Math.min(...dayMs), days: dayMs.length };
}

/** Every closed session's time, finished or given up — total effort, not just wins. */
export function allSessionMs(exId, timersLog) {
  let ms = 0;
  Object.keys(timersLog || {}).forEach((d) => {
    const t = getTimer(timersLog, d, exId);
    if (t && (t.status === 'completed' || t.status === 'gaveup') && t.elapsedMs > 0) ms += t.elapsedMs;
  });
  return ms;
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
    const arr = (setsLog[cursor] && setsLog[cursor][ex.id]) || [];
    const total = calcTotal(arr);
    // A day you trained counts even if today's schedule no longer lists it —
    // history is immutable. Only an empty unscheduled day is a rest day.
    if (target && target > 0 && (isScheduledOn(ex, cursor) || total > 0)) {
      tracked++;
      // A claimed rest day keeps the run alive, and is counted as one of its days.
      if (isBreakDay(overrides, cursor, ex.id)) { run++; breaks++; if (run > best) best = run; }
      else if (progressValue(ex, arr) >= target) {
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
    const arr = (setsLog[date] && setsLog[date][ex.id]) || [];
    const total = calcTotal(arr);
    let state;
    if (ex.createdDate && date < ex.createdDate) state = 'none';
    // A trained day is never a rest day — it shows what happened, whatever the
    // schedule says now. Only an empty unscheduled day is rest.
    else if (!isScheduledOn(ex, date) && total === 0) state = 'rest';
    else if (isBreakDay(overrides, date, ex.id)) state = 'break';
    else {
      const target = getEffectiveTarget(ex, date);
      if (!target || target <= 0) state = 'none';
      else state = progressValue(ex, arr) >= target ? 'hit' : 'miss';
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
  // Top set tracks fresh from the day the exercise started counting it, so old
  // or bad data before that day can never be the record. Sets on or after this
  // date climb it; earlier ones are ignored for Top set only.
  const topSetSince = ex.topSetSince || null;
  const dates = workoutDates(ex.id, setsLog);
  dates.forEach((d) => {
    const arr = setsLog[d][ex.id];
    totalSets += arr.length;

    const dayTotal = calcTotal(arr);
    totalReps += dayTotal;

    // Top set is the most reps in a SINGLE set — a completed fact the instant
    // it is logged. Nothing later in the day can walk it back, so today counts
    // straight away. (25 reps just done IS your top set; waiting for a seal to
    // admit it only reads as broken.)
    if (!topSetSince || d >= topSetSince) {
      arr.forEach((v) => {
        if (v > topSet) { topSet = v; topSetDate = d; }
      });
    }

    // Best day is a daily TOTAL, and it keeps climbing while you train, so it
    // would ratchet up set by set if shown live. That one still waits for the
    // day to seal, or every set of an open session looks like a new record.
    const provisional = d === today
      && !workoutSealed(getTimer(timersLog || {}, d, ex.id), progressValue(ex, arr), getEffectiveTarget(ex, d));
    if (provisional) return;

    if (dayTotal > maxReps) { maxReps = dayTotal; maxRepsDate = d; }
  });

  // Best and Average are about performance, so they only count sessions you
  // finished. Total time is about effort toward the long haul (1000 hours to
  // master), so it counts every real session — a day you gave up two minutes
  // short was still time on the mat.
  const times = completedTimes(ex.id, timersLog);
  const bestTime = times.reduce((best, t) => (best === null || t.ms < best ? t.ms : best), null);
  const avgTime = times.length ? Math.round(times.reduce((a, t) => a + t.ms, 0) / times.length) : null;
  const totalMs = allSessionMs(ex.id, timersLog);
  const totalTime = totalMs > 0 ? totalMs : null;

  const streak = streakInfo(ex, setsLog, todayOverride, overrides);

  // A manual Top Set is an exact correction and always wins — it is how you say
  // "this is my real best" when the logged data is wrong. It never rewrites a
  // set, so totals, Max, lifetime reps and streaks are untouched.
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
    totalTime,
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
/**
 * Daily totals for one exercise across a trailing window, against the target
 * that applied on each of those days.
 *
 * Points exist only for days actually logged, and each carries the number of
 * days since the window started rather than its position in a list. Spacing a
 * line by list index would draw a smooth history that never happened — a week
 * off has to read as a week off, so the renderer places points by real date.
 *
 * maxY covers the tallest target as well as the tallest total, so a target you
 * never reached still shows on the scale, and is at least 1 so no caller can
 * divide by zero on an empty history.
 */
export function trajectorySeries(ex, setsLog, windowDays, todayOverride) {
  const span = Math.max(2, windowDays || 30);
  const today = todayOverride || todayISO();
  const start = addDays(today, -(span - 1));

  const points = [];
  let maxY = 1;
  let minY = Infinity;
  workoutDates(ex.id, setsLog).forEach((d) => {
    if (d < start || d > today) return;
    const total = calcTotal(setsLog[d][ex.id]);
    if (!(total > 0)) return;
    const target = getEffectiveTarget(ex, d);
    // Whole days between the window start and this date.
    const dayIndex = Math.round((Date.parse(d + 'T00:00:00') - Date.parse(start + 'T00:00:00')) / 86400000);
    points.push({ date: d, dayIndex, total, target: target || null,
      hit: !!(target > 0 && progressValue(ex, setsLog[d][ex.id]) >= target) });
    maxY = Math.max(maxY, total, target || 0);
    minY = Math.min(minY, total, target > 0 ? target : total);
  });

  // minY lets the renderer fit the range instead of pinning to zero. A line's
  // job here is "am I climbing", and 60 to 130 squashed against a zero baseline
  // reads as flat. Honest because the two points worth reading are labelled and
  // every exact number sits in the day list directly beneath the chart.
  return { points, span, maxY, minY: points.length ? minY : 0 };
}

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
    const arr = (setsLog[cursor] && setsLog[cursor][ex.id]) || [];
    const totalReps = calcTotal(arr);
    // A trained day belongs in the history whether or not the schedule lists it
    // now — otherwise switching days makes days you did disappear from view.
    if (isScheduledOn(ex, cursor) || totalReps > 0) {
      total++;
      if (rows.length < limit) {
        const target = getEffectiveTarget(ex, cursor);
        rows.push({
          date: cursor,
          isToday: cursor === today,
          target: target || null,
          total: totalReps,
          rest: isBreakDay(overrides, cursor, ex.id),
          // What the target is counted in on this row. In sets mode `total` is
          // still the reps — the day list must never show reps against a sets
          // target, which reads as "16 / 3 reps" and means nothing.
          scored: progressValue(ex, arr),
          hit: !!target && progressValue(ex, arr) >= target,
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

/**
 * A running total meant to grow toward hundreds of hours, so H:MM:SS would just
 * get wider and harder to read. Hours and minutes, seconds dropped as noise at
 * this scale: "45m", "1h 30m", "1,000h".
 */
export function formatTotalDuration(ms) {
  if (ms == null || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`;
}

/**
 * Minutes as words, for time exercises. The stored number is minutes, so this
 * is the one place that decides when it stops being "90 min" and starts being
 * "1h 30m" — anything over an hour reads better broken up.
 */
export function formatMinutes(min) {
  if (min == null || min <= 0) return '—';
  const rounded = Math.round(min * 10) / 10;
  if (rounded < 60) return `${rounded} min`;
  const whole = Math.round(rounded);
  const h = Math.floor(whole / 60), m = whole % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Compact thousands for big lifetime numbers: 12400 -> "12.4k". */
export function formatCount(n) {
  if (n == null) return '—';
  if (n < 10000) return n.toLocaleString();
  if (n < 1000000) return (Math.round(n / 100) / 10).toLocaleString() + 'k';
  return (Math.round(n / 100000) / 10).toLocaleString() + 'M';
}

/**
 * What this phone publishes about itself to a crew.
 *
 * Built here, in the pure layer, because it is a claim about training and every
 * other claim about training is made here — and because it is the one thing
 * that leaves the device, so what it contains has to be readable in one place
 * rather than assembled across a render.
 *
 * It carries totals and streaks, never the log: no individual sets, no dates,
 * no weight, no BMI. A crew can see that you trained today and how long your
 * run is; it cannot reconstruct your week.
 */
const DAY_CHAR = { hit: 'h', break: 'b', miss: 'm', rest: 'r', none: 'n' };

export function buildCrewCard(profile, exercises, statsById, todayTotals, dayStreak, dueToday, targets, strips, doneAt, extra, rests) {
  const active = (exercises || []).filter((e) => e.active && !e.archived);
  const cards = active.map((ex) => {
    const s = (statsById && statsById[ex.id]) || {};
    return {
      name: ex.name,
      category: ex.category || '',
      unit: ex.unit || 'reps',
      streak: s.currentStreak || 0,
      total: s.totalReps || 0,
      today: (todayTotals && todayTotals[ex.id]) || 0,
      // The day, not just the lifetime: a crew watching each other needs to see
      // what someone is down to do and whether they have done it. A total with
      // no target beside it says nothing about being on track.
      target: (targets && targets[ex.id]) || 0,
      due: !!(dueToday && dueToday[ex.id]),
      // The same seven days the Progress card draws, as seven characters, so a
      // crew can see the shape of someone's week without being given the week.
      days: ((strips && strips[ex.id]) || []).map((d) => DAY_CHAR[d] || 'n').join(''),
      // When today's work was finished, and the figures that make a crew card
      // read like the Progress card it mirrors.
      doneAt: (doneAt && doneAt[ex.id]) || 0,
      // A claimed rest day is a decision, not an absence. Without this a crew
      // sees someone who chose to rest and someone who has not started as the
      // same thing — and nudges the wrong one.
      rest: !!(rests && rests[ex.id]),
      top: ((extra && extra[ex.id]) || {}).top || 0,
      bestDay: ((extra && extra[ex.id]) || {}).bestDay || 0,
      avgMs: ((extra && extra[ex.id]) || {}).avgMs || 0,
      totalMs: ((extra && extra[ex.id]) || {}).totalMs || 0,
    };
  });
  return {
    name: (profile && profile.username) || '',
    photo: (profile && profile.avatar) || '',
    streak: dayStreak && dayStreak.current ? dayStreak.current : 0,
    best: dayStreak && dayStreak.longest ? dayStreak.longest : 0,
    // "Trained today" is any logged work at all, not a met target — a crew
    // should see that you turned up, which is the thing worth nudging about.
    trainedToday: cards.some((c) => c.today > 0),
    // Resting is only the whole story when everything due today is a rest day.
    restingToday: cards.some((c) => c.rest) && cards.filter((c) => c.due).every((c) => c.rest || c.today > 0),
    lifetime: {
      reps: cards.reduce((a, c) => a + c.total, 0),
      timeMs: active.reduce((a, ex) => a + (((statsById && statsById[ex.id]) || {}).totalTime || 0), 0),
    },
    exercises: cards,
  };
}

/**
 * How hard the streak flame burns, 0-4.
 *
 * Deliberately not streakTier, which stays 0 until a week and is about earned
 * status. This starts at day one: a flame that stays dead for your first six
 * days is a flame that never rewards starting, which is the moment the reward
 * matters most. No streak means no fire at all.
 */
export function flameLevel(days) {
  const d = Number(days) || 0;
  if (d < 1) return 0;
  if (d < 3) return 1;
  if (d < 7) return 2;
  if (d < 30) return 3;
  return 4;
}

/**
 * Cluster exercises by category, but only where clustering earns its keep.
 *
 * A category with one or two members is not clutter — it is two cards, and
 * hiding them behind a header costs a tap to see what you already could. Eight
 * skate tricks IS clutter, and that is the case worth folding. So a category
 * only becomes a group once it reaches `min`; everything else stays loose and
 * renders exactly as it did.
 *
 * Order is preserved: a cluster takes the position of its first member, so
 * nothing jumps around the screen when a third trick tips it into a group.
 */
export function clusterByCategory(exercises, min = 3) {
  const counts = new Map();
  for (const ex of exercises) {
    const key = ex.category || null;
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  const made = new Map();
  for (const ex of exercises) {
    const key = ex.category || null;
    if (!key || (counts.get(key) || 0) < min) {
      out.push({ type: 'one', ex });
      continue;
    }
    if (!made.has(key)) {
      const cluster = { type: 'cluster', key, exercises: [] };
      made.set(key, cluster);
      out.push(cluster);
    }
    made.get(key).exercises.push(ex);
  }
  return out;
}

/**
 * The biggest single set of the most recent session that has any.
 *
 * Used to prefill a reps target when an exercise has only ever had a sets
 * target: "you did four sets and your best was 10" is a number you recognise,
 * where a blank field is a question you have to answer from memory.
 */
export function lastSessionTopSet(exId, setsLog) {
  const dates = workoutDates(exId, setsLog);
  for (let i = dates.length - 1; i >= 0; i--) {
    const arr = setsLog[dates[i]][exId];
    if (arr && arr.length) {
      const best = Math.max(...arr.filter((v) => v > 0));
      if (best > 0) return best;
    }
  }
  return null;
}
