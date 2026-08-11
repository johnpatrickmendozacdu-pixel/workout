import { corsHeaders, safeRedirectUri, validateBody, mapGoogleToken, jsonResponse, GOOGLE_USERINFO } from './broker.js';
import { crewRoute } from './crew-routes.js';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

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

    // The crew endpoints share this Worker because they share its one job:
    // holding the thing a browser must not. They keep their own file, and a
    // Worker deployed without a DB binding simply answers 503 to them while
    // token broking carries on — sync must never depend on the crew.
    if (url.pathname.startsWith('/crew/')) {
      const res = await crewRoute(url.pathname, body, env, cors);
      if (res) return res;
    }
    return jsonResponse({ error: 'not-found' }, 404, cors);
  },
};

// code + client secret -> access + refresh token, plus the account email
async function exchange(body, env, cors) {
  if (!validateBody(body, ['code'])) return jsonResponse({ error: 'bad-body' }, 400, cors);
  const redirectUri = safeRedirectUri(body.redirectUri, env.ALLOWED_ORIGIN);
  if (!redirectUri) return jsonResponse({ error: 'bad-redirect' }, 400, cors);
  const params = new URLSearchParams({
    code: body.code,
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    redirect_uri: redirectUri,
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
