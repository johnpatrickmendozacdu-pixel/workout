import { describe, it, expect } from 'vitest';
import { corsHeaders, validateBody, mapGoogleToken } from '../worker/broker.js';

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
  it('defaults expiry and allows a missing refresh token', () => {
    const out = mapGoogleToken({ access_token: 'ya29' }, NOW);
    expect(out.refreshToken).toBeNull();
    expect(out.expiresAt).toBe(NOW + 3500_000);
  });
  it('returns null when there is no access token', () => {
    expect(mapGoogleToken({ error: 'invalid_grant' }, NOW)).toBeNull();
    expect(mapGoogleToken(null, NOW)).toBeNull();
  });
});
