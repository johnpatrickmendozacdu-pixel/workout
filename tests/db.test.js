import { describe, it, expect } from 'vitest';
import { namespaceFor, getItem, setItem, removeItem } from '../src/db/db.js';

describe('namespaceFor — whose dataset a key belongs to', () => {
  it('uses the unprefixed keys when signed out', () => {
    expect(namespaceFor(null, null)).toBe('');
    expect(namespaceFor(null, 'a@x.com')).toBe('');
  });

  it('lets the first account keep the data already on the device', () => {
    // Nobody has claimed yet: the account signing in adopts the existing keys
    // rather than being migrated into a namespace of its own.
    expect(namespaceFor('a@x.com', null)).toBe('');
  });

  it('keeps the claiming account on the unprefixed keys forever after', () => {
    expect(namespaceFor('a@x.com', 'a@x.com')).toBe('');
  });

  it('gives any other account its own namespace', () => {
    expect(namespaceFor('b@x.com', 'a@x.com')).toBe('u:b@x.com:');
  });

  it('never returns the same namespace for two different accounts', () => {
    const owner = namespaceFor('a@x.com', 'a@x.com');
    const guest = namespaceFor('b@x.com', 'a@x.com');
    const third = namespaceFor('c@x.com', 'a@x.com');
    expect(new Set([owner, guest, third]).size).toBe(3);
  });
});

describe('db storage operations', () => {
  it('removes a stored key', async () => {
    await setItem('gone-soon', { a: 1 });
    expect(await getItem('gone-soon')).toEqual({ a: 1 });
    await removeItem('gone-soon');
    expect(await getItem('gone-soon')).toBeUndefined();
  });

  it('resolves rather than throwing when the key was never there', async () => {
    await expect(removeItem('never-existed')).resolves.toBe(true);
  });
});
