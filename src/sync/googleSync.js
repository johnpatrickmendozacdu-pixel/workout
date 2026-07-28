/**
 * ===================== GOOGLE SIGN-IN + DRIVE SYNC =====================
 * Free, no backend: uses Google Identity Services for sign-in and a private
 * "appDataFolder" in the person's own Google Drive (hidden from their normal
 * Drive view, visible only to this app) to store one JSON snapshot of the
 * whole app. This module is intentionally self-contained (no imports from
 * main.js) so it can fail gracefully if Google's script hasn't loaded, the
 * person is offline, or they've never signed in.
 */

const CLIENT_ID = '515660891133-63v7l803od2cee981sineagm6snl3kfb.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const BACKUP_FILENAME = 'workout-tracker-data.json';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let signedInEmail = null;

/** Milliseconds before actual expiry at which we treat a token as stale and
 *  renew it, so a Drive call never races the expiry boundary. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const GIS_WAIT_TIMEOUT_MS = 10000;
/** Silent auth is a background round-trip — fail fast so the UI never lingers.
 *  Interactive auth waits on a human in a popup, so it gets much longer. */
const SILENT_AUTH_TIMEOUT_MS = 6000;
const INTERACTIVE_AUTH_TIMEOUT_MS = 120000;
const NETWORK_TIMEOUT_MS = 15000;

let lastEmailHint = null;

function gisReady() {
  return typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.oauth2;
}

/**
 * Google's script is loaded with `async defer`, so on a fresh page load it is
 * almost never ready by the time the app boots. Waiting for it (rather than
 * giving up immediately) is what lets a previous sign-in resume across a
 * refresh. Resolves false if the script never arrives — blocked, or offline —
 * in which case the app just runs on local data.
 */
function whenGisReady() {
  return new Promise((resolve) => {
    if (gisReady()) { resolve(true); return; }
    if (typeof window === 'undefined') { resolve(false); return; }
    const startedAt = Date.now();
    const handle = setInterval(() => {
      if (gisReady()) { clearInterval(handle); resolve(true); }
      else if (Date.now() - startedAt > GIS_WAIT_TIMEOUT_MS) { clearInterval(handle); resolve(false); }
    }, 100);
  });
}

/**
 * The token client is created once and reused, but each auth attempt needs its
 * own completion callback. Holding the current one in a module-level slot that
 * the (permanent) client callback reads is what makes the 2nd and later
 * attempts resolve — attaching onToken at construction time would strand every
 * attempt after the first, leaving the UI stuck on "Syncing…" forever.
 */
let pendingResolve = null;

function settle(ok) {
  const resolve = pendingResolve;
  pendingResolve = null;
  if (resolve) resolve(ok);
}

function ensureTokenClient(onToken) {
  if (!gisReady()) return null;
  pendingResolve = onToken;
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3500 * 1000);
          // Deliberately not awaited: the address is only used for display, so
          // holding sync behind an extra round-trip just makes it feel slow.
          fetchEmail();
          settle(true);
        } else {
          settle(false);
        }
      },
      error_callback: () => settle(false),
    });
  }
  return tokenClient;
}

/** Never let an auth attempt hang the UI: if Google neither calls back nor
 *  errors, treat it as a failure so the app can fall through to 'reconnect'. */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; pendingResolve = null; resolve(false); } }, ms);
    promise.then((v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } });
  });
}

/** fetch() never times out on its own — a stalled request would otherwise hold
 *  the sync UI open indefinitely. */
function fetchWithTimeout(url, options = {}, ms = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchEmail() {
  try {
    const res = await fetchWithTimeout('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const info = await res.json();
      signedInEmail = info.email || null;
      if (signedInEmail) lastEmailHint = signedInEmail;
    }
  } catch (e) {
    // non-fatal — sync still works without knowing the email to display
  }
}

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

export function getSignedInEmail() {
  return signedInEmail;
}

/** Opens Google's sign-in popup. Resolves true/false; never throws. */
export async function signIn() {
  const ready = await whenGisReady();
  if (!ready) return false;
  return withTimeout(new Promise((resolve) => {
    const client = ensureTokenClient((ok) => resolve(ok));
    if (!client) { resolve(false); return; }
    client.requestAccessToken({ prompt: isSignedIn() ? '' : 'consent' });
  }), INTERACTIVE_AUTH_TIMEOUT_MS);
}

/** Tries to silently refresh the token (no popup) — used on app open, given a
 * remembered email from a previous session. Resolves true/false. */
export async function trySilentSignIn(emailHint) {
  if (emailHint) lastEmailHint = emailHint;
  const ready = await whenGisReady();
  if (!ready) return false;
  return withTimeout(new Promise((resolve) => {
    const client = ensureTokenClient((ok) => resolve(ok));
    if (!client) { resolve(false); return; }
    try {
      client.requestAccessToken({ prompt: 'none', hint: emailHint || lastEmailHint || undefined });
    } catch (e) {
      resolve(false);
    }
  }), SILENT_AUTH_TIMEOUT_MS);
}

/**
 * Access tokens last about an hour and there is no refresh token without a
 * backend, so we renew silently whenever the current one is missing or close
 * to expiring. Every Drive call goes through this first, which is what keeps
 * sync alive through a long session instead of dying at the hour mark.
 */
export async function ensureFreshToken() {
  if (accessToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return true;
  return trySilentSignIn(lastEmailHint);
}

export function signOut() {
  lastEmailHint = null;
  pendingResolve = null;
  if (accessToken && gisReady() && window.google.accounts.oauth2.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  signedInEmail = null;
}

async function driveFetch(url, options = {}, isRetry = false) {
  await ensureFreshToken();
  if (!accessToken) throw new Error('not-signed-in');
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  // A 401 means the token died earlier than advertised (e.g. revoked elsewhere).
  // Renew once and replay the request rather than surfacing a sync failure.
  if (res.status === 401) {
    accessToken = null;
    tokenExpiresAt = 0;
    if (isRetry) throw new Error('token-expired');
    const renewed = await ensureFreshToken();
    if (!renewed) throw new Error('token-expired');
    return driveFetch(url, options, true);
  }
  return res;
}

async function findBackupFileId() {
  const q = encodeURIComponent(`name='${BACKUP_FILENAME}'`);
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`
  );
  if (!res.ok) throw new Error('list-failed');
  const data = await res.json();
  return (data.files && data.files[0]) || null;
}

/** Downloads the synced snapshot, or null if nothing's been synced from any device yet. */
export async function downloadBackup() {
  const file = await findBackupFileId();
  if (!file) return null;
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  if (!res.ok) throw new Error('download-failed');
  return res.json();
}

/** Uploads (creating or replacing) the synced snapshot. dataObj should include an `updatedAt` field. */
export async function uploadBackup(dataObj) {
  const existing = await findBackupFileId();
  const boundary = 'workoutsync' + Date.now();
  const metadata = existing ? {} : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(dataObj)}\r\n--${boundary}--`;
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await driveFetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error('upload-failed');
  return res.json();
}
