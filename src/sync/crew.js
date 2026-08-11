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

async function post(path, payload) {
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
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
      console.warn('[crew]', path, res.status, code);
      return { ok: false, error: code };
    }
    return { ok: true, crews: (data && data.crews) || [], joinedId: data && data.joinedId };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** Push my card and pull every crew I am in. The one call the app makes on open. */
export function syncCrews(card) { return post('/crew/sync', { card }); }

export function createCrew(name, card) { return post('/crew/create', { name, card }); }
export function joinCrew(code, card) { return post('/crew/join', { code, card }); }
export function leaveCrew(crewId) { return post('/crew/leave', { crewId }); }
export function renameCrew(crewId, name) { return post('/crew/rename', { crewId, name }); }
export function removeMember(crewId, userId) { return post('/crew/remove', { crewId, userId }); }
export function react(crewId, toId, kind, emoji) { return post('/crew/react', { crewId, toId, kind, emoji }); }
export function markSeen(crewId) { return post('/crew/seen', { crewId }); }

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
};

export function crewErrorText(code) {
  // Anything unmapped still names itself. "That did not work" tells a person
  // nothing and tells whoever is debugging it less.
  return CREW_ERRORS[code] || `That did not work (${code || 'no reason given'}).`;
}
