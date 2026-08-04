// Pure, environment-free helpers for the token-broker Worker. No fetch, no
// secrets, no state — everything here is unit-tested. The Google calls that use
// these live in index.js.

export function corsHeaders(origin, allowed) {
  // `allowed` is a comma-separated list, so the app can live at more than one
  // address at once — which is the only way to move hosts without a flag day
  // where sync breaks for everyone still on the old link.
  if (!origin) return null;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.includes(origin)) return null;
  return {
    // Echo the caller's own origin, never the whole list: a browser accepts
    // exactly one value here.
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * The redirect_uri Google will be asked to match. It has to be byte-identical
 * to the one the app used, and only the app knows its own path — so the app
 * sends it and the Worker verifies it belongs to an allowed origin. Trusting
 * it unchecked would let anyone point the exchange at their own site.
 */
export function safeRedirectUri(sent, allowed) {
  if (typeof sent !== 'string' || !sent) return null;
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.some((o) => sent.startsWith(o + '/')) ? sent : null;
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
