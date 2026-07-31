// Minimal promise-based wrapper around browser-native IndexedDB.
// One object store, key/value shaped, mirroring the artifact prototype's
// storage API so the rest of the app doesn't need to know which backend it's on.

const DB_NAME = 'workout-tracker';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;

/**
 * ===================== ONE DEVICE, SEVERAL ACCOUNTS =====================
 * Workout data belongs to the Google account it was logged under, so every
 * data key is written behind a namespace and two accounts on the same phone
 * never see each other's sets.
 *
 * The first account to sign in *claims the unprefixed keys* rather than being
 * copied into a namespace of its own. That is what makes this change safe to
 * ship to someone who already has months of data: their keys are not moved,
 * renamed or rewritten, so there is no migration that can go wrong. Only a
 * second, different account gets a prefix.
 *
 * These keys stay global, because they are how the app works out whose data to
 * load in the first place — namespacing them would hide the answer inside the
 * question.
 */
const GLOBAL_KEYS = new Set([
  'sync-account', 'sync-token', 'sync-enabled', 'sync-redirect-at',
  'local-claimed-by', 'active-ns',
]);

let namespace = '';

/** '' is the claiming account's dataset; anyone else gets `u:<email>:`. */
export function namespaceFor(email, claimedBy) {
  if (!email) return '';
  if (!claimedBy || claimedBy === email) return '';
  return `u:${email}:`;
}

export function setNamespace(ns) { namespace = ns || ''; }
export function getNamespace() { return namespace; }

const scoped = (key) => (GLOBAL_KEYS.has(key) ? key : namespace + key);

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getItem(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(scoped(key));
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function setItem(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key: scoped(key), value });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Request persistent storage so the browser is less likely to evict this
 * site's data under storage pressure. Best-effort — not supported everywhere,
 * and even where it is, it's a request, not a guarantee (see README re: iOS Safari).
 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) {
    // ignore — non-fatal
  }
  return false;
}

/** Small localStorage-backed helper for lightweight UI preferences only
 *  (e.g. last active tab). Never used for exercise/set data. */
export const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('pref:' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('pref:' + key, JSON.stringify(value));
    } catch (e) {
      // ignore — non-fatal
    }
  },
};
