import { describe, expect, it, vi } from 'vitest';
import { refreshPrivateRows } from './privateRows';

describe('refreshPrivateRows', () => {
  it('clears stale private rows before loading and publishes fresh rows on success', async () => {
    const setRows = vi.fn();
    const setError = vi.fn();
    await refreshPrivateRows(async () => [{ id: 'fresh' }], setRows, setError, () => 'failed');
    expect(setRows.mock.calls).toEqual([[null], [[{ id: 'fresh' }]]]);
    expect(setError).toHaveBeenCalledWith('');
  });

  it('leaves no private rows visible after a permission failure', async () => {
    const setRows = vi.fn();
    const setError = vi.fn();
    await refreshPrivateRows(async () => { throw new Error('403'); }, setRows, setError, () => '권한이 없습니다');
    expect(setRows.mock.calls).toEqual([[null], [[]]]);
    expect(setError).toHaveBeenLastCalledWith('권한이 없습니다');
  });

  it('ignores an obsolete refresh completion', async () => {
    const setRows = vi.fn();
    let current = true;
    const pending = Promise.resolve([{ id: 'old' }]).then((rows) => { current = false; return rows; });
    await refreshPrivateRows(() => pending, setRows, vi.fn(), () => 'failed', () => current);
    expect(setRows.mock.calls).toEqual([[null]]);
  });
});
