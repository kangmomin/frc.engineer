export function isEditablePTTTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

export function isPTTKeyDown(event: KeyboardEvent): boolean {
  return event.code === 'Space'
    && !event.repeat
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !isEditablePTTTarget(event.target);
}

export function bindPTTReleaseGuards(release: () => void): () => void {
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') release();
  };
  const onBlur = () => release();
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') release();
  };
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    release();
  };
}
