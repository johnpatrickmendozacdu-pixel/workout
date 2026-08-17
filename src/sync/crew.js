/**
 * Talking to the crew half of the Worker.
 *
 * Every call is the same shape — POST, the Google access token in the body, a
 * full picture of my crews in the response — so this file is thin on purpose:
 * one function does the request, and the callers differ only in a path and a
 * payload. There is no client-side model to keep in step, because a response
 * replaces what came before rather than patching it.
 *
 * Nothing here throws. A crew that cannot be reached is a crew screen with a
 * stale roster and a quiet note, never a broken app: the Social tab is the only
 * thing in Sets that needs the network, and it must not be able to take
 * anything else down with it.
 */
import * as gsync from './googleSync.js';

const TIMEOUT_MS = 12000;
const UPLOAD_TIMEOUT_MS = 45000;

async function post(path, payload, timeoutMs) {
  const base = gsync.getBrokerUrl();
  if (!base) return { ok: false, error: 'no-broker' };
  let token = gsync.getAccessToken();
  if (!token) {
    // The token may simply have aged out while the app sat on a table.
    const renewed = await gsync.ensureFreshToken().catch(() => false);
    token = renewed ? gsync.getAccessToken() : null;
  }
  if (!token) return { ok: false, error: 'signed-out' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      // One retry on a token Google no longer likes, then give up quietly.
      const renewed = await gsync.ensureFreshToken().catch(() => false);
      const fresh = renewed ? gsync.getAccessToken() : null;
      if (!fresh) return { ok: false, error: 'signed-out' };
      const again = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, token: fresh }),
      });
      const retryData = await again.json().catch(() => null);
      return again.ok
        ? { ok: true, crews: (retryData && retryData.crews) || [], joinedId: retryData && retryData.joinedId }
        : { ok: false, error: (retryData && retryData.error) || 'failed' };
    }
    if (!res.ok) {
      const code = (data && data.error) || 'failed';
      console.warn('[crew]', path, res.status, code, (data && data.detail) || '');
      return { ok: false, error: code, detail: (data && data.detail) || '' };
    }
    return { ok: true, crews: (data && data.crews) || [], joinedId: data && data.joinedId };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What an invite leads to, before accepting it. The only call that works signed
 * out — someone following a link deserves to be told what they are joining
 * before being asked to sign in.
 */
export async function peekCrew(code) {
  const base = gsync.getBrokerUrl();
  if (!base) return { ok: false, error: 'no-broker' };
  try {
    const res = await fetch(base + '/crew/peek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (data && data.error) || 'failed' };
    return { ok: true, crew: data && data.crew };
  } catch (e) {
    return { ok: false, error: 'offline' };
  }
}

/** Push my card and pull every crew I am in. The one call the app makes on open. */
export function syncCrews(card) { return post('/crew/sync', { card }); }

export function createCrew(name, card) { return post('/crew/create', { name, card }); }
export function joinCrew(code, card) { return post('/crew/join', { code, card }); }
export function leaveCrew(crewId) { return post('/crew/leave', { crewId }); }
export function renameCrew(crewId, what) { return post('/crew/rename', { crewId, ...what }); }
export function removeMember(crewId, userId) { return post('/crew/remove', { crewId, userId }); }
export function react(crewId, toId, kind, emoji) { return post('/crew/react', { crewId, toId, kind, emoji }); }
export function markSeen(crewId) { return post('/crew/seen', { crewId }); }
// A picture over a phone connection is not a roster fetch; it gets its own
// patience rather than being called offline at twelve seconds.
export function setRole(crewId, userId, what) { return post('/crew/role', { crewId, userId, ...what }); }
export function setCrewLogo(crewId, logo) { return post('/crew/logo', { crewId, logo }, UPLOAD_TIMEOUT_MS); }
export function postStory(crewId, image, caption) {
  return post('/crew/story', { crewId, image, caption }, UPLOAD_TIMEOUT_MS);
}
export function recordView(crewId, subject) { return post('/crew/view', { crewId, subject }); }

/** Take one back. Owner-only, enforced by the Worker's WHERE clause. */
export function deleteStory(storyId) { return post('/crew/story/delete', { storyId }); }

/** The picture itself, fetched only when someone opens it — and the act of
 *  fetching is the view. Returns the raw payload rather than a crew list,
 *  because this is the one call that is not about the roster. */
export async function openStory(storyId) {
  const base = gsync.getBrokerUrl();
  const token = gsync.getAccessToken() || (await gsync.ensureFreshToken().catch(() => false) ? gsync.getAccessToken() : null);
  if (!base || !token) return { ok: false, error: 'signed-out' };
  try {
    const res = await fetch(base + '/crew/story/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId, token }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (data && data.error) || 'failed' };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: 'offline' };
  }
}

/** Human words for the errors a person can actually do something about. */
export const CREW_ERRORS = {
  // The Worker knows the token but Google would not vouch for it. Almost always
  // a session that has gone stale in a way a refresh cannot fix.
  unauthorised: 'Google would not confirm your sign-in. Open your profile, sign out, and sign in again.',
  'not-found': 'This app is talking to an older Worker — it needs redeploying.',
  failed: 'The crew service refused that. Try again in a moment.',
  'signed-out': 'Sign in with Google to use crews.',
  'no-broker': 'Crews are not switched on in this build.',
  offline: "Can't reach your crew — you're offline.",
  timeout: "Your crew didn't answer. Try again.",
  'no-db': 'The crew service is still being set up.',
  'bad-code': 'That invite code does not look right.',
  'no-such-crew': 'That invite has expired, or the crew is gone.',
  'crew-full': 'That crew is full.',
  'too-many-crews': "You're in as many crews as Sets allows.",
  'not-owner': 'Only the person who made the crew can do that.',
  'bad-name': 'Give the crew a name.',
  'bad-image': "That picture didn't work. Try another one.",
  'story-gone': 'That story has expired.',
  'not-in-crew': 'You are not in that crew.',
  'not-yourself': 'That one is for other people.',
  'crew-failed': 'The crew service hit an error — the reason is in the console and the Worker log.',
  'no-rank': 'Only the crew leader can set ranks.',
  'needs-role-columns': 'Roles and classes need two lines of SQL adding to the database first.',
  'needs-logo-column': 'A crew logo needs one line of SQL adding to the database first.',
  'needs-motto-column': 'A crew motto needs one line of SQL adding to the database first.',
  'needs-story-table': 'Stories need their tables adding to the database first.',
};

export function crewErrorText(code, detail) {
  // A detail from the Worker is the actual SQLite or runtime message. Showing
  // it is ugly and it is also the difference between a report I can act on and
  // "it didn't work".
  if (code === 'crew-failed' && detail) return `Crew error: ${detail}`;
  // Anything unmapped still names itself. "That did not work" tells a person
  // nothing and tells whoever is debugging it less.
  return CREW_ERRORS[code] || `That did not work (${code || 'no reason given'}).`;
}
