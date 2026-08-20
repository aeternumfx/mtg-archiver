import { useSyncExternalStore } from 'react';

// Tracks whether the admin instance setup wizard is currently visible. When it
// is, other modals (e.g. the per-user "set your password" dialog) are suppressed
// so the two don't stack during first-time setup.
let instanceSetupVisible = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setInstanceSetupVisible(v: boolean) {
  if (instanceSetupVisible === v) return;
  instanceSetupVisible = v;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useInstanceSetupVisible(): boolean {
  return useSyncExternalStore(subscribe, () => instanceSetupVisible);
}
