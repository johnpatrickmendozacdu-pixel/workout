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

// Empty until the Cloudflare Worker is deployed and its URL is filled in here.
// While empty, every broker path below is skipped and the app uses the existing
// Google Identity Services flow — so shipping this with an empty URL changes
// nothing and cannot regress.
const BROKER_URL = 'https://sets-broker.johnpatrickmendoza-cdu.workers.dev';

export function brokerConfigured() { return typeof BROKER_URL === 'string' && BROKER_URL.length > 0; }

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let signedInEmail = null;
let emailPromise = null;
let lastAuthError = null;
let refreshToken = null;

/** Why the last sign-in attempt failed, or null. See googleSignInHandler. */
export function getLastAuthError() { return lastAuthError; }

/** Milliseconds before actual expiry at which we treat a token as stale and
 *  renew it, so a Drive call never races the expiry boundary. */
/** Only renew when the token is genuinely about to die. Renewing five minutes
 *  early meant every sync in that window first attempted a silent re-auth —
 *  which Safari's tracking prevention blocks — turning a perfectly usable token
 *  into a "Sync paused" prompt. A 401 replay already covers dying mid-flight. */
const TOKEN_REFRESH_MARGIN_MS = 30 * 1000;
const GIS_WAIT_TIMEOUT_MS = 10000;
/** Silent auth is a background round-trip — fail fast so the UI never lingers.
 *  Interactive auth waits on a human in a popup, so it gets much longer. */
const SILENT_AUTH_TIMEOUT_MS = 6000;
const INTERACTIVE_AUTH_TIMEOUT_MS = 45000;
const NETWORK_TIMEOUT_MS = 15000;

let lastEmailHint = null;

/**
 * ===================== SILENT RENEWAL BY REDIRECT =====================
 * The token client renews in a hidden iframe to accounts.google.com. Safari's
 * tracking prevention blocks that iframe's cookies, so on iOS the silent path
 * can never succeed and every expired token became a login prompt.
 *
 * A TOP-LEVEL navigation is a different matter: accounts.google.com is
 * first-party during it, so the Google session cookie is sent and `prompt=none`
 * returns a token with no interaction at all — a flash on open rather than a
 * login. Returns you straight back here.
 */
/**
 * Where Google sends you back to. Derived from wherever the app is actually
 * running rather than written down, so moving hosts is a Google Console entry
 * and nothing else — the old hardcoded URL was the single thing that made a
 * host change a code change.
 *
 * Every address this may resolve to must be registered in Google Cloud as an
 * authorised redirect URI, or sign-in fails there.
 */
const REDIRECT_URI = (() => {
  if (typeof location === 'undefined') return '';
  const path = location.pathname.replace(/index\.html$/, '');
  return location.origin + (path.endsWith('/') ? path : path + '/');
})();

export function canRedirectRenew() {
  return typeof location !== 'undefined' && (location.origin + location.pathname) === REDIRECT_URI;
}

/**
 * Reads a token handed back in the URL fragment. Runs before anything else so
 * the app starts already authorised, and always clears the fragment so a
 * refresh cannot replay a stale token.
 */
export function consumeRedirectResult() {
  if (typeof location === 'undefined') return null;
  // Broker code flow returns ?code=…&state=sets-code in the query string. Hand the
  // code back for main.js to exchange; clear it so a refresh cannot replay it.
  const q = new URLSearchParams(location.search || '');
  if (q.get('state') === 'sets-code' && q.get('code')) {
    const code = q.get('code');
    history.replaceState(null, '', location.pathname);
    return { pendingCode: code };
  }
  if (!location.hash) return null;
  const raw = location.hash.slice(1);
  if (raw.indexOf('state=sets-renew') === -1) return null;
  const p = new URLSearchParams(raw);
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('access_token')) {
    accessToken = p.get('access_token');
    tokenExpiresAt = Date.now() + (parseInt(p.get('expires_in'), 10) || 3500) * 1000;
    if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, refreshToken, email: signedInEmail });
    emailPromise = fetchEmail();
    return { ok: true };
  }
  // interaction_required / login_required: not signed in to Google here. Not an
  // error worth showing — the backup simply waits.
  return { ok: false, error: p.get('error') || 'no-token' };
}

export function redirectRenew(emailHint) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('prompt', 'none');
  url.searchParams.set('include_granted_scopes', 'true');
  if (emailHint || lastEmailHint) url.searchParams.set('login_hint', emailHint || lastEmailHint);
  // Marks the fragment as ours so nothing else is mistaken for a token.
  url.searchParams.set('state', 'sets-renew');
  location.assign(url.toString());
}

let onTokenStored = null;

/** The app persists the token so a relaunch inside its lifetime syncs straight
 *  away instead of attempting a silent re-auth that Safari will block. */
export function setTokenListener(cb) { onTokenStored = cb; }

export function restoreSession(record) {
  if (!record) return false;
  if (record.email) { signedInEmail = record.email; lastEmailHint = record.email; }
  // A refresh token restores the session even when the access token has expired:
  // the broker can mint a fresh one silently, which is the whole point.
  if (record.refreshToken) refreshToken = record.refreshToken;
  const accessUsable = record.token && record.expiresAt && record.expiresAt - Date.now() > 30000;
  if (accessUsable) {
    accessToken = record.token;
    tokenExpiresAt = record.expiresAt;
    return true;
  }
  return brokerConfigured() && !!refreshToken;
}

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
          lastAuthError = null;
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3500 * 1000);
          if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, email: signedInEmail });
          // Deliberately not awaited: the address is only used for display, so
          // holding sync behind an extra round-trip just makes it feel slow.
          emailPromise = fetchEmail();
          settle(true);
        } else {
          lastAuthError = (resp && resp.error) || 'no-token';
          settle(false);
        }
      },
      // Google reports a tester-list rejection here as access_denied. Keeping
      // the reason is what lets the app say "not you, not broken".
      error_callback: (err) => { lastAuthError = (err && err.type) || 'access_denied'; settle(false); },
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

/**
 * The address was once display-only, so it was fetched without being awaited.
 * It now decides which dataset the app loads, so there has to be a way to wait
 * for it — syncing before it lands could push one account's workouts into
 * another account's Drive. Resolves to null rather than hanging if it fails.
 */
export async function ensureEmail(timeoutMs) {
  if (signedInEmail) return signedInEmail;
  try {
    await Promise.race([
      emailPromise || Promise.resolve(),
      new Promise((r) => setTimeout(r, timeoutMs || 5000)),
    ]);
  } catch (e) { /* the address simply did not arrive */ }
  return signedInEmail;
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
 * ===================== TOKEN BROKER (never-stale sync) =====================
 * A stateless Cloudflare Worker holds the client secret and swaps tokens on
 * demand. The refresh token lives on this device (persisted via onTokenStored),
 * and the broker mints fresh access tokens in the background — no iframe, no
 * redirect, so it sidesteps the Safari path that dies at the hour mark. Every
 * broker call returns false on any failure, and the caller falls back to the
 * existing flow, so the app can never regress when the broker is off or down.
 */

/** Begin the authorization-code redirect: the one-time consent that yields a
 *  refresh token. Only used when the broker is configured (main.js decides). */
export function brokerSignIn(emailHint) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  if (emailHint || lastEmailHint) url.searchParams.set('login_hint', emailHint || lastEmailHint);
  url.searchParams.set('state', 'sets-code');
  location.assign(url.toString());
}

/** Trade an authorization code for tokens via the Worker; stores the refresh
 *  token on this device. Returns false on any failure (caller falls back). */
export async function brokerExchange(code) {
  if (!brokerConfigured() || !code) return false;
  try {
    const res = await fetchWithTimeout(BROKER_URL + '/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, redirectUri: REDIRECT_URI }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    if (!j.accessToken || !j.refreshToken) return false;
    accessToken = j.accessToken;
    tokenExpiresAt = j.expiresAt || (Date.now() + 3500 * 1000);
    refreshToken = j.refreshToken;
    if (j.email) { signedInEmail = j.email; lastEmailHint = j.email; }
    lastAuthError = null;
    if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, refreshToken, email: signedInEmail });
    return true;
  } catch (e) { return false; }
}

/** Mint a fresh access token from the stored refresh token, fully in the
 *  background. Returns false when the broker is off, there is no refresh token,
 *  or Google rejects it (a dead token is dropped so the app re-auths). */
export async function brokerRefresh() {
  if (!brokerConfigured() || !refreshToken) return false;
  try {
    const res = await fetchWithTimeout(BROKER_URL + '/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 401) { refreshToken = null; if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, refreshToken: null, email: signedInEmail }); return false; }
    if (!res.ok) return false;
    const j = await res.json();
    if (!j.accessToken) return false;
    accessToken = j.accessToken;
    tokenExpiresAt = j.expiresAt || (Date.now() + 3500 * 1000);
    if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, refreshToken, email: signedInEmail });
    return true;
  } catch (e) { return false; }
}

/**
 * Access tokens last about an hour. The broker renews them silently in the
 * background; only if it is off or fails do we fall back to the iframe/redirect
 * path Safari fights with. Every Drive call goes through this first.
 */
export async function ensureFreshToken() {
  if (accessToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return true;
  if (await brokerRefresh()) return true;
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
  if (onTokenStored) onTokenStored(null);
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
