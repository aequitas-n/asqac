const recoveryKey = 'asqac-asset-recovery-at';

export function claimAssetRecovery(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now = Date.now(),
) {
  try {
    const previous = Number(storage.getItem(recoveryKey));
    if (previous && now - previous >= 0 && now - previous < 120_000) return false;
    storage.setItem(recoveryKey, String(now));
    return true;
  } catch {
    return false;
  } // No automatic reload if a loop guard cannot be saved.
}

export function installAssetRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    if (!navigator.onLine) return;
    try {
      if (!claimAssetRecovery(window.sessionStorage)) return;
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}

export function watchContextLoss(canvas: EventTarget, lost: () => void) {
  const onLoss = (event: Event) => {
    event.preventDefault();
    lost();
  };
  canvas.addEventListener('webglcontextlost', onLoss);
  return () => canvas.removeEventListener('webglcontextlost', onLoss);
}
