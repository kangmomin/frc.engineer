import { describe, expect, it } from 'vitest';
import { MockHubDataSource } from './mock';
import type { HubDataSource } from './types';

// Assigning to the interface type is itself the contract check (Fable C5):
// if MockHubDataSource drifts from HubDataSource, this file fails to compile.
const ds: HubDataSource = new MockHubDataSource();

describe('MockHubDataSource', () => {
  it('overview is the honest empty state (own data has no demo)', async () => {
    const o = await ds.getOverview();
    expect(o.recentSessions).toEqual([]);
    expect(o.verifiedSessions).toBe(0);
    expect(o.seasonBestMs).toBe(0);
  });

  it('setup market uses null price for unlisted items and precomputes review perf', async () => {
    const m = await ds.getSetupMarket();
    expect(m.setups.length).toBe(6);
    expect(m.setups.some((s) => s.priceCredits === null)).toBe(true);
    expect(m.setups[0].reviews[0].perf).toBeDefined();
  });

  it('strategy market carries raw stints and null price for unlisted', async () => {
    const s = await ds.getStrategyMarket();
    expect(s.strategies.length).toBe(6);
    expect(s.strategies.some((g) => g.priceCredits === null)).toBe(true);
    expect(s.strategies[0].stints.length).toBeGreaterThan(0);
  });
});
