// Pure, environment-free rules for the crew endpoints. No fetch, no D1, no
// state — the SQL and the Google calls that use these live in index.js, and
// everything in this file is unit-tested.
//
// The split matters more here than it did for the broker: a crew has rules that
// are easy to get subtly wrong (who may rename, what happens when the owner
// walks out, how big a card may be), and those rules are exactly the part that
// cannot be checked by looking at the screen.

/** Crews per person, and people per crew. Not scale limits — abuse limits. An
 *  invite link is a bearer token, so a leaked one has to hit a wall somewhere. */
export const MAX_CREWS_PER_USER = 10;
export const MAX_MEMBERS_PER_CREW = 30;

/**
 * 24 KB of card, photo included.
 *
 * It was 8 KB, which sounded generous and was not: the app's avatar is a 192px
 * JPEG, so a real photo is 12-25 KB of data URL and EVERY card silently lost
 * its picture to `fitCard`. The app now publishes a 96px copy for the crew, and
 * this is the headroom that copy needs plus the exercises around it.
 */
export const MAX_CARD_BYTES = 24576;

/**
 * Invite codes are read off a screen and typed by hand when a scan fails, so
 * the alphabet drops every character that can be misread: no O/0, no I/1/l,
 * no U/V confusion at small sizes. What is left is unambiguous in any font.
 */
const CODE_ALPHABET = '23456789ACDEFGHJKLMNPQRSTWXYZ';
const CODE_LENGTH = 8;

export function newInviteCode(randomInts) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInts[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Codes travel through links, QR and typing, so they are matched case- and
 *  whitespace-insensitively. Returns null for anything that cannot be one. */
export function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (up.length !== CODE_LENGTH) return null;
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return null;
  return up;
}

/** A motto is one line, not a paragraph — it has to fit under a crew's name on
 *  a phone and across the foot of a shared image. */
export function cleanMotto(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** A crew name is a label, not a document. Trimmed, collapsed, capped, and
 *  never empty — an unnamed crew is unfindable in a list of crews. */
export function cleanCrewName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  return name.length ? name : null;
}

/**
 * What the app is allowed to publish about itself.
 *
 * Everything is re-derived here rather than trusted: a client could put
 * anything in a card, and the crew screen would render it. Numbers are coerced
 * and floored at zero, strings are capped, and unknown keys are dropped
 * entirely — so a future client sending more cannot quietly widen what an older
 * crew displays.
 */
export function sanitiseCard(card) {
  if (!card || typeof card !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  };
  const out = {
    name: str(card.name, 24),
    photo: typeof card.photo === 'string' && card.photo.startsWith('data:image/') ? card.photo : '',
    streak: int(card.streak),
    best: int(card.best),
    trainedToday: !!card.trainedToday,
    restingToday: !!card.restingToday,
    lifetime: {
      reps: num(card.lifetime && card.lifetime.reps),
      timeMs: int(card.lifetime && card.lifetime.timeMs),
    },
    exercises: Array.isArray(card.exercises)
      ? card.exercises.slice(0, 40).map((e) => ({
        name: str(e && e.name, 40),
        category: str(e && e.category, 24),
        unit: str(e && e.unit, 12),
        streak: int(e && e.streak),
        total: num(e && e.total),
        today: num(e && e.today),
        // What they are down to do today, so a crew screen can show the day
        // rather than a lifetime — a total with no target beside it says
        // nothing about whether someone is on track.
        target: num(e && e.target),
        due: !!(e && e.due),
        // Last seven days as one character each — h hit, b break, m miss,
        // r rest, n not tracked. A whole strip in seven bytes, which is what
        // makes it affordable to publish per exercise.
        days: typeof (e && e.days) === 'string' ? e.days.slice(0, 7).replace(/[^hbmrn]/g, 'n') : '',
        doneAt: int(e && e.doneAt),
        rest: !!(e && e.rest),
        top: num(e && e.top),
        bestDay: num(e && e.bestDay),
        avgMs: int(e && e.avgMs),
        totalMs: int(e && e.totalMs),
      })).filter((e) => e.name)
      : [],
  };
  return out;
}

/** Whether a sanitised card fits. Measured on the JSON that will actually be
 *  stored, not on the object, because the photo is most of the weight. */
export function cardFits(card) {
  return JSON.stringify(card || {}).length <= MAX_CARD_BYTES;
}

/**
 * A card too big to store is dropped to its text — the person still appears in
 * the crew with their streak, just without the photo that broke the budget.
 * Vanishing from your own crew because of an avatar would be a worse failure
 * than showing up without one.
 */
export function fitCard(card) {
  if (cardFits(card)) return card;
  const noPhoto = { ...card, photo: '' };
  if (cardFits(noPhoto)) return noPhoto;
  return { ...noPhoto, exercises: [] };
}

/**
 * Roles and classes are a closed set, not free text.
 *
 * Each one has a drawn icon shipped with the app, so a value outside the list
 * would render as a hole. Validating here rather than trusting the client also
 * means a role can never be invented — and none of them grants anything:
 * ownership remains the only right in this Worker, so a title cannot become a
 * permission by accident.
 */
export const ROLES = ['leader', 'vice', 'member'];
export const CLASSES = ['fighter', 'artist', 'tank', 'tech', 'tycoon'];

export function cleanRole(raw) {
  return ROLES.includes(raw) ? raw : '';
}

export function cleanClass(raw) {
  return CLASSES.includes(raw) ? raw : '';
}

/** What a member is in the crew. Whoever made it leads it unless the leader has
 *  said otherwise — the creator never has to be given their own title. */
export function roleOf(crew, member) {
  const own = cleanRole(member && member.role);
  if (own) return own;
  return crew && member && crew.owner === member.user_id ? 'leader' : 'member';
}

/** Owner-only actions, in one place so no endpoint has to remember. */
export function isOwner(crew, userId) {
  return !!crew && !!userId && crew.owner === userId;
}

/**
 * Who owns the crew after someone leaves.
 *
 * A crew whose owner walks out must not become unadministrable, and must not
 * evaporate under the people still in it. The oldest remaining membership takes
 * it — deterministic, needs no election, and is the person most likely to have
 * been there since the start. An empty crew is deleted rather than left as a
 * tombstone nobody can ever join.
 */
export function ownerAfterLeaving(crew, members, leavingId) {
  const rest = members.filter((m) => m.user_id !== leavingId);
  if (!rest.length) return { deleteCrew: true, owner: null };
  if (!isOwner(crew, leavingId)) return { deleteCrew: false, owner: crew.owner };
  const oldest = rest.slice().sort((a, b) => (a.joined_at - b.joined_at) || (a.user_id < b.user_id ? -1 : 1))[0];
  return { deleteCrew: false, owner: oldest.user_id };
}

/**
 * The crew as the app renders it: members ordered by who has trained today,
 * then by streak, then by name. Ordering here rather than in the client means
 * every device agrees, and a stale cached roster still sorts the same way.
 */
export function buildRoster(crew, memberRows, reactionRows, meId) {
  const reactions = reactionRows || [];
  const members = memberRows.map((m) => {
    let card = null;
    try { card = m.card ? JSON.parse(m.card) : null; } catch (e) { card = null; }
    return {
      id: m.user_id,
      name: (card && card.name) || m.name || 'Someone',
      photo: (card && card.photo) || '',
      streak: (card && card.streak) || 0,
      best: (card && card.best) || 0,
      trainedToday: !!(card && card.trainedToday),
      restingToday: !!(card && card.restingToday),
      lifetime: (card && card.lifetime) || { reps: 0, timeMs: 0 },
      exercises: (card && card.exercises) || [],
      updatedAt: m.updated_at || 0,
      // Already in the table since the first crew was made, so "member since"
      // is true for everyone retrospectively rather than starting from today.
      joinedAt: m.joined_at || 0,
      isOwner: crew.owner === m.user_id,
      role: roleOf(crew, m),
      klass: cleanClass(m.class),
      // Marked here rather than guessed by the client: the app knows the email
      // it signed in with, not the id Google gave the Worker, and matching on
      // email meant nobody was ever recognised as themselves — which quietly
      // hid every owner-only control.
      isMe: !!meId && m.user_id === meId,
      received: reactions.filter((r) => r.to_id === m.user_id)
        .map((r) => ({ from: r.from_id, kind: r.kind, emoji: r.emoji, day: r.day, seen: !!r.seen, mine: r.from_id === meId })),
    };
  });
  members.sort((a, b) => (Number(b.trainedToday) - Number(a.trainedToday))
    || (b.streak - a.streak)
    || a.name.localeCompare(b.name));
  return {
    id: crew.id,
    name: crew.name,
    motto: crew.motto || '',
    owner: crew.owner,
    code: crew.invite_code,
    createdAt: crew.created_at,
    members,
  };
}

/** Reaction kinds the Worker will store. Anything else is dropped rather than
 *  saved as an unknown the crew screen would have to guess how to draw. */
export function cleanReaction(kind, emoji) {
  if (kind === 'nudge' || kind === 'respect') return { kind, emoji: '' };
  if (kind === 'emoji') {
    const e = typeof emoji === 'string' ? Array.from(emoji.trim()).slice(0, 2).join('') : '';
    return e ? { kind, emoji: e } : null;
  }
  return null;
}

/* ---------------- stories ----------------
 * A picture and a line of text that expire on their own. Kept in the same
 * database as everything else, because a second store for something that dies
 * in a day would be a second thing to keep alive forever.
 */

/**
 * 900 KB of base64 — deliberately just under D1's 1,000,000-byte ceiling on a
 * single value, which is the real wall here and not one we chose.
 *
 * It was 240 KB, sized for an 800px JPEG. Proof can be a video now, and a
 * video the crew cannot play is not proof of anything, so the app composites a
 * small copy — downscaled, bitrate-budgeted — to land inside this. The
 * full-quality original never leaves the phone that shot it.
 */
export const MAX_STORY_BYTES = 900000;
export const STORY_LIFE_MS = 24 * 60 * 60 * 1000;

export function cleanCaption(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** What the Worker is willing to store: a data URL, a picture or a clip, small
 *  enough to be one D1 value. */
export function storyImageOk(image) {
  return typeof image === 'string'
    && (image.startsWith('data:image/') || image.startsWith('data:video/'))
    && image.length <= MAX_STORY_BYTES;
}

/** Whether a stored story is still alive. Expiry is a timestamp rather than a
 *  job: nothing has to run on a schedule for a story to be over. */
export function storyLive(row, nowMs) {
  return !!row && row.expires_at > nowMs;
}

/**
 * The story as the roster carries it — never the image.
 *
 * A crew of ten with pictures in every card would be a megabyte on every
 * refresh, so the roster says only that a story exists, and the picture is
 * fetched when someone actually opens it.
 */
export function storyMeta(row, nowMs, meId, viewRows) {
  if (!storyLive(row, nowMs)) return null;
  const views = (viewRows || []).filter((v) => v.ref === row.id);
  return {
    id: row.id,
    caption: row.caption || '',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    mine: row.user_id === meId,
    seenByMe: views.some((v) => v.viewer === meId),
    viewers: row.user_id === meId ? views.map((v) => v.viewer) : [],
  };
}

/** Who looked at this member today, as ids the app turns into names. Only ever
 *  returned to the person being looked at. */
export function viewersOf(viewRows, subjectId, kind, meId) {
  if (subjectId !== meId) return [];
  return (viewRows || [])
    .filter((v) => v.subject === subjectId && v.kind === kind && v.viewer !== meId)
    .map((v) => v.viewer);
}
