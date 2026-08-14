// Health habits — pure domain. No DOM, no storage, no globals.
//
// A habit's day runs 5:00 AM to 4:59 AM the next morning. That is not a
// preference: the user's own meal windows start at 5 AM, and it means a 1 AM
// raid breaks the night you are still living rather than the morning you have
// not started. Only habit code calls habitDay() — todayISO() keeps meaning
// exactly what it means everywhere else in the app.

import { isoDate, addDays, isScheduledOn, uid } from './domain.js';

export const HABIT_DAY_START_HOUR = 5;

/** The three blocks, in minutes since 5 AM. They tile 0..1439 with no gap, so
 *  every moment of the day belongs to exactly one of them. */
export const HABIT_BLOCKS = [
  { key: 'morning', label: 'Morning', start: 0, end: 419, window: '5:00 AM – 11:59 AM' },
  { key: 'midday', label: 'Midday', start: 420, end: 779, window: '12:00 PM – 5:59 PM' },
  { key: 'evening', label: 'Evening', start: 780, end: 1439, window: '6:00 PM – 4:59 AM' },
];

export const HABIT_SLOTS = [
  { key: 'breakfast', label: 'Breakfast', block: 'morning' },
  { key: 'morningSnack', label: 'Morning snack', block: 'morning' },
  { key: 'lunch', label: 'Lunch', block: 'midday' },
  { key: 'afternoonSnack', label: 'Afternoon snack', block: 'midday' },
  { key: 'dinner', label: 'Dinner', block: 'evening' },
  { key: 'eveningSnack', label: 'Evening snack', block: 'evening' },
];

/** A plain habit is one tap for the whole day. Giving it a slot key of its own
 *  means both shapes share one log and one set of functions. */
export const PLAIN_SLOT = 'day';
const PLAIN_SLOTS = [{ key: PLAIN_SLOT, label: 'Today', block: null }];

export function slotsFor(habit) {
  return habit && habit.kind === 'meals' ? HABIT_SLOTS : PLAIN_SLOTS;
}

export function habitDay(nowMs) {
  return isoDate(new Date(nowMs - HABIT_DAY_START_HOUR * 3600000));
}

/** Minutes since this habit day began, 0..1439. */
export function habitMinute(nowMs) {
  const d = new Date(nowMs);
  return (d.getHours() * 60 + d.getMinutes() - HABIT_DAY_START_HOUR * 60 + 1440) % 1440;
}

export function blockOf(slotKey) {
  const slot = HABIT_SLOTS.find((s) => s.key === slotKey);
  if (!slot) return null;
  return HABIT_BLOCKS.find((b) => b.key === slot.block) || null;
}

export function blockAt(nowMs) {
  const m = habitMinute(nowMs);
  return HABIT_BLOCKS.find((b) => m >= b.start && m <= b.end) || HABIT_BLOCKS[0];
}

/** Logged inside its own block, or caught up later. Derived from the tap's
 *  timestamp — never stored, so it cannot drift from the clock. */
export function isLive(slotKey, atMs) {
  const b = blockOf(slotKey);
  if (!b) return true;
  const m = habitMinute(atMs);
  return m >= b.start && m <= b.end;
}

/* ============================== THE LOG ============================== */

export const SLOT_VALUES = ['kept', 'skip', 'broke'];

function entryAt(habitLog, day, habitId) {
  return (habitLog && habitLog[day] && habitLog[day][habitId]) || null;
}

export function slotAt(habitLog, day, habitId, slotKey) {
  const e = entryAt(habitLog, day, habitId);
  return (e && e.slots && e.slots[slotKey]) || null;
}

export function hasAnySlot(habitLog, day, habitId) {
  const e = entryAt(habitLog, day, habitId);
  return !!(e && e.slots && Object.keys(e.slots).length);
}

export function isOffPlan(habitLog, day, habitId) {
  const e = entryAt(habitLog, day, habitId);
  return !!(e && e.off);
}

/** Rewrites one habit's entry on one day, dropping empty days so the log never
 *  accumulates husks. Pure — the input is never touched. */
function writeEntry(habitLog, day, habitId, entry) {
  const next = { ...(habitLog || {}) };
  const dayMap = { ...(next[day] || {}) };
  if (entry) dayMap[habitId] = entry;
  else delete dayMap[habitId];
  if (Object.keys(dayMap).length) next[day] = dayMap;
  else delete next[day];
  return next;
}

/**
 * Add anything, change nothing.
 *
 * A slot that already holds a value is final — not later the same day, not
 * tomorrow, never. This guard is the only place immutability lives, so every
 * caller gets it for free rather than each screen remembering to ask. The
 * streak is the reward, so the streak is what you would be tempted to protect;
 * a log you can rewrite is a log that argues with you at exactly the wrong
 * moment.
 *
 * A refused write returns the same object, so a caller can cheaply tell that
 * nothing happened.
 */
export function logSlot(habitLog, day, habitId, slotKey, value, nowMs) {
  if (!SLOT_VALUES.includes(value)) return habitLog;
  if (day !== habitDay(nowMs)) return habitLog;
  const e = entryAt(habitLog, day, habitId);
  if (e && e.off) return habitLog;
  if (e && e.slots && e.slots[slotKey]) return habitLog;
  const slots = { ...((e && e.slots) || {}), [slotKey]: { v: value, at: nowMs } };
  return writeEntry(habitLog, day, habitId, { slots });
}

/**
 * Off plan is a decision, not a record, so it is the one thing that can be
 * turned back off — but only while the day is still untouched. Without that
 * guard you could break at lunch and then mark the day off plan to launder the
 * streak, which would quietly make every streak in the app meaningless.
 */
export function setOffPlan(habitLog, day, habitId, on, nowMs) {
  if (day !== habitDay(nowMs)) return habitLog;
  if (hasAnySlot(habitLog, day, habitId)) return habitLog;
  return writeEntry(habitLog, day, habitId, on ? { off: true, slots: {} } : null);
}

/* ============================= WHAT IT MEANS ============================= */

/**
 * Count breaks, not meals.
 *
 * A day is clean unless something broke it, which is why a skipped meal costs
 * nothing: not eating is not a carb. "At least one kept" is what stops a day of
 * pure skipping reading as a triumph. A day with holes in it is still clean —
 * the day list shows the holes, so a thin streak looks thin. Display, not
 * enforcement: the alternative punishes you for having a meeting.
 */
export function habitDayState(habitLog, habit, day) {
  if (!isScheduledOn(habit, day)) return 'off';
  const e = entryAt(habitLog, day, habit.id);
  if (e && e.off) return 'off';
  const vals = e && e.slots ? Object.keys(e.slots).map((k) => e.slots[k].v) : [];
  if (vals.includes('broke')) return 'broken';
  if (vals.includes('kept')) return 'clean';
  return 'neutral';
}

export function habitStats(habitLog, habit, today) {
  const start = habit.createdDate && habit.createdDate < today ? habit.createdDate : today;

  // Walking back: a break ends the streak, a clean day extends it, and neutral
  // or off-plan days are gaps it steps over. Today is neutral until you log it,
  // which must not be read as a miss — the same allowance calcStreakInfo makes.
  let current = 0;
  let cursor = today;
  while (cursor >= start) {
    const st = habitDayState(habitLog, habit, cursor);
    if (st === 'broken') break;
    if (st === 'clean') current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let running = 0;
  let cur = start;
  let guard = 0;
  while (cur <= today && guard < 20000) {
    const st = habitDayState(habitLog, habit, cur);
    if (st === 'clean') { running++; if (running > longest) longest = running; }
    else if (st === 'broken') running = 0;
    cur = addDays(cur, 1);
    guard++;
  }
  if (current > longest) longest = current;

  let cleanIn30 = 0;
  for (let i = 0; i < 30; i++) {
    if (habitDayState(habitLog, habit, addDays(today, -i)) === 'clean') cleanIn30++;
  }

  // The one number that cannot be gamed: it comes from the clock, not from
  // anything you chose to tap.
  let logged = 0;
  let live = 0;
  const breaksBySlot = {};
  for (const day in habitLog || {}) {
    const e = habitLog[day][habit.id];
    if (!e || !e.slots) continue;
    for (const k in e.slots) {
      logged++;
      if (isLive(k, e.slots[k].at)) live++;
      if (e.slots[k].v === 'broke') breaksBySlot[k] = (breaksBySlot[k] || 0) + 1;
    }
  }

  return {
    current,
    longest,
    cleanIn30,
    breaksBySlot,
    liveRate: logged ? Math.round((live / logged) * 100) : null,
  };
}

/* ============================== PRESETS ============================== */

/**
 * Activating a preset COPIES it. Nothing links back, deliberately: the moment
 * presets are referenced by id, editing one later mutates habits already living
 * on other people's phones, and we own a sync problem nobody asked for.
 */
// Meal by meal is a keto idea, so only keto carries it. Everything else is one
// tap a day, which is why the form has no shape toggle: the preset decides. The
// escape hatch costs nothing — start from Keto and rename it, and you keep the
// six slots for anything you want tracked that way.
export const HABIT_PRESETS = [
  { key: 'keto', name: 'Keto', emoji: '🥑', kind: 'meals', rule: 'Any carb breaks the day.' },
  { key: 'alcohol', name: 'No alcohol', emoji: '🚫', kind: 'plain', rule: 'One drink breaks the day.' },
  { key: 'smoking', name: 'No smoking or vaping', emoji: '🚭', kind: 'plain', rule: 'One puff breaks the day.' },
  { key: 'teeth', name: 'Brush teeth', emoji: '🪥', kind: 'plain', rule: 'Morning and night.' },
  { key: 'sleep', name: 'Sleep by 11', emoji: '🌙', kind: 'plain', rule: 'Lights out by 11 PM.' },
];

/**
 * `schedule` and `scheduleHistory` are deliberately the same fields an exercise
 * carries, so isScheduledOn and scheduleEffectiveOn work on a habit unchanged
 * rather than being written twice. History is seeded at creation: changing the
 * days later must never rewrite what the past was judged against.
 */
export function newHabit(fields, todayStr) {
  const schedule = fields.schedule || 'daily';
  return {
    id: uid('hab'),
    name: fields.name || 'Habit',
    emoji: fields.emoji || '✅',
    rule: fields.rule || '',
    kind: fields.kind === 'meals' ? 'meals' : 'plain',
    schedule,
    scheduleHistory: [{ effectiveDate: todayStr, schedule }],
    createdDate: todayStr,
    active: true,
  };
}

export function habitFromPreset(presetKey, schedule, todayStr) {
  const p = HABIT_PRESETS.find((x) => x.key === presetKey);
  if (!p) return null;
  return newHabit({ name: p.name, emoji: p.emoji, kind: p.kind, rule: p.rule, schedule }, todayStr);
}

/**
 * A schedule change appends a dated entry rather than overwriting, so past days
 * keep the schedule they were judged against — the same rule exercises follow.
 * Changing it twice in one day replaces today's entry instead of stacking, or a
 * few taps in the form would leave a trail of no-op history.
 */
export function setHabitSchedule(habit, schedule, todayStr) {
  const hist = (Array.isArray(habit.scheduleHistory) ? habit.scheduleHistory : [])
    .filter((h) => h && h.effectiveDate !== todayStr);
  hist.push({ effectiveDate: todayStr, schedule });
  hist.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  return { ...habit, schedule, scheduleHistory: hist };
}

/**
 * Deleting a habit archives it: gone from Today, Plan and Progress, with its log
 * left inert in storage. Habits carry no tombstone key, and a hard delete
 * without one is exactly how a deleted exercise came back from Drive.
 */
export function archiveHabit(habits, habitId) {
  return (habits || []).map((h) => (h.id === habitId ? { ...h, active: false } : h));
}
