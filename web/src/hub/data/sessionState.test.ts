import { describe, expect, it } from 'vitest';
import { isCurrentSessionSnapshot, isParentStorageChange, parentRevalidationFailureAction, resolveBootstrapIdentity, sessionSubtreeKey, sessionUnauthorizedAction, viewAsEntryFailureAction } from './sessionState';
import type { PlatformAccount } from './session';

describe('session identity guards', () => {
  it('rejects stale A to B child callbacks even if the epoch was captured', () => {
    const a = { childToken: 'child-a', epoch: 4 };
    expect(isCurrentSessionSnapshot(a, 'child-b', 4)).toBe(false);
    expect(isCurrentSessionSnapshot(a, 'child-a', 5)).toBe(false);
    expect(isCurrentSessionSnapshot(a, 'child-a', 4)).toBe(true);
  });

  it('changes the authenticated subtree key for mode, owner, and epoch', () => {
    expect(sessionSubtreeKey('normal', 'actor', 1)).toBe('normal:actor:1');
    expect(sessionSubtreeKey('view-as', 'subject', 2)).toBe('view-as:subject:2');
  });

  it('falls back to the parent unless child /me names that exact actor', () => {
    const actor: PlatformAccount = { id: 'actor', steamId64: '1', persona: 'Admin', avatarUrl: '', kind: 'user', verified: true, banned: false, createdAt: '' };
    const child: PlatformAccount = { ...actor, id: 'subject', persona: 'Target', viewAs: { sessionId: 's', actor: { id: 'actor', persona: 'Admin' }, expiresAt: '2026-09-04T12:00:00Z' } };
    expect(resolveBootstrapIdentity(actor, child).mode).toBe('view-as');
    expect(resolveBootstrapIdentity(actor, { ...child, viewAs: { ...child.viewAs!, actor: { id: 'other', persona: 'Other' } } })).toEqual({ mode: 'normal', account: actor });
    expect(resolveBootstrapIdentity(actor, null)).toEqual({ mode: 'normal', account: actor });
  });

  it('cannot turn a duplicate child 401 callback into a parent logout', () => {
    expect(sessionUnauthorizedAction('child', 'parent', 'child')).toBe('recover-child');
    // Recovery removed the child before a stale screen callback runs. The old
    // child token matches neither the still-preserved parent nor active child.
    expect(sessionUnauthorizedAction('child', 'parent', null)).toBe('ignore');
    expect(sessionUnauthorizedAction('parent', 'parent', null)).toBe('clear-parent');

    const actor: PlatformAccount = { id: 'actor', steamId64: '1', persona: 'Admin', avatarUrl: '', kind: 'user', verified: true, banned: false, createdAt: '' };
    const recovered = resolveBootstrapIdentity(actor, null);
    expect(recovered).toEqual({ mode: 'normal', account: actor });
  });

  it('treats localStorage.clear as a parent-session storage change', () => {
    expect(isParentStorageChange('pitwall.platformToken')).toBe(true);
    expect(isParentStorageChange(null)).toBe(true);
    expect(isParentStorageChange('unrelated')).toBe(false);
  });

  it('logs out only for a parent-authenticated start 401, never a child validation 401', () => {
    expect(viewAsEntryFailureAction('start-with-parent', 401)).toBe('logout-parent');
    expect(viewAsEntryFailureAction('start-with-parent', 403)).toBe('keep-parent');
    expect(viewAsEntryFailureAction('validate-child', 401)).toBe('recover-parent');
    expect(viewAsEntryFailureAction('validate-child', null)).toBe('clear-child');
  });

  it('revalidates the parent when it disappears or is revoked between start and child /me', () => {
    // Parent delete/expiry, actor ban, and view-as permission revocation all
    // invalidate the newly-created child as 401 at the same contract boundary.
    expect(viewAsEntryFailureAction('validate-child', 401)).toBe('recover-parent');
    expect(parentRevalidationFailureAction(401)).toBe('clear-parent');
    expect(parentRevalidationFailureAction(503)).toBe('keep-parent');

    const actor: PlatformAccount = { id: 'actor', steamId64: '1', persona: 'Admin', avatarUrl: '', kind: 'user', verified: true, banned: false, createdAt: '' };
    expect(resolveBootstrapIdentity(actor, null)).toEqual({ mode: 'normal', account: actor });
  });
});
