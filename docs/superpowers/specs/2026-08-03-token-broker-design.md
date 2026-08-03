# Never-stale sync: a token-broker Worker

Date: 2026-08-03

## Problem

Google hands a browser app an access token that lasts ~1 hour and offers no way to renew
it silently on iOS — Safari blocks the hidden-iframe path every other platform uses. So
sync goes quiet an hour after sign-in until the user taps, or the app does a full-page
redirect to renew (the "flash"). The fix Google intends for this is a **refresh token**,
which a browser cannot hold safely and which requires a server-side exchange.

## The idea, plainly

A tiny always-free serverless **Cloudflare Worker** sits between the app and Google. It
holds each user's refresh token (in Cloudflare KV) and, on request, quietly mints a fresh
1-hour access token. The app calls it in the background whenever its token is about to
expire — no redirect, no iframe, no tap. Sync just stays alive.

**The Worker only ever touches OAuth tokens. Workout data never passes through it** — the
app still talks to Google Drive directly with the access token, exactly as today. So there
is no data-migration and no data-loss surface.

## Guard rails, and how each is met

- **100% free:** Cloudflare Workers free tier = 100k requests/day; KV = 100k reads/day,
  1k writes/day, 1GB. A family will not approach this. No card, no trial.
- **One-time setup:** create a free Cloudflare account, deploy the Worker once, add one
  Google Console redirect URI and copy the client secret in once. Then never touched.
- **Zero maintenance (of what we control):** the Worker is serverless — Cloudflare runs and
  patches it. The only upkeep is Google-side and rare (a refresh token revoked after ~6
  months idle, a password change, or a user revoking access), which **self-heals**: the app
  falls back to a normal sign-in.
- **Cannot break the app:** the broker is an *enhancement layer*. If the Worker is
  unreachable, the sessionId is missing, or anything errors, `googleSync.js` falls straight
  back to today's Google Identity Services flow — the app works offline and syncs on tap,
  exactly as now. The broker can only add reliability.

## Architecture

Two deliverables, cleanly separated:

1. **The Worker** (`worker/` — its own tiny project, deployed to Cloudflare).
2. **App changes** (`src/sync/googleSync.js` — a preferred broker path with the existing
   flow kept as fallback).

### Auth flow (authorization-code with refresh, replacing implicit as the *preferred* path)

**First sign-in (once, includes a redirect — the only redirect that remains):**
1. App redirects to Google's auth endpoint with `response_type=code`,
   `access_type=offline`, `prompt=consent`, `scope=drive.appdata`, `state=<random>`,
   `redirect_uri=<app URL>`.
2. Google returns to the app URL with `?code=…&state=…`. App verifies `state`, reads `code`.
3. App POSTs `{ code }` to the Worker's `/exchange`.
4. Worker exchanges `code` + `CLIENT_SECRET` with Google → `{ access_token, refresh_token,
   expires_in }`. It stores the **refresh token in KV** under a fresh random `sessionId`,
   and returns `{ sessionId, accessToken, expiresAt, email }`.
5. App stores `sessionId` in **IndexedDB** (a bearer value, not a cookie — this sidesteps
   the Safari/iOS cookie fragility that caused the original problem) and uses the access
   token immediately.

**Silent refresh (every time after, fully background — the whole point):**
1. When the access token is within the refresh margin, the app POSTs `{ sessionId }` to the
   Worker's `/token`.
2. Worker looks up the refresh token in KV, calls Google's token endpoint with it, returns
   a fresh `{ accessToken, expiresAt }`.
3. No redirect, no iframe, no user action.

**Sign-out:** app POSTs `/revoke` with `sessionId`; Worker revokes the refresh token with
Google and deletes the KV entry, then the app clears local auth as it does today.

### Worker endpoints

- `POST /exchange { code }` → `{ sessionId, accessToken, expiresAt, email }`
- `POST /token { sessionId }` → `{ accessToken, expiresAt }` (404 if session unknown →
  app falls back to interactive sign-in)
- `POST /revoke { sessionId }` → `{ ok: true }`
- CORS locked to the app origin only. All responses JSON. Secrets (`CLIENT_ID`,
  `CLIENT_SECRET`, `ALLOWED_ORIGIN`) are Worker env vars, never shipped to the browser.

### App changes (`googleSync.js`)

- Add `brokerSignIn()` (starts the code redirect), `brokerExchange(code)`,
  `brokerRefresh()` (background), pointed at a compile-time `BROKER_URL`.
- `ensureFreshToken()` prefers `brokerRefresh()` when a `sessionId` exists; on any failure
  or absence, it falls through to the existing `trySilentSignIn` / redirect path unchanged.
- `consumeRedirectResult()` learns to recognise a `code` return (broker) alongside the
  existing `token` return (fallback).
- `sessionId` persists via the existing token-listener → IndexedDB mechanism.
- Everything else — Drive upload/download, the merge, the render-guard — is untouched.

## Security trade-off (named, not buried)

Today each access token lives only in its owner's browser. The broker **centralises refresh
tokens** in the Worker's KV. If the Worker or its KV were compromised, an attacker could
mint access tokens to users' `drive.appdata` — the app's own hidden folder only, never the
rest of their Drive. For a family app this is low-stakes, and the `sessionId` bearer is no
more exposed than today's stored access token; but it is a real new concentration of
secrets and is stated here so the choice is made with eyes open.

## Testing

- **Worker:** pure token-shaping/validation helpers (state check, response mapping, KV
  key derivation) unit-tested. The Google exchange itself is integration-only and verified
  manually with the user's account (only they can).
- **App:** the fallback decision is pure and testable — given "no sessionId" or "broker
  error", `ensureFreshToken` chooses the legacy path. Test that it never throws and always
  degrades to the existing flow. The 278 existing tests must stay green.
- **Verify by using:** the user confirms on their phone that sync survives past an hour
  with no tap and no flash — the only true end-to-end check, and one only they can run.

## One-time setup (what the user does)

1. **Cloudflare:** create a free account → Workers & Pages → create a KV namespace → deploy
   the Worker (I provide the code; deploy via the dashboard editor or `wrangler`).
2. **Worker env vars:** paste `CLIENT_ID`, the Google **client secret**, and
   `ALLOWED_ORIGIN` (the app URL); bind the KV namespace.
3. **Google Console:** on the existing OAuth client (Web application), confirm the app URL
   is an Authorized redirect URI, and copy the **client secret** (used in step 2).
4. Tell me the deployed Worker URL; I compile it into the app as `BROKER_URL` and ship.

## Not building

- No proxying of Drive/workout data through the Worker — tokens only.
- No user database, no accounts beyond the Google identity already used.
- No removal of the existing GIS flow — it stays as the fallback that guarantees the app
  never regresses.
