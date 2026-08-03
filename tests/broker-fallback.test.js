import { describe, it, expect } from 'vitest';
import { brokerConfigured } from '../src/sync/googleSync.js';

describe('broker is off until configured', () => {
  it('reports not-configured while BROKER_URL is empty', () => {
    // BROKER_URL ships empty; the broker path must stay dormant so nothing regresses.
    expect(brokerConfigured()).toBe(false);
  });
});
