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

function gisReady() {
  return typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.oauth2;
}

function ensureTokenClient(onToken) {
  if (!gisReady()) return null;
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3500 * 1000);
          fetchEmail().finally(() => onToken && onToken(true));
        } else {
          onToken && onToken(false);
        }
      },
      error_callback: () => onToken && onToken(false),
    });
  }
  return tokenClient;
}

async function fetchEmail() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const info = await res.json();
      signedInEmail = info.email || null;
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
export function signIn() {
  return new Promise((resolve) => {
    if (!gisReady()) { resolve(false); return; }
    const client = ensureTokenClient((ok) => resolve(ok));
    if (!client) { resolve(false); return; }
    client.requestAccessToken({ prompt: isSignedIn() ? '' : 'consent' });
  });
}

/** Tries to silently refresh the token (no popup) — used on app open, given a
 * remembered email from a previous session. Resolves true/false. */
export function trySilentSignIn(emailHint) {
  return new Promise((resolve) => {
    if (!gisReady()) { resolve(false); return; }
    const client = ensureTokenClient((ok) => resolve(ok));
    if (!client) { resolve(false); return; }
    try {
      client.requestAccessToken({ prompt: 'none', hint: emailHint || undefined });
    } catch (e) {
      resolve(false);
    }
  });
}

export function signOut() {
  if (accessToken && gisReady() && window.google.accounts.oauth2.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  signedInEmail = null;
}

async function driveFetch(url, options = {}) {
  if (!accessToken) throw new Error('not-signed-in');
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) { accessToken = null; throw new Error('token-expired'); }
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
