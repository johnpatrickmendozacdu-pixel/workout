import { describe, it, expect } from 'vitest';
import {
  HABIT_SLOTS, HABIT_BLOCKS, HABIT_PRESETS, PLAIN_SLOT, SLOT_VALUES,
  slotsFor, habitDay, habitMinute, blockOf, blockAt, isLive,
  slotAt, hasAnySlot, isOffPlan, logSlot, setOffPlan,
  habitDayState, habitStats, habitFromPreset, newHabit,
} from '../src/domain/habits.js';

// Local-time constructors on purpose: the app reads the phone's clock, so the
// tests must too.
const at = (s) => new Date(s).getTime();
const NOON = at('2026-08-13T12:30:00');
const DAY = '2026-08-13';

describe('the habit day runs 5 AM to 4:59 AM', () => {
  it('a 1 AM snack belongs to the night before', () => {
    expect(habitDay(at('2026-08-13T01:30:00'))).toBe('2026-08-12');
  });
  it('4:59 AM is still the night before', () => {
    expect(habitDay(at('2026-08-13T04:59:00'))).toBe('2026-08-12');
  });
  it('5:00 AM starts the new day', () => {
    expect(habitDay(at('2026-08-13T05:00:00'))).toBe('2026-08-13');
  });
  it('midday is unremarkable', () => {
    expect(habitDay(at('2026-08-13T13:00:00'))).toBe('2026-08-13');
  });
});

describe('habitMinute counts from 5 AM', () => {
  it('is 0 at 5 AM', () => expect(habitMinute(at('2026-08-13T05:00:00'))).toBe(0));
  it('is 420 at noon', () => expect(habitMinute(at('2026-08-13T12:00:00'))).toBe(420));
  it('wraps past midnight', () => expect(habitMinute(at('2026-08-13T01:00:00'))).toBe(1200));
  it('is 1439 at 4:59 AM', () => expect(habitMinute(at('2026-08-13T04:59:00'))).toBe(1439));
});

describe('blocks', () => {
  it('has three', () => expect(HABIT_BLOCKS.map((b) => b.key)).toEqual(['morning', 'midday', 'evening']));
  it('covers the whole day with no gap', () => {
    expect(HABIT_BLOCKS[0].start).toBe(0);
    expect(HABIT_BLOCKS[2].end).toBe(1439);
    expect(HABIT_BLOCKS[1].start).toBe(HABIT_BLOCKS[0].end + 1);
    expect(HABIT_BLOCKS[2].start).toBe(HABIT_BLOCKS[1].end + 1);
  });
  it('puts 2 PM in midday and 1 AM in evening', () => {
    expect(blockAt(at('2026-08-13T14:00:00')).key).toBe('midday');
    expect(blockAt(at('2026-08-13T01:00:00')).key).toBe('evening');
  });
});

describe('slots', () => {
  it('has six, in the order they happen', () => {
    expect(HABIT_SLOTS.map((s) => s.key)).toEqual([
      'breakfast', 'morningSnack', 'lunch', 'afternoonSnack', 'dinner', 'eveningSnack',
    ]);
  });
  it('maps each to its block', () => {
    expect(blockOf('breakfast').key).toBe('morning');
    expect(blockOf('afternoonSnack').key).toBe('midday');
    expect(blockOf('eveningSnack').key).toBe('evening');
  });
  it('gives a plain habit one windowless slot', () => {
    expect(slotsFor({ kind: 'plain' })).toEqual([{ key: PLAIN_SLOT, label: 'Today', block: null }]);
    expect(slotsFor({ kind: 'meals' })).toBe(HABIT_SLOTS);
  });
});

describe('live vs late', () => {
  it('breakfast logged at 8 AM is live', () => {
    expect(isLive('breakfast', at('2026-08-13T08:00:00'))).toBe(true);
  });
  it('breakfast logged at 8 PM is late', () => {
    expect(isLive('breakfast', at('2026-08-13T20:00:00'))).toBe(false);
  });
  it('is live at the very edge of its block', () => {
    expect(isLive('breakfast', at('2026-08-13T11:59:00'))).toBe(true);
    expect(isLive('lunch', at('2026-08-13T12:00:00'))).toBe(true);
    expect(isLive('lunch', at('2026-08-13T17:59:00'))).toBe(true);
  });
  it('lets the evening block run past midnight', () => {
    expect(isLive('eveningSnack', at('2026-08-13T23:30:00'))).toBe(true);
    expect(isLive('eveningSnack', at('2026-08-14T01:00:00'))).toBe(true);
  });
  it('a windowless slot is never late', () => {
    expect(isLive(PLAIN_SLOT, at('2026-08-13T03:00:00'))).toBe(true);
  });
});

describe('logSlot', () => {
  it('writes a value with the moment it was tapped', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(slotAt(log, DAY, 'h1', 'lunch')).toEqual({ v: 'kept', at: NOON });
  });
  it('does not mutate the log it was given', () => {
    const before = {};
    logSlot(before, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(before).toEqual({});
  });
  it('keeps slots already written', () => {
    let log = logSlot({}, DAY, 'h1', 'breakfast', 'kept', NOON);
    log = logSlot(log, DAY, 'h1', 'lunch', 'broke', NOON);
    expect(Object.keys(log[DAY].h1.slots).sort()).toEqual(['breakfast', 'lunch']);
  });
  it('keeps two habits on the same day apart', () => {
    let log = logSlot({}, DAY, 'h1', 'lunch', 'kept', NOON);
    log = logSlot(log, DAY, 'h2', 'lunch', 'broke', NOON);
    expect(slotAt(log, DAY, 'h1', 'lunch').v).toBe('kept');
    expect(slotAt(log, DAY, 'h2', 'lunch').v).toBe('broke');
  });

  // Add anything, change nothing.
  it('refuses to change a slot that already holds a value', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'broke', NOON);
    const after = logSlot(log, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(after).toBe(log);
    expect(slotAt(after, DAY, 'h1', 'lunch').v).toBe('broke');
  });
  it('refuses a write to any day but the current habit day', () => {
    expect(logSlot({}, '2026-08-12', 'h1', 'lunch', 'kept', NOON)).toEqual({});
  });
  it('accepts a write at 1 AM against the night before', () => {
    const lateMs = at('2026-08-14T01:00:00');
    const log = logSlot({}, DAY, 'h1', 'eveningSnack', 'broke', lateMs);
    expect(slotAt(log, DAY, 'h1', 'eveningSnack').v).toBe('broke');
  });
  it('rejects a value that is not one of the three', () => {
    expect(logSlot({}, DAY, 'h1', 'lunch', 'maybe', NOON)).toEqual({});
    expect(SLOT_VALUES).toEqual(['kept', 'skip', 'broke']);
  });
});

describe('setOffPlan', () => {
  it('marks and unmarks a day nothing has been logged on', () => {
    let log = setOffPlan({}, DAY, 'h1', true, NOON);
    expect(isOffPlan(log, DAY, 'h1')).toBe(true);
    log = setOffPlan(log, DAY, 'h1', false, NOON);
    expect(isOffPlan(log, DAY, 'h1')).toBe(false);
    expect(log).toEqual({});
  });
  it('refuses to launder a broken day', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'broke', NOON);
    const after = setOffPlan(log, DAY, 'h1', true, NOON);
    expect(after).toBe(log);
    expect(isOffPlan(after, DAY, 'h1')).toBe(false);
  });
  it('refuses once anything at all is logged, even a good day', () => {
    const log = logSlot({}, DAY, 'h1', 'lunch', 'kept', NOON);
    expect(setOffPlan(log, DAY, 'h1', true, NOON)).toBe(log);
  });
  it('refuses on any day but the current habit day', () => {
    expect(setOffPlan({}, '2026-08-01', 'h1', true, NOON)).toEqual({});
  });
  it('blocks logging on a day already marked off plan', () => {
    const log = setOffPlan({}, DAY, 'h1', true, NOON);
    expect(logSlot(log, DAY, 'h1', 'lunch', 'kept', NOON)).toBe(log);
  });
  it('reports hasAnySlot honestly', () => {
    expect(hasAnySlot({}, DAY, 'h1')).toBe(false);
    expect(hasAnySlot(logSlot({}, DAY, 'h1', 'lunch', 'skip', NOON), DAY, 'h1')).toBe(true);
  });
});

const KETO = { id: 'h1', kind: 'meals', schedule: 'daily', createdDate: '2026-08-01' };
const nowOn = (day, clock = 'T12:30:00') => at(day + clock);
/** Log a slot as if it were being tapped on that day at midday. */
const put = (log, day, slot, v) => logSlot(log, day, 'h1', slot, v, nowOn(day));

describe('habitDayState', () => {
  it('is neutral when nothing is logged', () => {
    expect(habitDayState({}, KETO, '2026-08-10')).toBe('neutral');
  });
  it('is clean when something was kept and nothing broke', () => {
    const log = put({}, '2026-08-10', 'breakfast', 'kept');
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('clean');
  });
  it('is broken the moment anything breaks, whatever else happened', () => {
    let log = put({}, '2026-08-10', 'breakfast', 'kept');
    log = put(log, '2026-08-10', 'dinner', 'broke');
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('broken');
  });
  it('is neutral when every slot was skipped — not eating is not a triumph', () => {
    let log = put({}, '2026-08-10', 'breakfast', 'skip');
    log = put(log, '2026-08-10', 'lunch', 'skip');
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('neutral');
  });
  it('is off when the day was marked off plan', () => {
    const log = setOffPlan({}, '2026-08-10', 'h1', true, nowOn('2026-08-10'));
    expect(habitDayState(log, KETO, '2026-08-10')).toBe('off');
  });
  it('is off on a day the habit is not scheduled for', () => {
    const weekdays = { ...KETO, schedule: [1, 2, 3, 4, 5] };
    expect(habitDayState({}, weekdays, '2026-08-09')).toBe('off'); // a Sunday
  });
});

describe('habitStats', () => {
  it('counts a run of clean days', () => {
    let log = {};
    ['2026-08-08', '2026-08-09', '2026-08-10'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(3);
  });
  it('lets today be neutral without ending the streak', () => {
    let log = {};
    ['2026-08-08', '2026-08-09'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(2);
  });
  it('steps over a neutral gap rather than ending on it', () => {
    let log = put({}, '2026-08-08', 'breakfast', 'kept');
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(2);
  });
  it('steps over an off-plan day', () => {
    let log = put({}, '2026-08-08', 'breakfast', 'kept');
    log = setOffPlan(log, '2026-08-09', 'h1', true, nowOn('2026-08-09'));
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(2);
  });
  it('ends the streak on a break', () => {
    let log = put({}, '2026-08-08', 'breakfast', 'kept');
    log = put(log, '2026-08-09', 'dinner', 'broke');
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    expect(habitStats(log, KETO, '2026-08-10').current).toBe(1);
  });
  it('remembers the longest run after it is broken', () => {
    let log = {};
    ['2026-08-02', '2026-08-03', '2026-08-04'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    log = put(log, '2026-08-05', 'dinner', 'broke');
    log = put(log, '2026-08-10', 'breakfast', 'kept');
    const s = habitStats(log, KETO, '2026-08-10');
    expect(s.longest).toBe(3);
    expect(s.current).toBe(1);
  });
  it('counts clean days in the last thirty', () => {
    let log = {};
    ['2026-08-08', '2026-08-09', '2026-08-10'].forEach((d) => { log = put(log, d, 'breakfast', 'kept'); });
    expect(habitStats(log, KETO, '2026-08-10').cleanIn30).toBe(3);
  });
  it('is null on live rate until something is logged', () => {
    expect(habitStats({}, KETO, '2026-08-10').liveRate).toBe(null);
  });
  it('scores logging in the moment against logging late', () => {
    let log = logSlot({}, '2026-08-10', 'h1', 'breakfast', 'kept', at('2026-08-10T08:00:00'));
    log = logSlot(log, '2026-08-10', 'h1', 'lunch', 'kept', at('2026-08-10T20:00:00'));
    expect(habitStats(log, KETO, '2026-08-10').liveRate).toBe(50);
  });
  it('names the slot that breaks most', () => {
    let log = put({}, '2026-08-08', 'eveningSnack', 'broke');
    log = put(log, '2026-08-09', 'eveningSnack', 'broke');
    log = put(log, '2026-08-10', 'lunch', 'broke');
    expect(habitStats(log, KETO, '2026-08-10').breaksBySlot).toEqual({ eveningSnack: 2, lunch: 1 });
  });
});

describe('presets', () => {
  it('offers keto as a meals habit and two plain ones', () => {
    expect(HABIT_PRESETS.map((p) => p.key)).toEqual(['keto', 'alcohol', 'sleep']);
    expect(HABIT_PRESETS[0].kind).toBe('meals');
    expect(HABIT_PRESETS[1].kind).toBe('plain');
  });
  it('copies a preset rather than linking to it', () => {
    const h = habitFromPreset('keto', 'daily', '2026-08-13');
    expect(h.name).toBe('Keto');
    expect(h.kind).toBe('meals');
    expect(h.rule).toBe('Any carb breaks the day.');
    expect(h.preset).toBeUndefined();
  });
  it('seeds schedule history so a later change cannot rewrite the past', () => {
    const h = habitFromPreset('keto', [1, 2, 3, 4, 5], '2026-08-13');
    expect(h.scheduleHistory).toEqual([{ effectiveDate: '2026-08-13', schedule: [1, 2, 3, 4, 5] }]);
    expect(h.createdDate).toBe('2026-08-13');
  });
  it('starts active, with a unique id', () => {
    const a = habitFromPreset('keto', 'daily', '2026-08-13');
    const b = habitFromPreset('keto', 'daily', '2026-08-13');
    expect(a.active).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
  it('returns null for a preset that does not exist', () => {
    expect(habitFromPreset('nope', 'daily', '2026-08-13')).toBe(null);
  });
  it('builds a custom habit from scratch, defaulting to plain', () => {
    const h = newHabit({ name: 'No fizzy drinks', emoji: '🥤', schedule: 'daily' }, '2026-08-13');
    expect(h.kind).toBe('plain');
    expect(h.name).toBe('No fizzy drinks');
    expect(h.scheduleHistory[0].effectiveDate).toBe('2026-08-13');
  });
});
