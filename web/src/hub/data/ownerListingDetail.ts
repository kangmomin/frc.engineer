import type { PlatformListingCard, PlatformListingDetail } from './platform';

export interface OwnerListingDetail {
  card: PlatformListingDetail;
  similar: PlatformListingCard[];
}

export async function loadOwnerListingDetail(
  loadCard: () => Promise<PlatformListingDetail>,
  loadSimilar: () => Promise<PlatformListingCard[]>,
  isCurrent: () => boolean,
  clearDetail: () => void,
): Promise<OwnerListingDetail | null> {
  clearDetail();
  try {
    const [card, similar] = await Promise.all([loadCard(), loadSimilar()]);
    return isCurrent() ? { card, similar } : null;
  } catch (error: unknown) {
    if (isCurrent()) {
      clearDetail();
      throw error;
    }
    return null;
  }
}
