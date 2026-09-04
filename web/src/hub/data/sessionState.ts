import { PARENT_TOKEN_KEY, type PlatformAccount } from './session';

export interface SessionSnapshot {
  childToken: string | null;
  epoch: number;
}

export function isCurrentSessionSnapshot(snapshot: SessionSnapshot, childToken: string | null, epoch: number): boolean {
  return snapshot.childToken === childToken && snapshot.epoch === epoch;
}

export function sessionSubtreeKey(mode: 'normal' | 'view-as', accountId: string | null, epoch: number): string {
  return `${mode}:${accountId ?? 'anonymous'}:${epoch}`;
}

export type ResolvedSessionIdentity =
  | { mode: 'normal'; account: PlatformAccount }
  | { mode: 'view-as'; account: PlatformAccount; actor: PlatformAccount; expiresAt: string };

export function resolveBootstrapIdentity(actor: PlatformAccount, subject: PlatformAccount | null): ResolvedSessionIdentity {
  if (subject?.viewAs?.actor.id === actor.id) {
    return { mode: 'view-as', account: subject, actor, expiresAt: subject.viewAs.expiresAt };
  }
  return { mode: 'normal', account: actor };
}

export type SessionUnauthorizedAction = 'recover-child' | 'clear-parent' | 'ignore';

export function sessionUnauthorizedAction(token: string, parentToken: string | null, childToken: string | null): SessionUnauthorizedAction {
  if (childToken && token === childToken) return 'recover-child';
  if (!childToken && parentToken && token === parentToken) return 'clear-parent';
  return 'ignore';
}

export function isParentStorageChange(key: string | null): boolean {
  return key === null || key === PARENT_TOKEN_KEY;
}

export type ViewAsEntryStage = 'start-with-parent' | 'validate-child';
export type ViewAsEntryFailureAction = 'logout-parent' | 'recover-parent' | 'clear-child' | 'keep-parent';

export function viewAsEntryFailureAction(stage: ViewAsEntryStage, status: number | null): ViewAsEntryFailureAction {
  if (stage === 'start-with-parent') return status === 401 ? 'logout-parent' : 'keep-parent';
  return status === 401 ? 'recover-parent' : 'clear-child';
}

export function parentRevalidationFailureAction(status: number | null): 'clear-parent' | 'keep-parent' {
  return status === 401 ? 'clear-parent' : 'keep-parent';
}
