import { describe, it, expect } from 'vitest';
import { corsHeaders, safeRedirectUri, validateBody, mapGoogleToken } from '../worker/broker.js';

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

describe('more than one allowed origin', () => {
  const both = 'https://old.example,https://new.example';

  it('lets either address through, echoing the caller back', () => {
    expect(corsHeaders('https://old.example', both)['Access-Control-Allow-Origin']).toBe('https://old.example');
    expect(corsHeaders('https://new.example', both)['Access-Control-Allow-Origin']).toBe('https://new.example');
  });

  it('still refuses anyone else', () => {
    expect(corsHeaders('https://evil.example', both)).toBeNull();
  });

  it('never echoes the whole list — a browser accepts exactly one value', () => {
    expect(corsHeaders('https://old.example', both)['Access-Control-Allow-Origin']).not.toContain(',');
  });
});

describe('safeRedirectUri', () => {
  const both = 'https://old.example,https://new.example';

  it('accepts a redirect under an allowed origin', () => {
    expect(safeRedirectUri('https://new.example/', both)).toBe('https://new.example/');
    expect(safeRedirectUri('https://old.example/workout/', both)).toBe('https://old.example/workout/');
  });

  it('refuses somebody else\'s site', () => {
    expect(safeRedirectUri('https://evil.example/', both)).toBeNull();
  });

  it('refuses a lookalike that only starts the same', () => {
    expect(safeRedirectUri('https://new.example.evil.com/', both)).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(safeRedirectUri('', both)).toBeNull();
    expect(safeRedirectUri(undefined, both)).toBeNull();
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
