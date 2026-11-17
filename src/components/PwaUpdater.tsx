// Detects a new app version. AppShell shows the reload banner, never during an in-progress capture.

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAppStore } from '../stores/appStore';

export function PwaUpdater() {
  const set = useAppStore((s) => s.set);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version every hour while the app is open.
      if (registration) setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    set({ updateReady: needRefresh, applyUpdate: needRefresh ? () => void updateServiceWorker(true) : null });
  }, [needRefresh, set, updateServiceWorker]);

  return null;
}
