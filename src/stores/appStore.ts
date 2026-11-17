// App-level UI state: install prompt, service-worker update, capture-in-progress flag.

import { create } from 'zustand';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface AppState {
  installEvent: BeforeInstallPromptEvent | null;
  /** True while the user is in the capture → crop → review flow; updates wait until it ends. */
  captureBusy: boolean;
  updateReady: boolean;
  applyUpdate: (() => void) | null;
  set: (patch: Partial<Omit<AppState, 'set'>>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  installEvent: null,
  captureBusy: false,
  updateReady: false,
  applyUpdate: null,
  set: (patch) => set(patch),
}));

export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useAppStore.getState().set({ installEvent: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => useAppStore.getState().set({ installEvent: null }));
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
