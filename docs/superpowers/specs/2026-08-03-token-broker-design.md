# Never-stale sync: a token-broker Worker

Date: 2026-08-03

## Problem

Google hands a browser app an access token that lasts ~1 hour and offers no way to renew
it silently on iOS — Safari blocks the hidden-iframe path every other platform uses. So
sync goes quiet an hour after sign-in until the user taps, or the app does a full-page
redirect to renew (the "flash"). The fix Google intends for this is a **refresh token**,
which a browser cannot hold safely and which requires a server-side exchange.

## The idea, plainly

A tiny always-free serverless **Cloudflare Worker** sits between the app and Google. It is
**stateless** — it stores nothing. Each user's refresh token lives on their own device; the
app hands it to the Worker only when it needs a fresh 1-hour access token, and the Worker
does the exchange with Google and forgets it. The app calls this in the background whenever
its token is about to expire — no redirect, no iframe, no tap. Sync just stays alive.

**The Worker only ever touches OAuth tokens. Workout data never passes through it** — the
app still talks to Google Drive directly with the access token, exactly as today. So there
is no data-migration and no data-loss surface.

## Guard rails, and how each is met

- **100% free:** Cloudflare Workers free tier = 100k requests/day. A family will not
  approach this, and the stateless design needs no KV or storage at all. No card, no trial.
- **One-time setup:** create a free Cloudflare account, deploy the Worker once, add one
  Google Console redirect URI and copy the client secret in once. Then never touched.
- **Zero maintenance (of what we control):** the Worker is serverless — Cloudflare runs and
  patches it. The only upkeep is Google-side and rare (a refresh token revoked after ~6
  months idle, a password change, or a user revoking access), which **self-heals**: the app
  falls back to a normal sign-in.
- **Cannot break the app:** the broker is an *enhancement layer*. If the Worker is
  unreachable, the refresh token is missing, or anything errors, `googleSync.js` falls straight
  back to today's Google Identity Services flow — the app works offline and syncs on tap,
  exactly as now. The broker can only add reliability.

## Architecture

Two deliverables, cleanly separated:

1. **The Worker** (`worker/` — its own tiny project, deployed to Cloudflare). **Stateless:
   no KV, no stored user tokens.** It holds only the Google client secret (an env var) and
   brokers token exchanges on demand.
2. **App changes** (`src/sync/googleSync.js` — a preferred broker path with the existing
   flow kept as fallback).

### On-device model

The refresh token stays on the owner's device — in the app's IndexedDB, beside the access
token already stored there — and is **never kept by the Worker**. Since everyone uses their
own phone, each person's refresh token lives only where they are, so there is no central
store of secrets to breach. The Worker sees a refresh token only in transit, for the
milliseconds it takes to exchange it, and remembers nothing.

### Auth flow (authorization-code with refresh, replacing implicit as the *preferred* path)

**First sign-in (once, includes a redirect — the only redirect that remains):**
1. App redirects to Google's auth endpoint with `response_type=code`,
   `access_type=offline`, `prompt=consent`, `scope=drive.appdata`, `state=<random>`,
   `redirect_uri=<app URL>`.
2. Google returns to the app URL with `?code=…&state=…`. App verifies `state`, reads `code`.
3. App POSTs `{ code }` to the Worker's `/exchange`.
4. Worker exchanges `code` + `CLIENT_SECRET` with Google → `{ access_token, refresh_token,
   expires_in }` and returns all three to the app. **It stores nothing.**
5. App stores the **refresh token** and access token in **IndexedDB** (bearer values, not
   cookies — this sidesteps the Safari/iOS cookie fragility that caused the original
   problem) and uses the access token immediately.

**Silent refresh (every time after, fully background — the whole point):**
1. When the access token is within the refresh margin, the app POSTs
   `{ refreshToken }` to the Worker's `/token`.
2. Worker calls Google's token endpoint with it + `CLIENT_SECRET`, returns a fresh
   `{ accessToken, expiresAt }`, and forgets the refresh token.
3. No redirect, no iframe, no user action.

**Sign-out:** app POSTs `/revoke` with its `refreshToken`; Worker asks Google to revoke it;
the app deletes it from IndexedDB and clears local auth as it does today.

### Worker endpoints

- `POST /exchange { code }` → `{ refreshToken, accessToken, expiresAt, email }`
- `POST /token { refreshToken }` → `{ accessToken, expiresAt }` (a Google `invalid_grant`
  → 401, on which the app drops the dead refresh token and falls back to interactive
  sign-in)
- `POST /revoke { refreshToken }` → `{ ok: true }`
- CORS locked to the app origin only. All responses JSON. Secrets (`CLIENT_ID`,
  `CLIENT_SECRET`, `ALLOWED_ORIGIN`) are Worker env vars, never shipped to the browser.
- Stateless: no KV binding, no persistence of any kind.

### App changes (`googleSync.js`)

- Add `brokerSignIn()` (starts the code redirect), `brokerExchange(code)`,
  `brokerRefresh()` (background), pointed at a compile-time `BROKER_URL`.
- `ensureFreshToken()` prefers `brokerRefresh()` when a `refreshToken` exists; on any
  failure or absence, it falls through to the existing `trySilentSignIn` / redirect path
  unchanged.
- `consumeRedirectResult()` learns to recognise a `code` return (broker) alongside the
  existing `token` return (fallback).
- The stored token record gains a `refreshToken` field, persisted via the existing
  token-listener → IndexedDB mechanism.
- Everything else — Drive upload/download, the merge, the render-guard — is untouched.

## Security trade-off (named, not buried)

The on-device model has **no central store** — each person's refresh token lives only in
their own device's IndexedDB, and the Worker keeps nothing. The residual trade-off is only
this: a refresh token is longer-lived than an access token, so the value sitting in a
device's storage is a slightly larger secret than before. It never leaves that device
except in transit to the Worker to be exchanged, and it still only ever reaches the app's
own hidden `drive.appdata` folder — never the rest of the user's Drive, email, or anything
else. On a personal phone this is the same threat surface as today's stored access token,
just longer-lived.

## Testing

- **Worker:** pure token-shaping/validation helpers (CORS/origin check, request-body
  validation, Google response mapping) unit-tested. The Google exchange itself is
  integration-only and verified manually with the user's account (only they can).
- **App:** the fallback decision is pure and testable — given "no refresh token" or "broker
  error", `ensureFreshToken` chooses the legacy path. Test that it never throws and always
  degrades to the existing flow. The 278 existing tests must stay green.
- **Verify by using:** the user confirms on their phone that sync survives past an hour
  with no tap and no flash — the only true end-to-end check, and one only they can run.

## One-time setup (what the user does)

1. **Cloudflare:** create a free account → Workers & Pages → deploy the Worker (I provide
   the code; deploy via the dashboard editor or `wrangler`). No KV, no storage to set up.
2. **Worker env vars:** paste `CLIENT_ID`, the Google **client secret**, and
   `ALLOWED_ORIGIN` (the app URL).
3. **Google Console:** on the existing OAuth client (Web application), confirm the app URL
   is an Authorized redirect URI, and copy the **client secret** (used in step 2).
4. Tell me the deployed Worker URL; I compile it into the app as `BROKER_URL` and ship.

## Not building

- No proxying of Drive/workout data through the Worker — tokens only.
- No user database, no accounts beyond the Google identity already used.
- No removal of the existing GIS flow — it stays as the fallback that guarantees the app
  never regresses.
