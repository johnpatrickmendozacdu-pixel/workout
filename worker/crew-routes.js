// The crew endpoints: D1 and Google live here, the rules live in crew.js.
//
// Every route follows the same three steps — identify the caller from their
// Google token, apply a rule, return the caller's crews. Returning the whole
// picture from every route means the app never has to reason about which of its
// local copies a response invalidates: it replaces them.

import {
  newInviteCode, normaliseCode, cleanCrewName, sanitiseCard, fitCard,
  isOwner, ownerAfterLeaving, buildRoster, cleanReaction,
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

/** Every crew this user belongs to, rosters included. The one response shape. */
async function crewsFor(env, userId) {
  const mine = await env.DB.prepare(
    `SELECT c.* FROM crews c JOIN members m ON m.crew_id = c.id WHERE m.user_id = ? ORDER BY c.created_at`
  ).bind(userId).all();
  const crews = (mine.results || []);
  const out = [];
  for (const crew of crews) {
    const members = await env.DB.prepare(
      `SELECT user_id, name, card, joined_at, updated_at FROM members WHERE crew_id = ?`
    ).bind(crew.id).all();
    const reactions = await env.DB.prepare(
      `SELECT from_id, to_id, kind, emoji, day, seen FROM reactions WHERE crew_id = ? AND day >= ?`
    ).bind(crew.id, isoDaysAgo(14)).all();
    out.push(buildRoster(crew, members.results || [], reactions.results || [], userId));
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
    // The primary key is the dedupe: the same reaction twice in a day is the
    // same row, so nobody can spam a crew by holding a button down.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reactions (crew_id, from_id, to_id, kind, emoji, day, created_at, seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(body.crewId, user.id, body.toId, r.kind, r.emoji, isoDaysAgo(0), now).run();
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  if (path === '/crew/seen') {
    await env.DB.prepare(`UPDATE reactions SET seen = 1 WHERE to_id = ?`).bind(user.id).run();
    return jsonResponse({ crews: await crewsFor(env, user.id) }, 200, cors);
  }

  return null;   // not a crew path; the broker's own router handles it
}
