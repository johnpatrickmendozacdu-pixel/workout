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
export function calcDayStats(exercises, setsLog, dateStr) {
  let targetedCount = 0;
  let completedCount = 0;
  const details = [];

  for (const ex of exercises) {
    if (!ex.active) continue;
    if (ex.createdDate && ex.createdDate > dateStr) continue; // didn't exist yet

    const target = getEffectiveTarget(ex, dateStr);
    const arr = (setsLog[dateStr] && setsLog[dateStr][ex.id]) || [];
    const total = calcTotal(arr);
    const hasTarget = !!target && target > 0;

    let complete = null;
    if (hasTarget) {
      targetedCount++;
      complete = total >= target;
      if (complete) completedCount++;
    }
    details.push({ ex, total, target, hasTarget, complete });
  }

  return {
    targetedCount,
    completedCount,
    allComplete: targetedCount > 0 && completedCount === targetedCount,
    details,
  };
}

/**
 * Current + longest streak. A day only counts toward or against a streak if
 * at least one active, targeted exercise existed that day. Days with zero
 * targeted exercises are neutral: they neither extend nor break a streak.
 */
export function calcStreakInfo(exercises, setsLog, todayOverride) {
  const today = todayOverride || todayISO();

  let streak = 0;
  let cursor = today;
  while (true) {
    const stats = calcDayStats(exercises, setsLog, cursor);
    if (stats.targetedCount === 0) {
      if (cursor === today) {
        cursor = addDays(cursor, -1);
        continue;
      }
      break;
    }
    if (stats.allComplete) {
      streak++;
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

  let longest = 0;
  let running = 0;
  if (earliest) {
    let cur = earliest;
    let guard = 0;
    while (cur <= today && guard < 20000) {
      const stats = calcDayStats(exercises, setsLog, cur);
      if (stats.targetedCount === 0) {
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

  return { current: streak, longest };
}

export function calcWeeklyCompletion(exercises, setsLog, todayOverride) {
  const today = todayOverride || todayISO();
  let completed = 0;
  let counted = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    const stats = calcDayStats(exercises, setsLog, d);
    if (stats.targetedCount > 0) {
      counted++;
      if (stats.allComplete) completed++;
    }
  }
  return counted > 0 ? Math.round((completed / counted) * 100) : null;
}

export function bestDayForExercise(ex, setsLog) {
  let best = null;
  for (const d in setsLog) {
    const arr = setsLog[d][ex.id];
    if (!arr || !arr.length) continue;
    const total = calcTotal(arr);
    if (!best || total > best.total) best = { date: d, total };
  }
  return best;
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
export function setDayTotal(setsLog, dateStr, exId, value) {
  const next = { ...setsLog };
  const dayEntry = { ...(next[dateStr] || {}) };
  if (!(value > 0)) {
    delete dayEntry[exId];
  } else {
    dayEntry[exId] = [clampNum(value)];
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

/** Starts a fresh timer for this exercise today. No-op if one already exists
 * (so logging more sets later in the day never resets progress). */
export function startTimer(timersLog, dateStr, exId, nowMs) {
  if (getTimer(timersLog, dateStr, exId)) return timersLog;
  return setTimerRecord(timersLog, dateStr, exId, { status: 'running', elapsedMs: 0, runStartedAt: nowMs });
}

export function pauseTimer(timersLog, dateStr, exId, nowMs) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!t || t.status !== 'running') return timersLog;
  return setTimerRecord(timersLog, dateStr, exId, {
    status: 'paused', elapsedMs: t.elapsedMs + Math.max(0, nowMs - t.runStartedAt), runStartedAt: null,
  });
}

export function resumeTimer(timersLog, dateStr, exId, nowMs) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!t || t.status !== 'paused') return timersLog;
  return setTimerRecord(timersLog, dateStr, exId, { status: 'running', elapsedMs: t.elapsedMs, runStartedAt: nowMs });
}

/** Ends the timer for the day. outcome is 'completed' (target hit) or 'gaveup'. */
export function finishTimer(timersLog, dateStr, exId, nowMs, outcome) {
  const t = getTimer(timersLog, dateStr, exId);
  if (!t || (t.status !== 'running' && t.status !== 'paused')) return timersLog;
  const elapsedMs = t.status === 'running' ? t.elapsedMs + Math.max(0, nowMs - t.runStartedAt) : t.elapsedMs;
  return setTimerRecord(timersLog, dateStr, exId, { status: outcome, elapsedMs, runStartedAt: null });
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
