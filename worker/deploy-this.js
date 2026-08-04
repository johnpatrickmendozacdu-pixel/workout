// ============================================================================
//  Sets token-broker — paste this WHOLE file into the Cloudflare Worker editor.
//  Stateless: it stores nothing. It only swaps Google login tokens on demand.
// ============================================================================

function corsHeaders(origin, allowed) {
  // ALLOWED_ORIGIN is a comma-separated list, so the app can live at more than
  // one address at once — the only way to change hosts without a flag day.
  if (!origin) return null;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// Only the app knows its own path, so it sends its redirect_uri and this checks
// the address belongs to us. Trusting it unchecked would let anyone point the
// exchange at their own site.
function safeRedirectUri(sent, allowed) {
  if (typeof sent !== 'string' || !sent) return null;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.some((o) => sent.startsWith(o + '/')) ? sent : null;
}

function validateBody(body, required) {
  if (!body || typeof body !== 'object') return false;
  return required.every((k) => typeof body[k] === 'string' && body[k].length > 0);
}

function mapGoogleToken(json, nowMs) {
  if (!json || !json.access_token) return null;
  const expiresAt = nowMs + (Number(json.expires_in) > 0 ? Number(json.expires_in) : 3500) * 1000;
  return { accessToken: json.access_token, expiresAt, refreshToken: json.refresh_token || null };
}

function jsonResponse(bodyObj, status, cors) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}

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
  if (!mapped) return jsonResponse({ error: 'refresh-failed' }, 401, cors);
  return jsonResponse({ accessToken: mapped.accessToken, expiresAt: mapped.expiresAt }, 200, cors);
}

async function revoke(body, env, cors) {
  if (!validateBody(body, ['refreshToken'])) return jsonResponse({ error: 'bad-body' }, 400, cors);
  try { await fetch(GOOGLE_REVOKE + '?token=' + encodeURIComponent(body.refreshToken), { method: 'POST' }); } catch { /* best effort */ }
  return jsonResponse({ ok: true }, 200, cors);
}
