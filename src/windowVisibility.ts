let nativeVisible = true;
const listeners = new Set<() => void>();

export function isAppVisible() {
  return document.visibilityState !== 'hidden' && nativeVisible;
}

export function setNativeVisible(visible: boolean) {
  if (nativeVisible === visible) return;
  nativeVisible = visible;
  for (const listener of listeners) listener();
}

export function subscribeVisibility(listener: () => void) {
  listeners.add(listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('visibilitychange', listener);
  };
}
