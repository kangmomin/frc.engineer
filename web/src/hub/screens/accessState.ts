import type { PlatformAccountRoles } from '../data/platform';

export function viewAsEligibility(row: PlatformAccountRoles, selfAccountId: string | null, canCreate: boolean): { eligible: boolean; reason: string } {
  if (!canCreate) return { eligible: false, reason: '권한 없음' };
  if (row.id === selfAccountId) return { eligible: false, reason: '본인 계정' };
  if (row.kind !== 'user') return { eligible: false, reason: '시스템 계정' };
  if (row.banned) return { eligible: false, reason: '정지된 계정' };
  return { eligible: true, reason: '' };
}
