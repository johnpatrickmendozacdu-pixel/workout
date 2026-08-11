import { describe, it, expect } from 'vitest';
import {
  newInviteCode,
  normaliseCode,
  cleanCrewName,
  sanitiseCard,
  cardFits,
  fitCard,
  isOwner,
  ownerAfterLeaving,
  buildRoster,
  cleanReaction,
  MAX_CARD_BYTES,
} from '../worker/crew.js';

const ints = (n) => Array.from({ length: 8 }, (_, i) => i * 7 + n);

describe('invite codes', () => {
  it('are eight characters from an unambiguous alphabet', () => {
    const code = newInviteCode(ints(3));
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[23456789ACDEFGHJKLMNPQRSTWXYZ]{8}$/);
  });

  it('never contain the characters people misread', () => {
    for (let n = 0; n < 40; n++) {
      expect(newInviteCode(ints(n))).not.toMatch(/[O01IlUV]/);
    }
  });

  it('are read back case- and punctuation-insensitively', () => {
    const code = newInviteCode(ints(5));
    expect(normaliseCode(code.toLowerCase())).toBe(code);
    expect(normaliseCode(`  ${code}  `)).toBe(code);
    expect(normaliseCode(code.slice(0, 4) + '-' + code.slice(4))).toBe(code);
  });

  it('reject anything that cannot be a code', () => {
    expect(normaliseCode('SHORT')).toBeNull();
    expect(normaliseCode('OOOOOOOO')).toBeNull();   // O is not in the alphabet
    expect(normaliseCode(null)).toBeNull();
    expect(normaliseCode('')).toBeNull();
  });
});

describe('crew names', () => {
  it('collapse whitespace and cap length', () => {
    expect(cleanCrewName('  the   morning   crew ')).toBe('the morning crew');
    expect(cleanCrewName('x'.repeat(80))).toHaveLength(40);
  });
  it('refuse an empty name', () => {
    expect(cleanCrewName('   ')).toBeNull();
    expect(cleanCrewName(null)).toBeNull();
  });
});

describe('cards', () => {
  const good = {
    name: 'Johnny', photo: 'data:image/png;base64,AAAA', streak: 17, best: 17,
    trainedToday: true, lifetime: { reps: 1292, timeMs: 12960000 },
    exercises: [{ name: 'Push Ups', category: 'chest', unit: 'reps', streak: 17, total: 1292, today: 76 }],
  };

  it('keep what the crew screen draws', () => {
    const c = sanitiseCard(good);
    expect(c.name).toBe('Johnny');
    expect(c.streak).toBe(17);
    expect(c.trainedToday).toBe(true);
    expect(c.exercises[0].name).toBe('Push Ups');
  });

  it('drop unknown keys rather than storing them', () => {
    const c = sanitiseCard({ ...good, weightLog: [80, 79], email: 'a@b.c' });
    expect(c.weightLog).toBeUndefined();
    expect(c.email).toBeUndefined();
  });

  it('refuse a photo that is not an image data URL', () => {
    expect(sanitiseCard({ ...good, photo: 'https://evil.example/track.gif' }).photo).toBe('');
    expect(sanitiseCard({ ...good, photo: 'javascript:alert(1)' }).photo).toBe('');
  });

  it('coerce nonsense numbers to zero instead of trusting them', () => {
    const c = sanitiseCard({ ...good, streak: -5, best: 'lots', lifetime: { reps: NaN, timeMs: -1 } });
    expect(c.streak).toBe(0);
    expect(c.best).toBe(0);
    expect(c.lifetime).toEqual({ reps: 0, timeMs: 0 });
  });

  it('drop the photo before dropping the person', () => {
    const huge = sanitiseCard({ ...good, photo: 'data:image/png;base64,' + 'A'.repeat(MAX_CARD_BYTES) });
    expect(cardFits(huge)).toBe(false);
    const fitted = fitCard(huge);
    expect(cardFits(fitted)).toBe(true);
    expect(fitted.photo).toBe('');
    expect(fitted.name).toBe('Johnny');
    expect(fitted.streak).toBe(17);
  });

  it('rejects a non-object outright', () => {
    expect(sanitiseCard(null)).toBeNull();
    expect(sanitiseCard('hello')).toBeNull();
  });
});

describe('ownership', () => {
  const crew = { id: 'c1', owner: 'u1', name: 'Crew', invite_code: 'ABCDEFGH', created_at: 1 };
  const members = [
    { user_id: 'u1', joined_at: 100 },
    { user_id: 'u2', joined_at: 200 },
    { user_id: 'u3', joined_at: 150 },
  ];

  it('is only the owner', () => {
    expect(isOwner(crew, 'u1')).toBe(true);
    expect(isOwner(crew, 'u2')).toBe(false);
    expect(isOwner(null, 'u1')).toBe(false);
  });

  it('passes to the oldest remaining member when the owner leaves', () => {
    const r = ownerAfterLeaving(crew, members, 'u1');
    expect(r.deleteCrew).toBe(false);
    expect(r.owner).toBe('u3');          // joined before u2
  });

  it('leaves ownership alone when anyone else leaves', () => {
    expect(ownerAfterLeaving(crew, members, 'u2')).toEqual({ deleteCrew: false, owner: 'u1' });
  });

  it('deletes the crew when the last person leaves', () => {
    expect(ownerAfterLeaving(crew, [{ user_id: 'u1', joined_at: 100 }], 'u1'))
      .toEqual({ deleteCrew: true, owner: null });
  });
});

describe('roster', () => {
  const crew = { id: 'c1', owner: 'u1', name: 'Crew', invite_code: 'ABCDEFGH', created_at: 1 };
  const card = (name, streak, trained) => JSON.stringify({ name, streak, trainedToday: trained });
  const rows = [
    { user_id: 'u1', name: 'Ann', card: card('Ann', 3, false), updated_at: 5, joined_at: 1 },
    { user_id: 'u2', name: 'Bob', card: card('Bob', 9, true), updated_at: 5, joined_at: 2 },
    { user_id: 'u3', name: 'Cal', card: card('Cal', 20, false), updated_at: 5, joined_at: 3 },
  ];

  it('puts today ahead of a bigger streak', () => {
    const r = buildRoster(crew, rows, []);
    expect(r.members.map((m) => m.id)).toEqual(['u2', 'u3', 'u1']);
  });

  it('survives a card that is not JSON', () => {
    const r = buildRoster(crew, [{ user_id: 'u9', name: 'Broken', card: '{not json', updated_at: 0, joined_at: 0 }], []);
    expect(r.members[0].name).toBe('Broken');
    expect(r.members[0].streak).toBe(0);
  });

  it('marks the owner and attaches reactions to their target', () => {
    const r = buildRoster(crew, rows, [{ to_id: 'u1', from_id: 'u2', kind: 'respect', emoji: '', day: '2026-08-11' }]);
    expect(r.members.find((m) => m.id === 'u1').isOwner).toBe(true);
    expect(r.members.find((m) => m.id === 'u1').received).toHaveLength(1);
    expect(r.members.find((m) => m.id === 'u2').received).toHaveLength(0);
  });
});

describe('reactions', () => {
  it('keeps the two named kinds without an emoji', () => {
    expect(cleanReaction('nudge', '🔥')).toEqual({ kind: 'nudge', emoji: '' });
    expect(cleanReaction('respect', '')).toEqual({ kind: 'respect', emoji: '' });
  });
  it('keeps at most two characters of a free emoji', () => {
    expect(cleanReaction('emoji', '🔥').emoji).toBe('🔥');
    expect(Array.from(cleanReaction('emoji', '🔥💪🏋️').emoji)).toHaveLength(2);
  });
  it('drops an unknown kind and an empty emoji', () => {
    expect(cleanReaction('shout', '')).toBeNull();
    expect(cleanReaction('emoji', '   ')).toBeNull();
  });
});
