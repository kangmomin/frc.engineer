// Owner-scoped rows must disappear as soon as a refresh begins and stay gone
// when it fails. This prevents a revoked identity/permission from leaving the
// previous private payload visible behind an error message.
export async function refreshPrivateRows<T>(
  load: () => Promise<T[]>,
  setRows: (rows: T[] | null) => void,
  setError: (message: string) => void,
  errorMessage: (error: unknown) => string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  setRows(null);
  setError('');
  try {
    const rows = await load();
    if (isCurrent()) setRows(rows);
  } catch (error: unknown) {
    if (!isCurrent()) return;
    setRows([]);
    setError(errorMessage(error));
  }
}
