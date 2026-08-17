// GENERATED — do not edit. Run: node tools/bundle-worker.mjs
//
// Paste this whole file into the Cloudflare dashboard (Workers & Pages ->
// sets-broker -> Edit code -> select all -> paste -> Deploy). It is the same
// code as worker/*.js with the imports flattened, so what runs in production is
// what the tests in tests/worker-*.test.js cover.

// ===== worker/broker.js =====
// Pure, environment-free helpers for the token-broker Worker. No fetch, no
// secrets, no state — everything here is unit-tested. The Google calls that use
// these live in index.js.

/** Google's "who is this token" endpoint. Shared by the broker (which reports
 *  the signed-in email) and the crew routes (which identify the caller). */
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

function corsHeaders(origin, allowed) {
  // `allowed` is a comma-separated list, so the app can live at more than one
  // address at once — which is the only way to move hosts without a flag day
  // where sync breaks for everyone still on the old link.
  if (!origin) return null;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.includes(origin)) return null;
  return {
    // Echo the caller's own origin, never the whole list: a browser accepts
    // exactly one value here.
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * The redirect_uri Google will be asked to match. It has to be byte-identical
 * to the one the app used, and only the app knows its own path — so the app
 * sends it and the Worker verifies it belongs to an allowed origin. Trusting
 * it unchecked would let anyone point the exchange at their own site.
 */
function safeRedirectUri(sent, allowed) {
  if (typeof sent !== 'string' || !sent) return null;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.some((o) => sent.startsWith(o + '/')) ? sent : null;
}

function validateBody(body, required) {
  if (!body || typeof body !== 'object') return false;
  return required.every((k) => typeof body[k] === 'string' && body[k].length > 0);
}

function mapGoogleToken(json, nowMs) {
  if (!json || !json.access_token) return null;
  const expiresAt = nowMs + (Number(json.expires_in) > 0 ? Number(json.expires_in) : 3500) * 1000;
  return { accessToken: json.access_token, expiresAt, refreshToken: json.refresh_token || null };
}

function jsonResponse(bodyObj, status, cors) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}

// ===== worker/crew.js =====
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
const MAX_CREWS_PER_USER = 10;
const MAX_MEMBERS_PER_CREW = 30;

/**
 * 24 KB of card, photo included.
 *
 * It was 8 KB, which sounded generous and was not: the app's avatar is a 192px
 * JPEG, so a real photo is 12-25 KB of data URL and EVERY card silently lost
 * its picture to `fitCard`. The app now publishes a 96px copy for the crew, and
 * this is the headroom that copy needs plus the exercises around it.
 */
const MAX_CARD_BYTES = 24576;

/**
 * Invite codes are read off a screen and typed by hand when a scan fails, so
 * the alphabet drops every character that can be misread: no O/0, no I/1/l,
 * no U/V confusion at small sizes. What is left is unambiguous in any font.
 */
const CODE_ALPHABET = '23456789ACDEFGHJKLMNPQRSTWXYZ';
const CODE_LENGTH = 8;

function newInviteCode(randomInts) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInts[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Codes travel through links, QR and typing, so they are matched case- and
 *  whitespace-insensitively. Returns null for anything that cannot be one. */
function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (up.length !== CODE_LENGTH) return null;
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return null;
  return up;
}

/** A motto is one line, not a paragraph — it has to fit under a crew's name on
 *  a phone and across the foot of a shared image. */
function cleanMotto(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** A crew name is a label, not a document. Trimmed, collapsed, capped, and
 *  never empty — an unnamed crew is unfindable in a list of crews. */
function cleanCrewName(raw) {
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
function sanitiseCard(card) {
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
function cardFits(card) {
  return JSON.stringify(card || {}).length <= MAX_CARD_BYTES;
}

/**
 * A card too big to store is dropped to its text — the person still appears in
 * the crew with their streak, just without the photo that broke the budget.
 * Vanishing from your own crew because of an avatar would be a worse failure
 * than showing up without one.
 */
function fitCard(card) {
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
const ROLES = ['leader', 'vice', 'member'];
const CLASSES = ['fighter', 'artist', 'tank', 'tech', 'tycoon'];

function cleanRole(raw) {
  return ROLES.includes(raw) ? raw : '';
}

function cleanClass(raw) {
  return CLASSES.includes(raw) ? raw : '';
}

/** What a member is in the crew. Whoever made it leads it unless the leader has
 *  said otherwise — the creator never has to be given their own title. */
function roleOf(crew, member) {
  const own = cleanRole(member && member.role);
  if (own) return own;
  return crew && member && crew.owner === member.user_id ? 'leader' : 'member';
}

/** Owner-only actions, in one place so no endpoint has to remember. */
function isOwner(crew, userId) {
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
function ownerAfterLeaving(crew, members, leavingId) {
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
function buildRoster(crew, memberRows, reactionRows, meId) {
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
function cleanReaction(kind, emoji) {
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
const MAX_STORY_BYTES = 900000;
const STORY_LIFE_MS = 24 * 60 * 60 * 1000;

function cleanCaption(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** What the Worker is willing to store: a data URL, a picture or a clip, small
 *  enough to be one D1 value. */
function storyImageOk(image) {
  return typeof image === 'string'
    && (image.startsWith('data:image/') || image.startsWith('data:video/'))
    && image.length <= MAX_STORY_BYTES;
}

/** Whether a stored story is still alive. Expiry is a timestamp rather than a
 *  job: nothing has to run on a schedule for a story to be over. */
function storyLive(row, nowMs) {
  return !!row && row.expires_at > nowMs;
}

/**
 * The story as the roster carries it — never the image.
 *
 * A crew of ten with pictures in every card would be a megabyte on every
 * refresh, so the roster says only that a story exists, and the picture is
 * fetched when someone actually opens it.
 */
function storyMeta(row, nowMs, meId, viewRows) {
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
function viewersOf(viewRows, subjectId, kind, meId) {
  if (subjectId !== meId) return [];
  return (viewRows || [])
    .filter((v) => v.subject === subjectId && v.kind === kind && v.viewer !== meId)
    .map((v) => v.viewer);
}

// ===== worker/crew-routes.js =====
// The crew endpoints: D1 and Google live here, the rules live in crew.js.
//
// Every route follows the same three steps — identify the caller from their
// Google token, apply a rule, return the caller's crews. Returning the whole
// picture from every route means the app never has to reason about which of its
// local copies a response invalidates: it replaces them.





/**
 * Who is calling, according to Google.
 *
 * **Drive first, userinfo second, and the order is the whole point.** The app
 * only ever asked for `drive.appdata`, and `userinfo` is not covered by it — a
 * token that syncs your backup perfectly well gets a 401 there, which is how
 * the first attempt at this failed. Drive's own `about` endpoint answers on the
 * scope the app already has, and its `permissionId` is a stable per-user id.
 *
 * Asking for the email scope instead would have meant a fresh consent screen
 * for every user and a Google Console change, to learn something Drive was
 * willing to tell us for nothing.
 *
 * The userinfo path stays as a fallback for tokens minted by the code exchange,
 * which do carry it.
 *
 * Verified answers are cached for the isolate's life, keyed by the token, so a
 * burst of calls from one phone is one round trip. Entries expire well inside
 * the token's own hour, so the cache can only ever shorten its usefulness.
 */
/** Bumped whenever this file gains something the app depends on, so a single
 *  curl says whether the dashboard paste actually landed. */
const CREW_BUILD = '2026-08-17.12';
const CREW_FEATURES = ['peek', 'isMe', 'target-due', 'days-strip', 'photo-24k', 'stories', 'views', 'roles', 'classes', 'crew-logo', 'multi-story', 'rest-days', 'motto', 'member-since', 'story-delete', 'story-video'];

const GOOGLE_DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)';
const identityCache = new Map();
const IDENTITY_TTL_MS = 5 * 60 * 1000;

async function identify(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const hit = identityCache.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;

  let user = null;
  try {
    const res = await fetch(GOOGLE_DRIVE_ABOUT, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const info = await res.json();
      const u = info && info.user;
      // Prefixed so a Drive-derived id can never collide with a userinfo `sub`.
      if (u && u.permissionId) user = { id: 'drive:' + u.permissionId, email: u.emailAddress || null };
    }
  } catch (e) { /* fall through to userinfo */ }

  if (!user) {
    try {
      const res = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const info = await res.json();
        if (info && info.sub) user = { id: info.sub, email: info.email || null };
      }
    } catch (e) { /* treated as unauthenticated */ }
  }

  if (user) {
    if (identityCache.size > 500) identityCache.clear();
    identityCache.set(token, { user, expires: Date.now() + IDENTITY_TTL_MS });
  }
  return user;
}

/** Runs a query that is allowed not to work, because the table or column it
 *  names may not exist on a database that has not had every migration. */
async function maybe(promise, fallback) {
  try { return await promise; } catch (e) { return fallback; }
}

/** Every crew this user belongs to, rosters included. The one response shape. */
async function crewsFor(env, userId) {
  const now = Date.now();
  /**
   * Everything past the roster is optional.
   *
   * A table that a migration has not created yet, or a column an ALTER has not
   * added, used to throw — and because one query lives inside the call that
   * builds every crew, a missing story table took the whole Social tab down
   * with it. Optional data is fetched behind `maybe`: absent means absent, not
   * broken.
   */
  await maybe(env.DB.prepare(`DELETE FROM stories WHERE expires_at < ?`).bind(now).run(), null);
  const mine = await env.DB.prepare(
    `SELECT c.* FROM crews c JOIN members m ON m.crew_id = c.id WHERE m.user_id = ? ORDER BY c.created_at`
  ).bind(userId).all();
  const crews = (mine.results || []);
  const out = [];
  for (const crew of crews) {
    const members = await env.DB.prepare(
      `SELECT * FROM members WHERE crew_id = ?`
    ).bind(crew.id).all();
    const reactions = await env.DB.prepare(
      `SELECT from_id, to_id, kind, emoji, day, seen FROM reactions WHERE crew_id = ? AND day >= ?`
    ).bind(crew.id, isoDaysAgo(14)).all();
    // Metadata only — the picture itself is fetched when someone opens it, or a
    // ten-person crew would cost a megabyte on every refresh.
    const stories = await maybe(env.DB.prepare(
      `SELECT id, user_id, caption, created_at, expires_at FROM stories WHERE crew_id = ? AND expires_at > ?`
    ).bind(crew.id, now).all(), { results: [] });
    const views = await maybe(env.DB.prepare(
      `SELECT subject, viewer, kind, ref FROM views WHERE crew_id = ? AND day = ?`
    ).bind(crew.id, isoDaysAgo(0)).all(), { results: [] });

    const roster = buildRoster(crew, members.results || [], reactions.results || [], userId);
    roster.logo = crew.logo || '';
    roster.members.forEach((m) => {
      m.stories = (stories.results || [])
        .filter((st) => st.user_id === m.id)
        .sort((a, b) => a.created_at - b.created_at)
        .map((st) => storyMeta(st, now, userId, views.results || []))
        .filter(Boolean);
      // The newest one is what the ring reflects; the rest are behind it.
      m.story = m.stories.length ? m.stories[m.stories.length - 1] : null;
      m.profileViewers = viewersOf(views.results || [], m.id, 'profile', userId);
    });
    out.push(roster);
  }
  return out;
}

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Writes the caller's card into every crew they are in. Called on app open. */
async function pushCard(env, user, card) {
  const clean = card ? fitCard(sanitiseCard(card)) : null;
  if (!clean) return;
  await env.DB.prepare(
    `UPDATE members SET card = ?, name = ?, updated_at = ? WHERE user_id = ?`
  ).bind(JSON.stringify(clean), clean.name || '', Date.now(), user.id).run();
}

async function crewRoute(path, body, env, cors) {
  if (!env || !env.DB) return jsonResponse({ error: 'no-db' }, 503, cors);

  /**
   * Which build is actually deployed.
   *
   * Everything else answers 401 before it looks at the path, so a probe with a
   * bad token cannot tell an old Worker from a new one — which made "did the
   * paste take?" unanswerable from outside. This one is pre-auth and says so
   * plainly. It reveals nothing: a version string is not a secret.
   */
  if (path === '/crew/version') {
    return jsonResponse({ version: CREW_BUILD, features: CREW_FEATURES }, 200, cors);
  }

  /**
   * What an invite is for, before accepting it — the crew's name and how many
   * people are in it. Deliberately the one route that needs no token: someone
   * following a link has not signed in yet, and being asked to sign in before
   * being told what you are signing into is the wrong order.
   *
   * It gives away nothing the link did not already give away, and it is not
   * guessable: the code is eight characters from a 29-letter alphabet.
   */
  if (path === '/crew/peek') {
    const code = normaliseCode(body && body.code);
    if (!code) return jsonResponse({ error: 'bad-code' }, 400, cors);
    const crew = await env.DB.prepare(`SELECT id, name FROM crews WHERE invite_code = ?`).bind(code).first();
    if (!crew) return jsonResponse({ error: 'no-such-crew' }, 404, cors);
    const size = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE crew_id = ?`).bind(crew.id).first();
    return jsonResponse({ crew: { name: crew.name, members: (size && size.n) || 0 } }, 200, cors);
  }

  const user = await identify(body && body.token);
  if (!user) return jsonResponse({ error: 'unauthorised' }, 401, cors);
  const now = Date.now();

  if (path === '/crew/sync') {
    await pushCard(env, user, body.card);
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  if (path === '/crew/create') {
    const name = cleanCrewName(body.name);
    if (!name) return jsonResponse({ error: 'bad-name' }, 400, cors);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE user_id = ?`).bind(user.id).first();
    if ((count && count.n) >= MAX_CREWS_PER_USER) return jsonResponse({ error: 'too-many-crews' }, 429, cors);

    const id = crypto.randomUUID();
    const code = newInviteCode(Array.from(crypto.getRandomValues(new Uint32Array(8))));
    await env.DB.prepare(
      `INSERT INTO crews (id, name, owner, invite_code, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(id, name, user.id, code, now).run();
    await env.DB.prepare(
      `INSERT INTO members (crew_id, user_id, email, name, photo, card, joined_at, updated_at)
       VALUES (?, ?, ?, '', '', NULL, ?, ?)`
    ).bind(id, user.id, user.email, now, now).run();
    await pushCard(env, user, body.card);
    return jsonResponse({ crews: await crewsFor(env, user.id), joinedId: id }, 200, cors);
  }

  if (path === '/crew/join') {
    const code = normaliseCode(body.code);
    if (!code) return jsonResponse({ error: 'bad-code' }, 400, cors);
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE invite_code = ?`).bind(code).first();
    if (!crew) return jsonResponse({ error: 'no-such-crew' }, 404, cors);

    const already = await env.DB.prepare(
      `SELECT 1 AS x FROM members WHERE crew_id = ? AND user_id = ?`
    ).bind(crew.id, user.id).first();
    if (!already) {
      const size = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE crew_id = ?`).bind(crew.id).first();
      if ((size && size.n) >= MAX_MEMBERS_PER_CREW) return jsonResponse({ error: 'crew-full' }, 429, cors);
      const mine = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE user_id = ?`).bind(user.id).first();
      if ((mine && mine.n) >= MAX_CREWS_PER_USER) return jsonResponse({ error: 'too-many-crews' }, 429, cors);
      await env.DB.prepare(
        `INSERT INTO members (crew_id, user_id, email, name, photo, card, joined_at, updated_at)
         VALUES (?, ?, ?, '', '', NULL, ?, ?)`
      ).bind(crew.id, user.id, user.email, now, now).run();
    }
    await pushCard(env, user, body.card);
    return jsonResponse({ crews: await crewsFor(env, user.id), joinedId: crew.id }, 200, cors);
  }

  if (path === '/crew/leave') {
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE id = ?`).bind(body.crewId).first();
    if (!crew) return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
    const members = await env.DB.prepare(
      `SELECT user_id, joined_at FROM members WHERE crew_id = ?`
    ).bind(crew.id).all();
    const next = ownerAfterLeaving(crew, members.results || [], user.id);

    await env.DB.prepare(`DELETE FROM members WHERE crew_id = ? AND user_id = ?`).bind(crew.id, user.id).run();
    await env.DB.prepare(`DELETE FROM reactions WHERE crew_id = ? AND (from_id = ? OR to_id = ?)`)
      .bind(crew.id, user.id, user.id).run();
    if (next.deleteCrew) {
      await env.DB.prepare(`DELETE FROM reactions WHERE crew_id = ?`).bind(crew.id).run();
      await env.DB.prepare(`DELETE FROM crews WHERE id = ?`).bind(crew.id).run();
    } else if (next.owner !== crew.owner) {
      await env.DB.prepare(`UPDATE crews SET owner = ? WHERE id = ?`).bind(next.owner, crew.id).run();
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  /** The crew's name and its motto — one route, because they are the same
   *  decision made by the same person on the same screen. */
  if (path === '/crew/rename') {
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE id = ?`).bind(body.crewId).first();
    if (!isOwner(crew, user.id)) return jsonResponse({ error: 'not-owner' }, 403, cors);
    if (body.name !== undefined) {
      const name = cleanCrewName(body.name);
      if (!name) return jsonResponse({ error: 'bad-name' }, 400, cors);
      await env.DB.prepare(`UPDATE crews SET name = ? WHERE id = ?`).bind(name, crew.id).run();
    }
    if (body.motto !== undefined) {
      try {
        await env.DB.prepare(`UPDATE crews SET motto = ? WHERE id = ?`).bind(cleanMotto(body.motto), crew.id).run();
      } catch (e) {
        return jsonResponse({ error: 'needs-motto-column' }, 503, cors);
      }
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  /**
   * The leader assigns a role and a class. Titles only — nothing in this Worker
   * reads either one to decide what anybody may do, so handing one out cannot
   * hand out power.
   */
  if (path === '/crew/role') {
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE id = ?`).bind(body.crewId).first();
    if (!isOwner(crew, user.id)) return jsonResponse({ error: 'no-rank' }, 403, cors);
    try {
      if (body.role !== undefined) {
        await env.DB.prepare(`UPDATE members SET role = ? WHERE crew_id = ? AND user_id = ?`)
          .bind(cleanRole(body.role), crew.id, body.userId).run();
      }
      if (body.klass !== undefined) {
        await env.DB.prepare(`UPDATE members SET class = ? WHERE crew_id = ? AND user_id = ?`)
          .bind(cleanClass(body.klass), crew.id, body.userId).run();
      }
    } catch (e) {
      return jsonResponse({ error: 'needs-role-columns' }, 503, cors);
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  /** A crew's own picture, set by whoever leads it. Same budget as a member
   *  card's photo, for the same reason. */
  if (path === '/crew/logo') {
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE id = ?`).bind(body.crewId).first();
    if (!isOwner(crew, user.id)) return jsonResponse({ error: 'no-rank' }, 403, cors);
    if (body.logo && !storyImageOk(body.logo)) return jsonResponse({ error: 'bad-image' }, 400, cors);
    try {
      await env.DB.prepare(`UPDATE crews SET logo = ? WHERE id = ?`).bind(body.logo || '', crew.id).run();
    } catch (e) {
      return jsonResponse({ error: 'needs-logo-column' }, 503, cors);
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  if (path === '/crew/remove') {
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE id = ?`).bind(body.crewId).first();
    if (!isOwner(crew, user.id)) return jsonResponse({ error: 'not-owner' }, 403, cors);
    if (body.userId === user.id) return jsonResponse({ error: 'not-yourself' }, 400, cors);
    await env.DB.prepare(`DELETE FROM members WHERE crew_id = ? AND user_id = ?`).bind(crew.id, body.userId).run();
    await env.DB.prepare(`DELETE FROM reactions WHERE crew_id = ? AND (from_id = ? OR to_id = ?)`)
      .bind(crew.id, body.userId, body.userId).run();
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  if (path === '/crew/react') {
    const r = cleanReaction(body.kind, body.emoji);
    if (!r) return jsonResponse({ error: 'bad-reaction' }, 400, cors);
    const mine = await env.DB.prepare(
      `SELECT 1 AS x FROM members WHERE crew_id = ? AND user_id = ?`
    ).bind(body.crewId, user.id).first();
    const theirs = await env.DB.prepare(
      `SELECT 1 AS x FROM members WHERE crew_id = ? AND user_id = ?`
    ).bind(body.crewId, body.toId).first();
    if (!mine || !theirs) return jsonResponse({ error: 'not-in-crew' }, 403, cors);
    // Applauding yourself is not a feature.
    if (body.toId === user.id) return jsonResponse({ error: 'not-yourself' }, 400, cors);
    // The primary key is the dedupe: the same reaction twice in a day is the
    // same row, so nobody can spam a crew by holding a button down.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reactions (crew_id, from_id, to_id, kind, emoji, day, created_at, seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(body.crewId, user.id, body.toId, r.kind, r.emoji, isoDaysAgo(0), now).run();
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  /** Post a picture to one crew. One live story per person per crew: a new one
   *  replaces the old, which is what "story" means and saves a delete button. */
  if (path === '/crew/story') {
    const inCrew = await env.DB.prepare(
      `SELECT 1 AS x FROM members WHERE crew_id = ? AND user_id = ?`
    ).bind(body.crewId, user.id).first();
    if (!inCrew) return jsonResponse({ error: 'not-in-crew' }, 403, cors);
    if (!storyImageOk(body.image)) return jsonResponse({ error: 'bad-image' }, 400, cors);
    try {
      // No delete: a day can hold as many as you post, the way a story rail
      // works everywhere else. They expire on their own timestamps.
      await env.DB.prepare(
        `INSERT INTO stories (id, crew_id, user_id, image, caption, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), body.crewId, user.id, body.image, cleanCaption(body.caption), now, now + STORY_LIFE_MS).run();
    } catch (e) {
      return jsonResponse({ error: 'needs-story-table' }, 503, cors);
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  /**
   * Take one back.
   *
   * Only the author: the WHERE clause carries `user_id = ?`, so ownership is
   * enforced by the statement rather than by a check that a later edit could
   * forget to make. A story that is not yours, or already gone, answers the
   * same 404 — there is nothing to learn from the difference.
   *
   * A hard DELETE, not an expiry brought forward: the row holds the picture,
   * and "gone" should mean the bytes are gone.
   */
  if (path === '/crew/story/delete') {
    try {
      const res = await env.DB.prepare(
        `DELETE FROM stories WHERE id = ? AND user_id = ?`
      ).bind(body.storyId, user.id).run();
      if (!res.meta || !res.meta.changes) return jsonResponse({ error: 'story-gone' }, 404, cors);
    } catch (e) {
      return jsonResponse({ error: 'needs-story-table' }, 503, cors);
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  /** The picture, plus the view it records. Opening IS the view — there is no
   *  separate "mark as seen" for a thing you are looking at. */
  if (path === '/crew/story/open') {
    const row = await env.DB.prepare(
      `SELECT * FROM stories WHERE id = ? AND expires_at > ?`
    ).bind(body.storyId, now).first();
    if (!row) return jsonResponse({ error: 'story-gone' }, 404, cors);
    const inCrew = await env.DB.prepare(
      `SELECT 1 AS x FROM members WHERE crew_id = ? AND user_id = ?`
    ).bind(row.crew_id, user.id).first();
    if (!inCrew) return jsonResponse({ error: 'not-in-crew' }, 403, cors);
    if (row.user_id !== user.id) {
      await maybe(env.DB.prepare(
        `INSERT OR IGNORE INTO views (crew_id, subject, viewer, kind, ref, day, viewed_at)
         VALUES (?, ?, ?, 'story', ?, ?, ?)`
      ).bind(row.crew_id, row.user_id, user.id, row.id, isoDaysAgo(0), now).run(), null);
    }
    return jsonResponse({ image: row.image, caption: row.caption || '', createdAt: row.created_at }, 200, cors);
  }

  /** Somebody opened somebody's card. One row per viewer per day, by primary
   *  key, so a scroll past a name is not ten views. */
  if (path === '/crew/view') {
    if (body.subject && body.subject !== user.id) {
      await maybe(env.DB.prepare(
        `INSERT OR IGNORE INTO views (crew_id, subject, viewer, kind, ref, day, viewed_at)
         VALUES (?, ?, ?, 'profile', '', ?, ?)`
      ).bind(body.crewId, body.subject, user.id, isoDaysAgo(0), now).run(), null);
    }
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  if (path === '/crew/seen') {
    await env.DB.prepare(`UPDATE reactions SET seen = 1 WHERE to_id = ?`).bind(user.id).run();
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  return null;   // not a crew path; the broker's own router handles it
}

// ===== worker/index.js =====



const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (!cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return jsonResponse({ error: 'method' }, 405, cors);

    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'bad-json' }, 400, cors); }

    if (url.pathname === '/exchange') return exchange(body, env, cors);
    if (url.pathname === '/token') return refresh(body, env, cors);
    if (url.pathname === '/revoke') return revoke(body, env, cors);

    // The crew endpoints share this Worker because they share its one job:
    // holding the thing a browser must not. They keep their own file, and a
    // Worker deployed without a DB binding simply answers 503 to them while
    // token broking carries on — sync must never depend on the crew.
    if (url.pathname.startsWith('/crew/')) {
      // An exception escaping here becomes Cloudflare's own error page, which
      // carries no CORS headers — so the browser reports it as a network
      // failure and the app tells you that you are offline. A thrown error is
      // now an answer with a reason in it, which is the difference between a
      // bug you can find and a bug you cannot.
      let res;
      try {
        res = await crewRoute(url.pathname, body, env, cors);
      } catch (err) {
        console.log('crew route failed', url.pathname, err && err.message);
        return jsonResponse({ error: 'crew-failed', detail: String((err && err.message) || err).slice(0, 200) }, 500, cors);
      }
      if (res) return res;
    }
    return jsonResponse({ error: 'not-found' }, 404, cors);
  },
};

// code + client secret -> access + refresh token, plus the account email
async function exchange(body, env, cors) {
  if (!validateBody(body, ['code'])) return jsonResponse({ error: 'bad-body' }, 400, cors);
  const redirectUri = safeRedirectUri(body.redirectUri, env.ALLOWED_ORIGIN);
  if (!redirectUri) return jsonResponse({ error: 'bad-redirect' }, 400, cors);
  const params = new URLSearchParams({
    code: body.code,
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN, { method: 'POST', body: params });
  const json = await res.json();
  const mapped = mapGoogleToken(json, Date.now());
  if (!mapped || !mapped.refreshToken) return jsonResponse({ error: 'exchange-failed' }, 401, cors);
  let email = null;
  try {
    const u = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${mapped.accessToken}` } });
    if (u.ok) email = (await u.json()).email || null;
  } catch { /* email is optional */ }
  return jsonResponse({ ...mapped, email }, 200, cors);
}

// refresh token + client secret -> a fresh access token; refresh token is never stored
async function refresh(body, env, cors) {
  if (!validateBody(body, ['refreshToken'])) return jsonResponse({ error: 'bad-body' }, 400, cors);
  const params = new URLSearchParams({
    refresh_token: body.refreshToken,
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN, { method: 'POST', body: params });
  const json = await res.json();
  const mapped = mapGoogleToken(json, Date.now());
  // invalid_grant => the refresh token is dead; tell the app to re-auth.
  if (!mapped) return jsonResponse({ error: 'refresh-failed' }, 401, cors);
  return jsonResponse({ accessToken: mapped.accessToken, expiresAt: mapped.expiresAt }, 200, cors);
}

async function revoke(body, env, cors) {
  if (!validateBody(body, ['refreshToken'])) return jsonResponse({ error: 'bad-body' }, 400, cors);
  try { await fetch(GOOGLE_REVOKE + '?token=' + encodeURIComponent(body.refreshToken), { method: 'POST' }); } catch { /* best effort */ }
  return jsonResponse({ ok: true }, 200, cors);
}

