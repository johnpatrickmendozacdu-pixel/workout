// The crew endpoints: D1 and Google live here, the rules live in crew.js.
//
// Every route follows the same three steps — identify the caller from their
// Google token, apply a rule, return the caller's crews. Returning the whole
// picture from every route means the app never has to reason about which of its
// local copies a response invalidates: it replaces them.

import {
  newInviteCode, normaliseCode, cleanCrewName, sanitiseCard, fitCard,
  isOwner, ownerAfterLeaving, buildRoster, cleanReaction, cleanRole, cleanClass,
  cleanCaption, storyImageOk, storyMeta, viewersOf, STORY_LIFE_MS,
  MAX_CREWS_PER_USER, MAX_MEMBERS_PER_CREW,
} from './crew.js';
import { jsonResponse, GOOGLE_USERINFO } from './broker.js';


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
export const CREW_BUILD = '2026-08-12.9';
export const CREW_FEATURES = ['peek', 'isMe', 'target-due', 'days-strip', 'photo-24k', 'stories', 'views', 'roles', 'classes', 'crew-logo', 'multi-story', 'rest-days'];

const GOOGLE_DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)';
const identityCache = new Map();
const IDENTITY_TTL_MS = 5 * 60 * 1000;

export async function identify(token) {
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

export async function crewRoute(path, body, env, cors) {
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

  if (path === '/crew/rename') {
    const name = cleanCrewName(body.name);
    if (!name) return jsonResponse({ error: 'bad-name' }, 400, cors);
    const crew = await env.DB.prepare(`SELECT * FROM crews WHERE id = ?`).bind(body.crewId).first();
    if (!isOwner(crew, user.id)) return jsonResponse({ error: 'not-owner' }, 403, cors);
    await env.DB.prepare(`UPDATE crews SET name = ? WHERE id = ?`).bind(name, crew.id).run();
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
