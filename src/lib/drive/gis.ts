// Google Identity Services token client for Drive access (scope drive.file: only files LabelSnap creates).
// requestAccessToken must run synchronously inside a user gesture, or browsers block the consent popup,
// so the GIS script is preloaded at start-up and connect() never awaits before requesting.

import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from '../../config';
import { useDriveStore } from '../../stores/driveStore';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

const TOKEN_KEY = 'ls.driveToken';
const CONNECTED_KEY = 'ls.driveConnected';
const EMAIL_KEY = 'ls.driveEmail';
const MARGIN_MS = 60_000;

interface StoredToken {
  value: string;
  expiresAt: number;
}

let scriptPromise: Promise<void> | null = null;
let client: TokenClient | null = null;
let waiter: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

let token: StoredToken | null = readToken();

export const isDriveConfigured = () => Boolean(GOOGLE_CLIENT_ID);

export function hasConnectedBefore(): boolean {
  try {
    return localStorage.getItem(CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function driveAccountEmail(): string | undefined {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberDriveEmail(email: string | undefined): void {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* storage unavailable */
  }
  useDriveStore.getState().setEmail(email);
}

/** A valid access token, or null if none is cached or it is about to expire. */
export function getCachedToken(): string | null {
  if (token && token.expiresAt - MARGIN_MS > Date.now()) return token.value;
  return null;
}

export function clearToken(): void {
  token = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  refreshStatus();
}

export function refreshStatus(): void {
  const store = useDriveStore.getState();
  if (!isDriveConfigured()) return store.setStatus('unconfigured');
  if (getCachedToken()) {
    store.setStatus('connected');
    scheduleExpiry();
  } else store.setStatus(hasConnectedBefore() ? 'expired' : 'disconnected');
}

function scheduleExpiry(): void {
  clearTimeout(expiryTimer);
  if (!token) return;
  const ms = token.expiresAt - MARGIN_MS - Date.now();
  if (ms > 0) expiryTimer = setTimeout(refreshStatus, Math.min(ms + 1000, 2 ** 31 - 1));
}

function saveToken(r: TokenResponse): string {
  const value = r.access_token!;
  token = { value, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    localStorage.setItem(CONNECTED_KEY, '1');
  } catch {
    /* storage unavailable */
  }
  refreshStatus();
  return value;
}

export function loadGis(): Promise<void> {
  if (!isDriveConfigured()) return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('gis-load-failed'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function ensureClient(): TokenClient | null {
  if (client) return client;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2 || !isDriveConfigured()) return null;
  client = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (r) => {
      const w = waiter;
      waiter = null;
      if (r.error || !r.access_token) w?.reject(new Error(r.error_description || r.error || 'drive-auth-failed'));
      else w?.resolve(saveToken(r));
    },
    error_callback: (e) => {
      const w = waiter;
      waiter = null;
      w?.reject(new Error(e.type || 'drive-auth-failed'));
    },
  });
  return client;
}

/**
 * Requests a Drive token. Call directly from a click handler: the popup is opened synchronously.
 * `prompt: ''` re-uses an existing grant (usually closes by itself); 'consent' forces the consent screen.
 */
export function connectDrive(prompt: '' | 'consent' | 'select_account' = ''): Promise<string> {
  const c = ensureClient();
  if (!c) return Promise.reject(new Error(isDriveConfigured() ? 'gis-not-ready' : 'drive-unconfigured'));
  waiter?.reject(new Error('superseded'));
  const p = new Promise<string>((resolve, reject) => {
    waiter = { resolve, reject };
  });
  c.requestAccessToken({ prompt: hasConnectedBefore() ? prompt : 'consent', login_hint: driveAccountEmail() });
  return p;
}

export function disconnectDrive(): void {
  const t = token?.value;
  clearToken();
  try {
    localStorage.removeItem(CONNECTED_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* storage unavailable */
  }
  useDriveStore.getState().setEmail(undefined);
  if (t) window.google?.accounts?.oauth2?.revoke(t, () => undefined);
  refreshStatus();
}
