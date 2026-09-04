import { describe, expect, it, vi } from 'vitest';
import { loadOwnerListingDetail } from './ownerListingDetail';

const card = { id: 'listing', kind: 'setup' as const, title: 'Owner payload', sellerPersona: 'Target', trackId: 1, gameFormat: 'F1 26', priceCredits: 10, status: 'active', createdAt: '', rating: 0, reviewCount: 0, owned: true, payload: { frontWing: 5 } };

describe('loadOwnerListingDetail', () => {
  it('returns the owner payload while its request is current', async () => {
    const clear = vi.fn();
    await expect(loadOwnerListingDetail(async () => card, async () => [], () => true, clear)).resolves.toEqual({ card, similar: [] });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('discards a late owner payload after refresh or identity invalidation', async () => {
    let current = true;
    const clear = vi.fn();
    const lateCard = Promise.resolve(card).then((value) => { current = false; return value; });
    await expect(loadOwnerListingDetail(() => lateCard, async () => [], () => current, clear)).resolves.toBeNull();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears again for a current error but never for a stale error', async () => {
    const currentClear = vi.fn();
    await expect(loadOwnerListingDetail(async () => { throw new Error('403'); }, async () => [], () => true, currentClear)).rejects.toThrow('403');
    expect(currentClear).toHaveBeenCalledTimes(2);

    const staleClear = vi.fn();
    await expect(loadOwnerListingDetail(async () => { throw new Error('401'); }, async () => [], () => false, staleClear)).resolves.toBeNull();
    expect(staleClear).toHaveBeenCalledTimes(1);
  });
});
