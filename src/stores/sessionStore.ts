import { create } from 'zustand';
import type { User } from 'firebase/auth';
import type { Preferences, Space, UserProfile } from '../data/types';
import { DEFAULT_TEMPLATE_ID } from '../lib/templates/builtins';

export const DEFAULT_PREFS: Preferences = {
  theme: 'light',
  ocrLanguages: ['eng'],
  ocrEnabled: true,
  captureQuality: 'medium',
  compressionTarget: 0.8,
  defaultTemplateId: DEFAULT_TEMPLATE_ID,
  dateFormat: 'iso',
  timeFormat24h: true,
  locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
  textScale: 1,
  captureLocationConsent: false,
  analyticsOptOut: false,
  onboardingDone: false,
  showGrid: true,
  autoDetect: true,
};

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  prefs: Preferences;
  prefsLoaded: boolean;
  spaceId: string | null;
  spaces: Space[];
  set: (patch: Partial<Omit<SessionState, 'set'>>) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  profile: null,
  prefs: DEFAULT_PREFS,
  prefsLoaded: false,
  spaceId: null,
  spaces: [],
  set: (patch) => set(patch),
}));

/** The signed-in user's id and active Space. Only call inside authenticated routes. */
export function useAuthed(): { uid: string; spaceId: string; user: User } {
  const user = useSession((s) => s.user);
  const spaceId = useSession((s) => s.spaceId);
  if (!user || !spaceId) throw new Error('useAuthed outside an authenticated route');
  return { uid: user.uid, spaceId, user };
}
