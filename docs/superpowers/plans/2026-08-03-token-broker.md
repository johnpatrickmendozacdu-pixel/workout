# Token-Broker (never-stale sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Google sync alive past the ~1-hour token expiry with no tap and no flash, via a free stateless Cloudflare Worker that brokers refresh-token exchanges, while the app falls back to today's flow if the broker is ever absent or failing.

**Architecture:** A stateless Worker (`worker/`) holds only the Google client secret and does the OAuth code→token and refresh→token exchanges on demand, storing nothing. The app stores each user's refresh token in its own IndexedDB and calls the Worker in the background to mint fresh access tokens. `googleSync.js` prefers the broker when a refresh token and a configured `BROKER_URL` exist, and otherwise uses the existing Google Identity Services path unchanged.

**Tech Stack:** Vanilla JS, Vite, vitest, Cloudflare Workers (module syntax). No new runtime dependencies in the app.

## Global Constraints

- 100% free: Cloudflare Workers free tier only; no KV, no storage, no paid anything.
- The Worker is **stateless** — it persists nothing, ever.
- The Worker touches **OAuth tokens only** — workout data never passes through it.
- **Cannot regress:** when `BROKER_URL` is empty or any broker call fails, the app behaves
  exactly as it does today (existing GIS flow, offline-first, sync-on-tap).
- Scope stays `https://www.googleapis.com/auth/drive.appdata`. Client ID unchanged:
  `515660891133-63v7l803od2cee981sineagm6snl3kfb.apps.googleusercontent.com`.
- Secrets (`CLIENT_SECRET`) live only in the Worker env, never in the shipped app.
- The 278 existing tests stay green throughout.
- Spec: `docs/superpowers/specs/2026-08-03-token-broker-design.md`

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/broker.js` | Pure Worker helpers: CORS, body validation, Google-response mapping | Create |
| `worker/index.js` | Worker entry: routes `/exchange`, `/token`, `/revoke`; calls Google | Create |
| `worker/README.md` | The user's one-time deploy + env-var steps | Create |
| `worker/broker.test.js` | Unit tests for the pure helpers | Create |
| `src/sync/googleSync.js` | Broker sign-in / exchange / refresh, refresh-token persistence, fallback | Modify |
| `src/main.js` | Pass the broker path through the existing sign-in/resume handlers | Modify |

The Worker lives in the repo but deploys separately; its pure helpers are tested by the
same vitest run. Tests use the existing `tests/` config, so `worker/broker.test.js` is
picked up by `vitest`.

---

### Task 1: Worker pure helpers

**Files:**
- Create: `worker/broker.js`
- Test: `worker/broker.test.js`

**Interfaces:**
- Produces:
  - `corsHeaders(origin: string, allowed: string)` → `object | null` (null when origin ≠ allowed)
  - `validateBody(body: any, required: string[])` → `boolean`
  - `mapGoogleToken(json: any, nowMs: number)` → `null | { accessToken, expiresAt, refreshToken }`
  - `jsonResponse(bodyObj, status, cors)` → `Response`

- [ ] **Step 1: Write the failing tests**

Create `worker/broker.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { corsHeaders, validateBody, mapGoogleToken } from './broker.js';

describe('corsHeaders', () => {
  it('returns headers only for the allowed origin', () => {
    const h = corsHeaders('https://app.example', 'https://app.example');
    expect(h['Access-Control-Allow-Origin']).toBe('https://app.example');
  });
  it('returns null for any other origin', () => {
    expect(corsHeaders('https://evil.example', 'https://app.example')).toBeNull();
    expect(corsHeaders(null, 'https://app.example')).toBeNull();
  });
});

describe('validateBody', () => {
  it('passes when every required key is a non-empty string', () => {
    expect(validateBody({ code: 'abc' }, ['code'])).toBe(true);
  });
  it('fails on a missing or empty key', () => {
    expect(validateBody({ code: '' }, ['code'])).toBe(false);
    expect(validateBody({}, ['code'])).toBe(false);
    expect(validateBody(null, ['code'])).toBe(false);
  });
});

describe('mapGoogleToken', () => {
  const NOW = 1_700_000_000_000;
  it('maps a Google token response to our shape', () => {
    const out = mapGoogleToken({ access_token: 'ya29', expires_in: 3600, refresh_token: 'r1' }, NOW);
    expect(out).toEqual({ accessToken: 'ya29', expiresAt: NOW + 3600_000, refreshToken: 'r1' });
  });
  it('defaults expiry and allows a missing refresh token (refresh calls omit it)', () => {
    const out = mapGoogleToken({ access_token: 'ya29' }, NOW);
    expect(out.refreshToken).toBeNull();
    expect(out.expiresAt).toBe(NOW + 3500_000);
  });
  it('returns null when there is no access token', () => {
    expect(mapGoogleToken({ error: 'invalid_grant' }, NOW)).toBeNull();
    expect(mapGoogleToken(null, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run worker/broker.test.js`
Expected: FAIL — cannot resolve `./broker.js`.

- [ ] **Step 3: Implement the helpers**

Create `worker/broker.js`:

```js
// Pure, environment-free helpers for the token-broker Worker. No fetch, no
// secrets, no state — everything here is unit-tested. The Google calls that use
// these live in index.js.

export function corsHeaders(origin, allowed) {
  if (!origin || origin !== allowed) return null;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function validateBody(body, required) {
  if (!body || typeof body !== 'object') return false;
  return required.every((k) => typeof body[k] === 'string' && body[k].length > 0);
}

export function mapGoogleToken(json, nowMs) {
  if (!json || !json.access_token) return null;
  const expiresAt = nowMs + (Number(json.expires_in) > 0 ? Number(json.expires_in) : 3500) * 1000;
  return { accessToken: json.access_token, expiresAt, refreshToken: json.refresh_token || null };
}

export function jsonResponse(bodyObj, status, cors) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run worker/broker.test.js`
Expected: PASS (9 assertions).

- [ ] **Step 5: Commit**

```bash
git add worker/broker.js worker/broker.test.js
git commit -m "Add the token-broker Worker's pure helpers"
```

---

### Task 2: Worker entry and deploy docs

**Files:**
- Create: `worker/index.js`, `worker/README.md`

**Interfaces:**
- Consumes: `corsHeaders`, `validateBody`, `mapGoogleToken`, `jsonResponse` from Task 1.
- Produces: a deployable Worker exposing `POST /exchange`, `POST /token`, `POST /revoke`.

This task has no unit test — it is fetch/Google integration, verified by the user against
their account after deploy (Task 6). The pure logic it relies on is already tested.

- [ ] **Step 1: Write the Worker entry**

Create `worker/index.js`:

```js
import { corsHeaders, validateBody, mapGoogleToken, jsonResponse } from './broker.js';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

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
    return jsonResponse({ error: 'not-found' }, 404, cors);
  },
};

// code + client secret -> access + refresh token, plus the account email
async function exchange(body, env, cors) {
  if (!validateBody(body, ['code'])) return jsonResponse({ error: 'bad-body' }, 400, cors);
  const params = new URLSearchParams({
    code: body.code,
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    redirect_uri: env.ALLOWED_ORIGIN + '/',
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
```

- [ ] **Step 2: Write the deploy README**

Create `worker/README.md`:

```markdown
# Sets token-broker Worker

Stateless. Keeps Google sync alive past the 1-hour token expiry. Stores nothing.

## One-time deploy (Cloudflare, free)

1. Create a free account at cloudflare.com → **Workers & Pages** → **Create Worker**.
2. In the editor, replace the default code with the contents of `index.js` and
   `broker.js` (paste `broker.js` above `index.js`, or use `wrangler` with both files).
3. **Settings → Variables** — add three plaintext variables:
   - `CLIENT_ID` = `515660891133-63v7l803od2cee981sineagm6snl3kfb.apps.googleusercontent.com`
   - `CLIENT_SECRET` = (from Google Cloud Console → Credentials → the "Sets" OAuth client → client secret)
   - `ALLOWED_ORIGIN` = `https://johnpatrickmendozacdu-pixel.github.io`
4. Deploy. Copy the Worker URL (e.g. `https://sets-broker.<you>.workers.dev`).
5. In Google Cloud Console → the OAuth client → **Authorized redirect URIs**, confirm
   `https://johnpatrickmendozacdu-pixel.github.io/workout/` is listed (it already is).
6. Send the Worker URL to set `BROKER_URL` in the app.

Never touched again after this.
```

- [ ] **Step 3: Run the full suite (nothing should break)**

Run: `npm test`
Expected: PASS, count risen by the Task 1 tests (278 → 287).

- [ ] **Step 4: Commit**

```bash
git add worker/index.js worker/README.md
git commit -m "Add the token-broker Worker entry and its deploy guide"
```

---

### Task 3: App carries a refresh token, disabled by default

**Files:**
- Modify: `src/sync/googleSync.js` (near the module state at lines 11–20, `restoreSession`
  at 104–111, and a new `BROKER_URL` constant)
- Test: `tests/broker-fallback.test.js` (create)

**Interfaces:**
- Produces: `brokerConfigured()` → boolean; `restoreSession` accepts a `refreshToken` field;
  module keeps `refreshToken` in state.

The broker is **off** until `BROKER_URL` is set, so this task ships safely with zero
behaviour change.

- [ ] **Step 1: Write the failing test**

Create `tests/broker-fallback.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { brokerConfigured } from '../src/sync/googleSync.js';

describe('broker is off until configured', () => {
  it('reports not-configured when BROKER_URL is empty', () => {
    // BROKER_URL ships empty; the broker path must stay dormant.
    expect(brokerConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/broker-fallback.test.js`
Expected: FAIL — `brokerConfigured` is not exported.

- [ ] **Step 3: Add the constant, state, and accessor**

In `src/sync/googleSync.js`, after `const BACKUP_FILENAME = ...` (line 13), add:

```js
// Empty until the Cloudflare Worker is deployed and its URL is filled in here.
// While empty, every broker path below is skipped and the app uses the existing
// Google Identity Services flow — so shipping this with an empty URL changes
// nothing.
const BROKER_URL = '';

export function brokerConfigured() { return typeof BROKER_URL === 'string' && BROKER_URL.length > 0; }
```

After `let lastAuthError = null;` (line 20), add:

```js
let refreshToken = null;
```

In `restoreSession` (lines 104–111), carry the refresh token too:

```js
export function restoreSession(record) {
  if (!record || !record.token || !record.expiresAt) return false;
  if (record.expiresAt - Date.now() <= 30000) return false;
  accessToken = record.token;
  tokenExpiresAt = record.expiresAt;
  if (record.refreshToken) refreshToken = record.refreshToken;
  if (record.email) { signedInEmail = record.email; lastEmailHint = record.email; }
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (279 → 288). Nothing else changes because `BROKER_URL` is empty.

- [ ] **Step 5: Commit**

```bash
git add src/sync/googleSync.js tests/broker-fallback.test.js
git commit -m "Carry a refresh token in auth state, broker dormant until configured"
```

---

### Task 4: Broker exchange and background refresh

**Files:**
- Modify: `src/sync/googleSync.js` (add broker functions; extend `consumeRedirectResult`
  at 66–82; prefer broker in `ensureFreshToken` at 273–276)

**Interfaces:**
- Consumes: `brokerConfigured`, `BROKER_URL`, `refreshToken`, `onTokenStored`, `fetchEmail`.
- Produces: `brokerExchange(code)` → `Promise<boolean>`; `brokerRefresh()` →
  `Promise<boolean>`; `ensureFreshToken` prefers the broker.

- [ ] **Step 1: Add the broker calls**

In `src/sync/googleSync.js`, add near the other exported auth functions:

```js
/**
 * Trade an authorization code for tokens via the Worker. Stores the refresh
 * token on this device (through onTokenStored → IndexedDB). Returns false on any
 * failure, so the caller falls back to the existing flow.
 */
export async function brokerExchange(code) {
  if (!brokerConfigured() || !code) return false;
  try {
    const res = await fetchWithTimeout(BROKER_URL + '/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    if (!j.accessToken || !j.refreshToken) return false;
    accessToken = j.accessToken;
    tokenExpiresAt = j.expiresAt || (Date.now() + 3500_000);
    refreshToken = j.refreshToken;
    if (j.email) { signedInEmail = j.email; lastEmailHint = j.email; }
    if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, refreshToken, email: signedInEmail });
    return true;
  } catch (e) { return false; }
}

/**
 * Mint a fresh access token from the stored refresh token, fully in the
 * background — no redirect, no iframe. Returns false (caller falls back) when the
 * broker is off, there is no refresh token, or Google rejects it.
 */
export async function brokerRefresh() {
  if (!brokerConfigured() || !refreshToken) return false;
  try {
    const res = await fetchWithTimeout(BROKER_URL + '/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 401) { refreshToken = null; return false; } // dead token → re-auth
    if (!res.ok) return false;
    const j = await res.json();
    if (!j.accessToken) return false;
    accessToken = j.accessToken;
    tokenExpiresAt = j.expiresAt || (Date.now() + 3500_000);
    if (onTokenStored) onTokenStored({ token: accessToken, expiresAt: tokenExpiresAt, refreshToken, email: signedInEmail });
    return true;
  } catch (e) { return false; }
}
```

(Reuse the module's existing `fetchWithTimeout`/`NETWORK_TIMEOUT_MS`. If a bare `fetch`
is used elsewhere instead, match that; do not add a new helper.)

- [ ] **Step 2: Recognise a code return in `consumeRedirectResult`**

Extend `consumeRedirectResult` (lines 66–82) so it also handles the broker's `code` return.
Google returns `code`/`state` in the query string for code flow, not the hash — read both:

```js
export function consumeRedirectResult() {
  if (typeof location === 'undefined') return null;
  // Broker code flow returns ?code=&state=sets-code in the query string.
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
  return { ok: false, error: p.get('error') || 'no-token' };
}
```

- [ ] **Step 3: Prefer the broker in `ensureFreshToken`**

Replace `ensureFreshToken` (lines 273–276) with:

```js
export async function ensureFreshToken() {
  if (accessToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return true;
  // The broker keeps sync alive silently; only if it is off or fails do we fall
  // back to the iframe/redirect path Safari fights with.
  if (await brokerRefresh()) return true;
  return trySilentSignIn(lastEmailHint);
}
```

- [ ] **Step 4: Add a broker sign-in starter**

Add an exported `brokerSignIn()` that begins the code-flow redirect (used only when the
broker is configured; `main.js` chooses it in Task 5):

```js
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
```

- [ ] **Step 5: Run the suite and build**

Run: `npm test && npm run build`
Expected: tests PASS (288, unchanged — broker still dormant), build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/sync/googleSync.js
git commit -m "Add broker exchange, background refresh, and code-flow sign-in"
```

---

### Task 5: Wire the broker into main.js sign-in and resume

**Files:**
- Modify: `src/main.js` (`init` redirect consume ~line 3, `googleSignInHandler` ~473,
  `tryResumeSync` ~483/580)

**Interfaces:**
- Consumes: `gsync.brokerConfigured`, `gsync.brokerSignIn`, `gsync.brokerExchange`,
  `gsync.consumeRedirectResult` (now returns `{ pendingCode }`).

- [ ] **Step 1: Handle a returned code on launch**

In `init`, where `redirectResult = gsync.consumeRedirectResult()` runs, after it, add:

```js
  // The broker code flow returns a ?code=… on launch; trade it for tokens before
  // the first sync. Failure is silent — the app just falls back to signed-out.
  if (redirectResult && redirectResult.pendingCode) {
    await gsync.brokerExchange(redirectResult.pendingCode);
  }
```

- [ ] **Step 2: Prefer broker sign-in when configured**

In `googleSignInHandler` (~line 473), before the existing `gsync.signIn()` call, add:

```js
  // With the broker deployed, sign in through the code flow so we get a refresh
  // token and never-stale sync. Without it, the existing popup flow is unchanged.
  if (gsync.brokerConfigured()) { gsync.brokerSignIn(state.sync.email || null); return; }
```

(The redirect leaves the page; the returned code is handled by Step 1 on the way back.)

- [ ] **Step 3: Build and load the app**

Run: `npm run build`
Then open the app (dev server) and confirm it loads and renders — `main.js` and this module
have no unit coverage, so loading it is the check. Sign-in still works via the existing flow
because `BROKER_URL` is empty.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "Route sign-in and launch through the broker when it is configured"
```

---

### Task 6: User deploys the Worker, then flip it on

**Files:**
- Modify: `src/sync/googleSync.js` (`BROKER_URL` value only)

This task is a gate: the app-side is already shipped and inert. Nothing here runs until the
user has deployed the Worker per `worker/README.md`.

- [ ] **Step 1: User deploys the Worker** following `worker/README.md` and sends back the
  Worker URL. (Only the user can — it needs their Cloudflare account and the Google client
  secret.)

- [ ] **Step 2: Set `BROKER_URL`**

Put the deployed URL into `BROKER_URL` in `src/sync/googleSync.js` (no trailing slash):

```js
const BROKER_URL = 'https://sets-broker.<user>.workers.dev';
```

- [ ] **Step 3: Update the fallback test**

`tests/broker-fallback.test.js` asserts `brokerConfigured()` is false. Now it is true —
update that test to assert `true`, keeping it as a guard that the URL stays set:

```js
    expect(brokerConfigured()).toBe(true);
```

- [ ] **Step 4: Verify and deploy**

Run: `npm test && npm run build`
Expected: PASS. Then commit and push:

```bash
git add src/sync/googleSync.js tests/broker-fallback.test.js
git commit -m "Turn on the token-broker with the deployed Worker URL"
git push origin main
```

- [ ] **Step 5: End-to-end confirmation (user, on their phone)**

After Force update: sign in (a one-time consent redirect), then use the app normally.
Confirm sync survives well past an hour with **no tap and no flash**, and that signing out
and back in still works. If anything misbehaves, empty `BROKER_URL` again and redeploy —
the app returns to today's behavior instantly.

---

## Self-Review

- **Spec coverage:** stateless Worker (Tasks 1–2), on-device refresh token (Task 3),
  exchange/refresh/fallback (Task 4), sign-in wiring (Task 5), setup + flip-on (Task 6),
  graceful fallback (Tasks 3–5, `brokerConfigured` + every broker call returning false on
  error). Security trade-off is inherent to the on-device model — no code owes it. ✓
- **Placeholders:** none — every code step is complete.
- **Type consistency:** the token record shape `{ token, expiresAt, refreshToken, email }`
  is used identically in `restoreSession`, `brokerExchange`, `brokerRefresh`, and
  `consumeRedirectResult`. `brokerConfigured` spelled consistently across tasks. Worker
  helpers' names match between `broker.js`, its tests, and `index.js`.
