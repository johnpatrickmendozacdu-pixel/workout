import { describe, it, expect } from 'vitest';
import { brokerConfigured } from '../src/sync/googleSync.js';

describe('broker is off until configured', () => {
  it('reports configured once BROKER_URL is set', () => {
    // BROKER_URL is set to the deployed Worker; the broker path is live.
    expect(brokerConfigured()).toBe(true);
  });
});
