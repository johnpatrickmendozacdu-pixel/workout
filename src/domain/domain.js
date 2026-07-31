// Pure domain logic — no DOM, no storage, no globals.
// Every function here takes its inputs as arguments and returns a new value,
// so it can be unit tested in isolation (see /tests/domain.test.js).

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO() {
  return isoDate(new Date());
}

export function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

export function formatDisplayDate(dateStr, opts) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
}

export function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function clampNum(n) {
  return Math.max(0, Math.round(n * 100) / 100);
}

/**
 * Resolve the target that was in effect for an exercise on a given date.
 * Historic days keep the target that was active at the time, even if it
 * has since been changed — this is what makes streak calculations stable.
 */
/**
 * Which weekdays an exercise is scheduled for. `schedule` is either the string
 * 'daily' (or absent, for everything created before scheduling existed) or an
 * array of weekday numbers, 0=Sunday .. 6=Saturday.
 */
export function isScheduledOn(exercise, dateStr) {
  const sched = exercise.schedule;
  if (!sched || sched === 'daily') return true;
  if (!Array.isArray(sched) || !sched.length) return true;
  const day = new Date(dateStr + 'T00:00:00').getDay();
  return sched.includes(day);
}

export function scheduleLabel(exercise) {
  const sched = exercise.schedule;
  if (!sched || sched === 'daily' || !Array.isArray(sched) || sched.length === 7) return 'Every day';
  if (!sched.length) return 'Every day';
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((d) => sched.includes(d));
  if (ordered.length === 5 && [1,2,3,4,5].every((d) => sched.includes(d))) return 'Weekdays';
  if (ordered.length === 2 && sched.includes(0) && sched.includes(6)) return 'Weekends';
  return ordered.map((d) => NAMES[d]).join(' ');
}

export function getEffectiveTarget(exercise, dateStr) {
  let target = null;
  const hist = (exercise.targetHistory || [])
    .slice()
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  for (const h of hist) {
    if (h.effectiveDate <= dateStr) target = h.target;
    else break;
  }
  return target; // null or 0 => untargeted
}

export function calcTotal(arr) {
  return (arr || []).reduce((a, b) => a + b, 0);
}

/**
 * Day-level stats: how many active, targeted exercises existed on that day,
 * how many of them hit their target, and a per-exercise breakdown.
 * Untargeted exercises are tracked but never affect completion/streaks.
 */
/**
 * overrides is an optional { [dateStr]: true|false } map letting the person
 * manually force a day to count (or not count) toward their streak,
 * independent of what was actually logged — e.g. for a workout done
 * somewhere the app wasn't handy. targetedCount/completedCount always
 * reflect the REAL logged data (so "3/5" stays accurate); only allComplete
 * and countsForStreak are affected by an override.
 */
/**
 * Overrides are per-exercise per-day: { '2026-07-28': { ex_1: 'break' } }.
 * Streaks belong to an exercise, so resting from push-ups must not quietly
 * excuse squats. The key '*' means "every exercise that day", which is what
 * older day-level entries migrate to.
 */
export function getDayOverride(overrides, dateStr, exId) {
  const day = overrides && overrides[dateStr];
  if (day == null) return null;
  if (typeof day !== 'object') return day;              // legacy day-level value
  if (exId && Object.prototype.hasOwnProperty.call(day, exId)) return day[exId];
  if (Object.prototype.hasOwnProperty.call(day, '*')) return day['*'];
  return null;
}

export function isBreakDay(overrides, dateStr, exId) {
  return getDayOverride(overrides, dateStr, exId) === 'break';
}

/** Upgrade any day-level override to the per-exercise shape, so old data keeps
 *  working: a break taken before streaks were per-exercise applied to the whole
 *  day, and still does. */
export function migrateOverrides(overrides) {
  const next = {};
  for (const d in overrides || {}) {
    const v = overrides[d];
    next[d] = (v != null && typeof v === 'object') ? { ...v } : { '*': v };
  }
  return next;
}

export function setDayOverride(overrides, dateStr, exId, value) {
  const next = { ...(overrides || {}) };
  const day = { ...(next[dateStr] && typeof next[dateStr] === 'object' ? next[dateStr] : {}) };
  if (value == null) delete day[exId];
  else day[exId] = value;
  if (Object.keys(day).length === 0) delete next[dateStr];
  else next[dateStr] = day;
  return next;
}

export function calcDayStats(exercises, setsLog, dateStr, overrides) {
  let targetedCount = 0;
  let completedCount = 0;
  const details = [];

  for (const ex of exercises) {
    if (!ex.active) continue;
    if (ex.createdDate && ex.createdDate > dateStr) continue; // didn't exist yet

    if (!isScheduledOn(ex, dateStr)) continue; // rest day — nothing was due
    const target = getEffectiveTarget(ex, dateStr);
    const arr = (setsLog[dateStr] && setsLog[dateStr][ex.id]) || [];
    const total = calcTotal(arr);
    const hasTarget = !!target && target > 0;

    const ov = getDayOverride(overrides, dateStr, ex.id);
    const exBreak = ov === 'break';

    let complete = null;
    let counts = false;
    if (hasTarget || ov != null) {
      targetedCount++;
      counts = true;
      // completedCount stays truthful — it reports what was actually logged, so
      // "3/5" never lies. Only `effective` (what the streak sees) is overridden.
      complete = hasTarget ? total >= target : false;
      if (complete) completedCount++;
    }
    const effective = ov != null ? (exBreak ? true : !!ov) : complete;
    details.push({ ex, total, target, hasTarget, complete, isBreak: exBreak, effective, counts });
  }

  const counted = details.filter((d) => d.counts);

  return {
    targetedCount,
    completedCount,
    allComplete: counted.length > 0 && counted.every((d) => d.effective),
    countsForStreak: counted.length > 0,
    overridden: counted.some((d) => getDayOverride(overrides, dateStr, d.ex.id) != null),
    isBreak: counted.length > 0 && counted.some((d) => d.isBreak) && counted.every((d) => d.effective),
    details,
  };
}

/**
 * Current + longest streak. A day only counts toward or against a streak if
 * at least one active, targeted exercise existed that day, OR the person
 * manually overrode that day via `overrides`. Otherwise it's neutral: it
 * neither extends nor breaks a streak.
 */
export function calcStreakInfo(exercises, setsLog, todayOverride, overrides) {
  const today = todayOverride || todayISO();

  let streak = 0;
  let breaks = 0;
  let cursor = today;
  while (true) {
    const stats = calcDayStats(exercises, setsLog, cursor, overrides);
    if (!stats.countsForStreak) {
      if (cursor === today) {
        cursor = addDays(cursor, -1);
        continue;
      }
      break;
    }
    if (stats.allComplete) {
      streak++;
      if (stats.isBreak) breaks++;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }

  let earliest = null;
  exercises.forEach((ex) => {
    if (ex.createdDate && (!earliest || ex.createdDate < earliest)) earliest = ex.createdDate;
  });
  Object.keys(setsLog).forEach((d) => {
    if (!earliest || d < earliest) earliest = d;
  });
  if (overrides) {
    Object.keys(overrides).forEach((d) => {
      if (!earliest || d < earliest) earliest = d;
    });
  }

  let longest = 0;
  let running = 0;
  if (earliest) {
    let cur = earliest;
    let guard = 0;
    while (cur <= today && guard < 20000) {
      const stats = calcDayStats(exercises, setsLog, cur, overrides);
      if (!stats.countsForStreak) {
        // neutral day
      } else if (stats.allComplete) {
        running++;
        longest = Math.max(longest, running);
      } else {
        running = 0;
      }
      cur = addDays(cur, 1);
      guard++;
    }
  }
  longest = Math.max(longest, streak);

  return { current: streak, longest, breaks };
}

export function calcWeeklyCompletion(exercises, setsLog, todayOverride, overrides) {
  const today = todayOverride || todayISO();
  let completed = 0;
  let counted = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    const stats = calcDayStats(exercises, setsLog, d, overrides);
    if (stats.countsForStreak) {
      counted++;
      if (stats.allComplete) completed++;
    }
  }
  return counted > 0 ? Math.round((completed / counted) * 100) : null;
}

/** Pure reducer: returns a NEW setsLog with a set appended. Does not mutate input. */
export function addSet(setsLog, dateStr, exId, value) {
  if (!(value > 0)) return setsLog;
  const next = { ...setsLog };
  const dayEntry = { ...(next[dateStr] || {}) };
  const arr = (dayEntry[exId] || []).slice();
  arr.push(clampNum(value));
  dayEntry[exId] = arr;
  next[dateStr] = dayEntry;
  return next;
}

/** Pure reducer: returns a NEW setsLog with the set at `index` removed. */
export function removeSetAt(setsLog, dateStr, exId, index) {
  const dayEntry = setsLog[dateStr];
  if (!dayEntry || !dayEntry[exId]) return setsLog;
  const arr = dayEntry[exId].slice();
  if (index < 0 || index >= arr.length) return setsLog;
  arr.splice(index, 1);
  const next = { ...setsLog };
  next[dateStr] = { ...dayEntry, [exId]: arr };
  return next;
}

/** Undo is just "remove the last set for this exercise today". */
export function undoLastSet(setsLog, dateStr, exId) {
  const arr = (setsLog[dateStr] && setsLog[dateStr][exId]) || [];
  if (!arr.length) return setsLog;
  return removeSetAt(setsLog, dateStr, exId, arr.length - 1);
}

/**
 * Pure reducer: overwrite the value of one already-logged set (e.g. fixing a
 * typo). A value of 0 or less removes the set entirely rather than leaving
 * a zero entry.
 */
export function updateSetAt(setsLog, dateStr, exId, index, value) {
  const dayEntry = setsLog[dateStr];
  if (!dayEntry || !dayEntry[exId]) return setsLog;
  const arr = dayEntry[exId].slice();
  if (index < 0 || index >= arr.length) return setsLog;
  if (!(value > 0)) {
    arr.splice(index, 1);
  } else {
    arr[index] = clampNum(value);
  }
  const next = { ...setsLog };
  next[dateStr] = { ...dayEntry, [exId]: arr };
  return next;
}

/**
 * Pure reducer: reduce the most recent set by `amount` (a "minus" quick
 * action to mirror the "+N" chips). If this brings it to zero or below,
 * the set is removed entirely rather than left at zero.
 */
export function decrementLast(setsLog, dateStr, exId, amount) {
  const dayEntry = setsLog[dateStr];
  const arr = dayEntry && dayEntry[exId] ? dayEntry[exId].slice() : [];
  if (!arr.length) return setsLog;
  const reduced = arr[arr.length - 1] - Math.abs(amount);
  if (reduced > 0) arr[arr.length - 1] = clampNum(reduced);
  else arr.pop();
  const next = { ...setsLog };
  next[dateStr] = { ...dayEntry, [exId]: arr };
  return next;
}

/** Pure: remove an exercise from the exercise list entirely (permanent, not archive). */
export function removeExercise(exercises, exId) {
  return exercises.filter((e) => e.id !== exId);
}

/** Pure: strip all logged sets for an exercise across every day (companion to removeExercise). */
export function purgeExerciseSets(setsLog, exId) {
  const next = {};
  for (const d in setsLog) {
    const dayEntry = { ...setsLog[d] };
    delete dayEntry[exId];
    next[d] = dayEntry;
  }
  return next;
}

/**
 * Pure reducer: directly set a day's running total for an exercise. This
 * collapses that day's individual sets into one set equal to the new total
 * (or clears the day entirely if value <= 0) — a quick correction path for
 * when the person just wants "today's number" to read correctly, as an
 * alternative to editing/removing individual sets one at a time.
 */
/**
 * Break a bulk day total into believable sets. Used when someone types a
 * whole day's number without having logged the individual sets: the total is
 *真 real, but the breakdown is unknown, so we must not invent a single set
 * equal to the whole day.
 */
export function splitIntoSets(total, chunk = 20) {
  const t = clampNum(total);
  if (t <= chunk) return [t];
  const out = [];
  let left = t;
  while (left > chunk) { out.push(chunk); left = clampNum(left - chunk); }
  if (left > 0) out.push(left);
  return out;
}

export function setDayTotal(setsLog, dateStr, exId, value) {
  const next = { ...setsLog };
  const dayEntry = { ...(next[dateStr] || {}) };
  const current = (dayEntry[exId] || []).slice();
  const target = clampNum(value);

  if (!(value > 0)) {
    delete dayEntry[exId];
    next[dateStr] = dayEntry;
    return next;
  }

  // Adjust the existing sets to reach the new total rather than collapsing the
  // day into one enormous "set" — that fabricated set used to masquerade as a
  // single-effort record and corrupt Top Set.
  const sum = current.reduce((a, b) => a + b, 0);
  if (!current.length) {
    // A day total typed with nothing logged is NOT one heroic set. Splitting it
    // into plausible chunks keeps Top Set honest — a 110-rep day entered in one
    // go must never masquerade as a 110-rep single set.
    dayEntry[exId] = splitIntoSets(target);
  } else if (target > sum) {
    current.push(clampNum(target - sum));
    dayEntry[exId] = current;
  } else if (target < sum) {
    let remaining = sum - target;
    while (remaining > 0 && current.length) {
      const last = current[current.length - 1];
      if (last > remaining) { current[current.length - 1] = clampNum(last - remaining); remaining = 0; }
      else { remaining = clampNum(remaining - last); current.pop(); }
    }
    dayEntry[exId] = current;
  } else {
    dayEntry[exId] = current;
  }
  next[dateStr] = dayEntry;
  return next;
}

/**
 * ===================== WORKOUT TIMER =====================
 * One timer per (date, exercise). Shape: { status, elapsedMs, runStartedAt }.
 * status: 'running' | 'paused' | 'completed' (hit target) | 'gaveup'.
 * elapsedMs accumulates time while NOT running; while running, live elapsed
 * is elapsedMs + (now - runStartedAt), computed by timerElapsedMs so the
 * stored record only needs writing on state transitions (start/pause/
 * resume/finish) — not every tick, which keeps this lag-free.
 */
export function getTimer(timersLog, dateStr, exId) {
  return (timersLog[dateStr] && timersLog[dateStr][exId]) || null;
}

/**
 * The phase a timer is in, with the not-yet-started case given a name. The card
 * now draws a dormant block before the first rep, so "no record yet" is a state
 * the UI renders rather than an absence it checks for.
 */
export function timerPhase(timer) {
  return timer ? timer.status : 'idle';
}

/**
 * A session is sealed once you deliberately closed it — Take the win, or Log
 * what I did. Crossing the target is NOT enough: that pauses the clock and
 * offers Keep going, which has to stay open or you could never push past a
 * target. Sealed days are read-only in the logger.
 */
export function sessionSealed(timer) {
  const phase = timerPhase(timer);
  return phase === 'completed' || phase === 'gaveup';
}

/**
 * Whether today's work on an exercise is done and therefore read-only.
 *
 * Closing the session seals it, but so does simply meeting the target — most
 * days end by hitting the number and putting the phone down, not by tapping a
 * button, and a day finished before timers existed has no session at all.
 *
 * The exception is choosing to push past the target. That choice is recorded
 * on the timer (`pushingOn`) rather than inferred from its status, so pausing
 * for a break at 120 of 100 cannot silently re-seal a day you kept open.
 *
 * Reps alone never seal an exercise with no target: there is no "done" to
 * reach, so the first rep would otherwise lock the card.
 */
export function workoutSealed(timer, total, target) {
  if (sessionSealed(timer)) return true;
  if (!(target > 0) || !(total >= target)) return false;
  return !(timer && timer.pushingOn);
}

/** Records the choice to carry on past the target. Sticky for the rest of the
 *  day, which is the whole point — see workoutSealed. */
export function markPushingOn(timersLog, dateStr, exId) {
  const t = getTimer(timersLog, dateStr, exId);
  const base = t || { status: 'paused', elapsedMs: 0, runStartedAt: null };
  if (t && t.pushingOn) return timersLog;
  return setTimerRecord(timersLog, dateStr, exId, { ...base, pushingOn: true });
}

/**
 * Deliberate way out of a sealed day, for the mis-tap and the miscount. Two
 * kinds of seal have to come undone: a closed session reverts to paused,
 * keeping every second already earned, and a day sealed merely by meeting its
 * target is marked as pushing on. Landing paused rather than running is
 * deliberate — reopening is not the same as still working, and the clock
 * should not start moving behind a decision you may be about to undo.
 */
export function reopenTimer(timersLog, dateStr, exId) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!sessionSealed(t)) return markPushingOn(timersLog, dateStr, exId);
  return setTimerRecord(timersLog, dateStr, exId, {
    status: 'paused', elapsedMs: t.elapsedMs, runStartedAt: null, finishedAt: null, pushingOn: true,
  });
}

function setTimerRecord(timersLog, dateStr, exId, record) {
  const next = { ...timersLog };
  next[dateStr] = { ...(next[dateStr] || {}), [exId]: record };
  return next;
}

export function timerElapsedMs(timer, nowMs) {
  if (!timer) return 0;
  const runningBit = timer.status === 'running' ? Math.max(0, nowMs - timer.runStartedAt) : 0;
  return timer.elapsedMs + runningBit;
}

export const EMOM_DEFAULT_WORK_SEC = 60;
export const EMOM_DEFAULT_REST_SEC = 60;
/** Five, like every other EMOM timer. Long enough to put the phone down. */
export const EMOM_COUNT_IN_SEC = 5;

/** Seconds of count-in still to run, or 0. Derived from runStartedAt sitting in
 *  the future — see startTimer. */
export function countInLeft(timer, nowMs) {
  if (!timer || timer.status !== 'running' || !timer.runStartedAt) return 0;
  const ms = timer.runStartedAt - nowMs;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * Whether a token kept from a previous run can still be used.
 *
 * Access tokens live about an hour and, with no backend, there is no refresh
 * token — so the one already in hand is worth keeping across launches rather
 * than asking Google for another every time the app opens. A 30 second floor
 * means a sync cannot start on a token that dies mid-flight.
 */
export const TOKEN_MIN_LIFE_MS = 30000;
export function storedTokenUsable(record, nowMs) {
  if (!record || !record.token || !record.expiresAt) return false;
  return record.expiresAt - nowMs > TOKEN_MIN_LIFE_MS;
}

/**
 * Whether it is worth mentioning that sync has fallen behind, and by how much.
 *
 * The app deliberately never nags: an expired Google token is routine and
 * cannot be fixed by interrupting someone. The cost of that silence is that
 * sync can lapse for weeks unnoticed, which is only discovered when a phone is
 * lost. One mention a week is the smallest thing that closes that gap.
 *
 * Returns null while things are fine, { days } once a week has passed, and
 * days: null for an account that has never synced at all.
 */
export const SYNC_NUDGE_AFTER_DAYS = 7;
export function syncNudge(lastSyncAt, nowMs) {
  if (!lastSyncAt) return { days: null };
  const elapsed = nowMs - lastSyncAt;
  if (elapsed < 0) return null; // clock drift: never invent staleness
  const days = Math.floor(elapsed / 86400000);
  return days >= SYNC_NUDGE_AFTER_DAYS ? { days } : null;
}

/**
 * The running EMOM sessions that would have to yield to `keepExId`.
 * Separate from enforcing it so the app can name what it paused.
 */
export function emomSessionsToPause(timersLog, exercises, dateStr, keepExId) {
  const day = (timersLog && timersLog[dateStr]) || {};
  return Object.keys(day).filter((id) => {
    if (id === keepExId) return false;
    const t = day[id];
    if (!t || t.status !== 'running') return false;
    const ex = (exercises || []).find((e) => e.id === id);
    return !!(ex && ex.timerMode === 'emom');
  });
}

/**
 * One EMOM session at a time.
 *
 * You cannot do two structured workouts at once, and two sets of rounds cueing
 * over each other is worse than either alone. Starting or resuming an EMOM
 * session therefore pauses any other that is running — paused, not ended, so
 * every second it earned is kept and it can be picked up again later.
 *
 * Normal-mode clocks are left alone: they are stopwatches, not a schedule
 * competing for your attention.
 */
export function enforceSingleEmom(timersLog, exercises, dateStr, keepExId, nowMs) {
  const doomed = emomSessionsToPause(timersLog, exercises, dateStr, keepExId);
  if (!doomed.length) return timersLog;
  return doomed.reduce((log, id) => pauseTimer(log, dateStr, id, nowMs), timersLog);
}

/**
 * Which EMOM session owns the cues right now.
 *
 * You can only do one exercise at a time, so only one may beep — two running
 * sessions cueing over each other is worse than either alone. The card you have
 * open wins, because that is where your attention is; otherwise it is the
 * session you started most recently, which is the one you moved on to. Resuming
 * a paused session re-asserts it, since resuming sets a fresh runStartedAt.
 */
export function activeEmomId(timersLog, exercises, dateStr, openExId) {
  const day = (timersLog && timersLog[dateStr]) || {};
  const live = Object.keys(day).filter((id) => {
    const t = day[id];
    if (!t || t.status !== 'running') return false;
    const ex = (exercises || []).find((e) => e.id === id);
    return !!(ex && ex.timerMode === 'emom');
  });
  if (!live.length) return null;
  if (openExId && live.includes(openExId)) return openExId;
  return live.sort((a, b) => (day[b].runStartedAt || 0) - (day[a].runStartedAt || 0))[0];
}

/**
 * The beeps due between now and now+lookahead, each with the exact millisecond
 * it should sound at.
 *
 * Returning times rather than firing on detection is the point. A beep fired
 * when a one-second tick *notices* the phase changed can be a full second late,
 * and vanishes entirely if the tab is throttled — useless for a count-in, whose
 * only value is being exactly on time. Every boundary here is arithmetic on
 * timestamps, so the caller can hand these to the audio clock in advance.
 *
 * Ticks belong to the phase they end: a rest shorter than the countdown emits
 * only the ticks that fit inside it, instead of spraying beeps back through the
 * work period.
 */
export function emomBeepSchedule(timer, workSec, restSec, nowMs, lookaheadMs) {
  const out = [];
  if (!timer || timer.status !== 'running') return out;
  const work = Number(workSec);
  const rest = Number(restSec);
  if (!(work > 0) || !(rest >= 0)) return out;

  const until = nowMs + (lookaheadMs > 0 ? lookaheadMs : 0);
  const start = timer.runStartedAt - timer.elapsedMs; // wall time of elapsed 0
  // A small grace window backwards: the first tick of a count-in lands on the
  // very tap that started it, and would otherwise be a few milliseconds stale
  // by the time anything looks — costing the "5" of 5-4-3-2-1. The caller
  // clamps a slightly-past time to "now", so it still sounds on the beat.
  const GRACE_MS = 300;
  const add = (atMs, kind, notBefore) => {
    if (atMs < nowMs - GRACE_MS || atMs > until) return;
    if (notBefore != null && atMs < notBefore) return;
    out.push({ atMs, kind });
  };

  // The count-in: five ticks, then the tone that starts round 1.
  if (timer.runStartedAt > nowMs) {
    for (let k = EMOM_COUNT_IN_SEC; k >= 1; k--) add(timer.runStartedAt - k * 1000, 'tick');
    add(timer.runStartedAt, 'work');
  }

  // Phase boundaries, walked forward from whichever cycle the window touches.
  const cycle = work + rest;
  const elapsedAtUntil = Math.max(0, until - start);
  let n = Math.max(0, Math.floor((Math.max(0, nowMs - start) - cycle * 1000) / (cycle * 1000)));
  for (; n * cycle * 1000 <= elapsedAtUntil + cycle * 1000; n++) {
    const cycleStart = start + n * cycle * 1000;
    // work -> rest, and the rest period is skipped entirely when it is zero
    if (rest > 0) {
      const boundary = cycleStart + work * 1000;
      for (let k = Math.min(EMOM_COUNT_IN_SEC, work); k >= 1; k--) add(boundary - k * 1000, 'tick', cycleStart);
      add(boundary, 'rest');
    }
    // -> next work
    const nextWork = cycleStart + cycle * 1000;
    const phaseStart = rest > 0 ? cycleStart + work * 1000 : cycleStart;
    const room = rest > 0 ? rest : work;
    for (let k = Math.min(EMOM_COUNT_IN_SEC, room); k >= 1; k--) add(nextWork - k * 1000, 'tick', phaseStart);
    add(nextWork, 'work');
  }

  out.sort((a, b) => a.atMs - b.atMs);
  // The count-in's final tone and a boundary can land together; keep one.
  return out.filter((e, i) => i === 0 || e.atMs !== out[i - 1].atMs);
}

/**
 * Where you are in an every-minute-on-the-minute cycle.
 *
 * EMOM stores nothing. It is a pure function of the workout clock's elapsed
 * time, and elapsedMs already excludes paused time — so pausing for the
 * bathroom freezes the cycle, resetting puts it back to round 1, and closing
 * the session stops it, all without a line of new logic. A separate EMOM start
 * timestamp would have had to re-earn every one of those behaviours, and the
 * pause case is the exact reason the pause button exists.
 *
 * A rest of 0 is legal: continuous work with rounds still counting. A cycle
 * that cannot be divided by returns null rather than dividing by zero.
 */
export function emomPhase(elapsedMs, workSec, restSec) {
  const work = Number(workSec);
  const rest = Number(restSec);
  if (!(work > 0) || !(rest >= 0)) return null;
  const cycleSec = work + rest;
  if (!(cycleSec > 0)) return null;

  const t = Math.floor(Math.max(0, elapsedMs) / 1000);
  const pos = t % cycleSec;
  const working = pos < work;
  return {
    phase: working ? 'work' : 'rest',
    round: Math.floor(t / cycleSec) + 1,
    secondsLeft: working ? work - pos : cycleSec - pos,
    cycleSec,
  };
}

/**
 * Starts a fresh timer for this exercise today. No-op if one already exists
 * (so logging more sets later in the day never resets progress).
 *
 * delayMs holds both clocks at zero for a count-in. It needs no extra state:
 * runStartedAt is simply set in the future, and timerElapsedMs already clamps
 * its running portion at zero, so the workout clock reads 0:00 throughout and
 * begins moving at the precise instant the first round does. "A count-in is
 * running" is therefore derivable — runStartedAt is ahead of now — rather than
 * being a second piece of state that could drift out of step.
 */
export function startTimer(timersLog, dateStr, exId, nowMs, delayMs) {
  if (getTimer(timersLog, dateStr, exId)) return timersLog;
  const delay = delayMs > 0 ? delayMs : 0;
  return setTimerRecord(timersLog, dateStr, exId, { status: 'running', elapsedMs: 0, runStartedAt: nowMs + delay });
}

/* Transitions spread the existing record rather than rebuilding it, so a flag
 * set once — pushingOn — survives every pause and resume for the rest of the
 * day instead of quietly vanishing on the next state change. */
export function pauseTimer(timersLog, dateStr, exId, nowMs) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!t || t.status !== 'running') return timersLog;
  return setTimerRecord(timersLog, dateStr, exId, {
    ...t, status: 'paused', elapsedMs: t.elapsedMs + Math.max(0, nowMs - t.runStartedAt), runStartedAt: null,
  });
}

export function resumeTimer(timersLog, dateStr, exId, nowMs) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!t || t.status !== 'paused') return timersLog;
  return setTimerRecord(timersLog, dateStr, exId, { ...t, status: 'running', elapsedMs: t.elapsedMs, runStartedAt: nowMs });
}

/** Ends the timer for the day. outcome is 'completed' (target hit) or 'gaveup'. */
export function finishTimer(timersLog, dateStr, exId, nowMs, outcome) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!t || (t.status !== 'running' && t.status !== 'paused')) return timersLog;
  const elapsedMs = t.status === 'running' ? t.elapsedMs + Math.max(0, nowMs - t.runStartedAt) : t.elapsedMs;
  return setTimerRecord(timersLog, dateStr, exId, { status: outcome, elapsedMs, runStartedAt: null, finishedAt: nowMs });
}

/** Clears today's timer entirely (any status) so the next logged set starts a fresh one from 0:00.
 * Since Progress reads timers live from timersLog, the reset is reflected there automatically. */
export function resetTimer(timersLog, dateStr, exId) {
  if (!getTimer(timersLog, dateStr, exId)) return timersLog;
  const next = { ...timersLog };
  const dayEntry = { ...(next[dateStr] || {}) };
  delete dayEntry[exId];
  next[dateStr] = dayEntry;
  return next;
}

/**
 * If today's total newly beats today's effective target, raise the target
 * to match (a "you just set a new PR, so that's the new bar" auto-bump).
 * Returns the same exercise reference if nothing changed, so callers can
 * cheaply check `updated !== ex` to know whether a PR just happened.
 */
export function bumpTargetIfPR(exercise, dateStr, total) {
  const current = getEffectiveTarget(exercise, dateStr);
  if (!current || total <= current) return exercise;
  const history = exercise.targetHistory.slice();
  const idx = history.findIndex((h) => h.effectiveDate === dateStr);
  if (idx >= 0) history[idx] = { ...history[idx], target: total };
  else history.push({ effectiveDate: dateStr, target: total });
  return { ...exercise, targetHistory: history };
}

/**
 * Set the target that applies on ONE specific day, without disturbing any
 * later day. Used to correct history from the Progress screen: if a past day's
 * target was wrong, you fix that day and the streak recounts, while today and
 * every day in between keep the target they already had.
 *
 * Because targets resolve forward (getEffectiveTarget takes the latest entry
 * on-or-before a date), writing an entry at `dateStr` would normally carry
 * onward. To confine it, we note what the following day resolved to first, and
 * write a restoring entry there if the edit would otherwise have changed it.
 *
 * A target of 0, null, or NaN means "untargeted that day" — the day then goes
 * neutral for streaks rather than counting as a failure.
 * Returns the same exercise reference when nothing changed.
 */
export function setTargetForDay(exercise, dateStr, newTarget) {
  const parsed = newTarget == null || newTarget === '' ? null : Number(newTarget);
  const target = parsed == null || isNaN(parsed) || parsed <= 0 ? null : clampNum(parsed);

  if (getEffectiveTarget(exercise, dateStr) === target) return exercise;

  const nextDay = addDays(dateStr, 1);
  const carried = getEffectiveTarget(exercise, nextDay);

  const upsert = (history, effectiveDate, value) => {
    const next = history.slice();
    const idx = next.findIndex((h) => h.effectiveDate === effectiveDate);
    if (idx >= 0) next[idx] = { ...next[idx], target: value };
    else next.push({ effectiveDate, target: value });
    return next;
  };

  let history = upsert(exercise.targetHistory || [], dateStr, target);
  if (getEffectiveTarget({ targetHistory: history }, nextDay) !== carried) {
    history = upsert(history, nextDay, carried);
  }

  return { ...exercise, targetHistory: history };
}

/** 'latest' | 'stale' | 'unknown' — unknown when the server copy is unreachable
 *  (offline), which must not be shown as either reassurance or alarm. */
export function versionStatus(localBuild, remoteBuild) {
  if (!remoteBuild || !localBuild) return 'unknown';
  return localBuild === remoteBuild ? 'latest' : 'stale';
}

/**
 * ===================== SYNC MERGE =====================
 * Combines this device's snapshot with the one in the cloud.
 *
 * The merge is a UNION, not a choice. Sync used to compare one timestamp and
 * keep a whole side, so training offline and then syncing after any other copy
 * had written meant your session was replaced outright. Anything present on
 * only one side is now always kept — that single property is the fix, because
 * the damaging case is always "these reps exist in exactly one place".
 *
 * A genuine conflict — both sides holding a different record for the SAME day
 * and the SAME exercise — still needs a winner, and that is the snapshot with
 * the newer updatedAt. Local wins ties: preferring the device in your hand is
 * the less surprising default.
 *
 * Two properties make repeated syncs converge rather than oscillate, and both
 * are covered by tests: merging a merged snapshot again changes nothing
 * (idempotent), and merging in either order reaches the same set of days and
 * exercises.
 *
 * Known limits, accepted deliberately and documented in the spec: two devices
 * editing the same exercise on the same day resolve to the later writer for
 * that day, and union has no tombstones, so an exercise deleted on one device
 * comes back from a device that still has it. Deleting again is cheap; losing a
 * history is not.
 */
function mergeByDayKey(winner, loser) {
  const out = {};
  const dates = new Set([...Object.keys(loser || {}), ...Object.keys(winner || {})]);
  dates.forEach((d) => {
    const merged = { ...((loser || {})[d] || {}), ...((winner || {})[d] || {}) };
    if (Object.keys(merged).length) out[d] = merged;
  });
  return out;
}

/** Union by id, keeping the winner's ordering and appending ids it lacks. */
function mergeExerciseLists(winner, loser) {
  const out = (winner || []).slice();
  const seen = new Set(out.map((e) => e.id));
  (loser || []).forEach((e) => { if (!seen.has(e.id)) out.push(e); });
  return out;
}

/**
 * Profiles merge field by field, never as a whole object.
 *
 * Swapping the whole object meant any field the newer side happened not to
 * carry was destroyed — a device that had never set a picture would silently
 * delete one that had. Each field is taken from the newer side only where it
 * actually holds something, and otherwise kept from the other.
 *
 * The trade-off, taken knowingly and consistent with the rest of this merge:
 * clearing a field is not a tombstone, so removing a picture on one device can
 * be undone by another that still has it. Removing it again is a tap; losing a
 * photo without noticing is not.
 */
function mergeProfiles(winner, loser) {
  const w = winner || {};
  const l = loser || {};
  const has = (v) => v !== undefined && v !== null && v !== '';
  const pick = (k) => (has(w[k]) ? w[k] : (has(l[k]) ? l[k] : w[k]));
  return {
    ...l,
    ...w,
    username: pick('username'),
    weight: pick('weight'),
    height: pick('height'),
    avatar: pick('avatar'),
  };
}

export function mergeSyncSnapshots(local, remote) {
  if (!remote) return local;
  const localAt = local.updatedAt || 0;
  const remoteAt = remote.updatedAt || 0;
  const remoteWins = remoteAt > localAt;
  const winner = remoteWins ? remote : local;
  const loser = remoteWins ? local : remote;

  return {
    version: 1,
    updatedAt: Math.max(localAt, remoteAt),
    exercises: mergeExerciseLists(winner.exercises, loser.exercises),
    setsLog: mergeByDayKey(winner.setsLog, loser.setsLog),
    timersLog: mergeByDayKey(winner.timersLog, loser.timersLog),
    streakOverrides: mergeByDayKey(winner.streakOverrides, loser.streakOverrides),
    profile: mergeProfiles(winner.profile, loser.profile),
  };
}

export function buildBackup(exercises, setsLog) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    exercises,
    setsLog,
  };
}

/** Returns an error string, or null if the backup object is valid. */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'File is not valid JSON.';
  if (!Array.isArray(obj.exercises)) return 'Missing exercise list.';
  if (typeof obj.setsLog !== 'object' || obj.setsLog === null) return 'Missing set history.';
  for (const ex of obj.exercises) {
    if (!ex.id || !ex.name) return 'An exercise is missing required fields.';
  }
  return null;
}

/** Merge: keep local exercises/sets, add anything from the import that isn't already present. */
export function mergeBackup(localExercises, localSetsLog, imported) {
  const existingIds = new Set(localExercises.map((e) => e.id));
  const exercises = localExercises.slice();
  imported.exercises.forEach((ex) => {
    if (!existingIds.has(ex.id)) exercises.push(ex);
  });

  const setsLog = { ...localSetsLog };
  for (const d in imported.setsLog) {
    setsLog[d] = { ...(setsLog[d] || {}) };
    for (const exId in imported.setsLog[d]) {
      if (!setsLog[d][exId]) setsLog[d][exId] = imported.setsLog[d][exId];
    }
  }
  return { exercises, setsLog };
}
