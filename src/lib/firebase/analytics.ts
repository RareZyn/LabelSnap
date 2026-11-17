// Anonymous usage counts only. No image content, OCR text, caption or email is ever sent.

import type { Analytics } from 'firebase/analytics';
import { app } from './app';

export type CountEvent = 'capture' | 'ocr_run' | 'export' | 'sync_failure' | 'import';

let analytics: Analytics | null = null;
let optedOut = false;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  const mod = await import('firebase/analytics');
  if (!(await mod.isSupported())) return;
  analytics = mod.getAnalytics(app);
  mod.setAnalyticsCollectionEnabled(analytics, !optedOut);
}

export function initAnalytics(): void {
  if (!loading) loading = load().catch(() => undefined);
}

export async function setAnalyticsOptOut(value: boolean): Promise<void> {
  optedOut = value;
  if (!analytics) return;
  const mod = await import('firebase/analytics');
  mod.setAnalyticsCollectionEnabled(analytics, !value);
}

export function countEvent(name: CountEvent, params?: Record<string, number | string>): void {
  if (optedOut) return;
  void (async () => {
    await loading;
    if (!analytics || optedOut) return;
    const mod = await import('firebase/analytics');
    mod.logEvent(analytics, name, params);
  })();
}
