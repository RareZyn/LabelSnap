// Auth state, first-sign-in bootstrap of the personal Space, and live profile/preferences.

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from '../lib/firebase/app';
import { setAnalyticsOptOut } from '../lib/firebase/analytics';
import { DEFAULT_PREFS, useSession } from '../stores/sessionStore';
import { fire, memberRef, personalSpaceId, prefsRef, spaceRef, userRef } from './refs';
import type { Preferences, Space, UserProfile } from './types';

let unsubs: Unsubscribe[] = [];

function providersOf(user: User): string[] {
  const ids = user.providerData.map((p) => p.providerId);
  return ids.length ? ids : ['password'];
}

function personalSpaceName(user: User): string {
  return user.displayName || user.email?.split('@')[0] || 'My space';
}

/** Creates the personal Space, its owner membership, the profile and preferences on first sign-in. */
async function ensureBootstrap(user: User, attempt = 0): Promise<void> {
  const uref = userRef(user.uid);
  let exists: boolean;
  try {
    // A profile written only by later merges (no defaultSpaceId) means the bootstrap never landed.
    exists = !!(await getDoc(uref)).data()?.defaultSpaceId;
  } catch {
    // The first read can fail while the connection is still starting: retry, then again when back online.
    if (attempt < 6) setTimeout(() => void ensureBootstrap(user, attempt + 1), 2000 * (attempt + 1));
    else window.addEventListener('online', () => void ensureBootstrap(user, 0), { once: true });
    return;
  }
  if (auth.currentUser?.uid !== user.uid) return;
  if (exists) {
    fire(
      updateDoc(uref, {
        lastSeenAt: serverTimestamp(),
        emailVerified: user.emailVerified,
        linkedProviders: providersOf(user),
      }),
    );
    return;
  }
  const sid = personalSpaceId(user.uid);
  const batch = writeBatch(db);
  batch.set(spaceRef(sid), {
    name: personalSpaceName(user),
    type: 'personal',
    ownerUid: user.uid,
    documentCount: 0,
    createdAt: serverTimestamp(),
  });
  batch.set(memberRef(sid, user.uid), {
    uid: user.uid,
    role: 'owner',
    displayName: user.displayName ?? '',
    joinedAt: serverTimestamp(),
  });
  batch.set(
    uref,
    {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      photoURL: user.photoURL ?? '',
      linkedProviders: providersOf(user),
      defaultSpaceId: sid,
      emailVerified: user.emailVerified,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      analyticsOptOut: false,
    },
    { merge: true },
  );
  batch.set(prefsRef(user.uid), { ...DEFAULT_PREFS, locale: navigator.language }, { merge: true });
  fire(batch.commit());
}

function applyTheme(prefs: Preferences): void {
  const root = document.documentElement;
  if (prefs.theme === 'highContrast') root.dataset.theme = 'hc';
  else delete root.dataset.theme;
  const scale = Math.min(1.5, Math.max(1, prefs.textScale || 1));
  root.style.fontSize = `${16 * scale}px`;
  try {
    localStorage.setItem('ls.theme', prefs.theme);
    localStorage.setItem('ls.textScale', String(scale));
  } catch {
    /* storage unavailable */
  }
}

function watchUser(user: User): void {
  const set = useSession.getState().set;
  const sid = personalSpaceId(user.uid);
  unsubs.push(
    onSnapshot(
      userRef(user.uid),
      (snap) => set({ profile: snap.exists() ? (snap.data() as UserProfile) : null }),
      () => undefined,
    ),
    onSnapshot(
      prefsRef(user.uid),
      (snap) => {
        const prefs = { ...DEFAULT_PREFS, ...(snap.data() as Partial<Preferences> | undefined) };
        set({ prefs, prefsLoaded: true });
        applyTheme(prefs);
        void setAnalyticsOptOut(prefs.analyticsOptOut);
      },
      () => set({ prefsLoaded: true }),
    ),
  );
  // The Space listener is rejected until the first-sign-in bootstrap reaches the server: retry briefly.
  let attempt = 0;
  const watchSpace = () => {
    const unsub = onSnapshot(
      spaceRef(sid),
      (snap) => {
        if (snap.exists()) set({ spaces: [{ id: snap.id, ...(snap.data() as Omit<Space, 'id'>) }] });
      },
      () => {
        if (attempt++ < 6 && useSession.getState().user?.uid === user.uid) setTimeout(watchSpace, 1500 * attempt);
      },
    );
    unsubs.push(unsub);
  };
  watchSpace();
}

export function startAuthListener(): void {
  onAuthStateChanged(auth, (user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    const set = useSession.getState().set;
    if (!user) {
      set({ status: 'signedOut', user: null, profile: null, spaceId: null, spaces: [], prefsLoaded: false });
      return;
    }
    set({ status: 'signedIn', user, spaceId: personalSpaceId(user.uid) });
    watchUser(user);
    void ensureBootstrap(user);
  });
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<void> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName.trim()) await updateProfile(cred.user, { displayName: displayName.trim() });
  await sendEmailVerification(cred.user).catch(() => undefined);
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerification(): Promise<void> {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

/** Re-reads the auth record (e.g. after the user clicks the verification link) and mirrors it. */
export async function refreshUser(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  await reload(user);
  useSession.getState().set({ user: auth.currentUser });
  fire(updateDoc(userRef(user.uid), { emailVerified: user.emailVerified }));
  return user.emailVerified;
}

export async function updateAccountProfile(patch: { displayName?: string; photoURL?: string }): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  // Firebase Auth only accepts short URLs; a data-URL avatar lives on the profile document only.
  if (patch.displayName !== undefined) await updateProfile(user, { displayName: patch.displayName });
  fire(setDoc(userRef(user.uid), patch, { merge: true }));
  useSession.getState().set({ user: auth.currentUser });
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

export function updatePrefs(patch: Partial<Preferences>): void {
  const user = auth.currentUser;
  if (!user) return;
  const state = useSession.getState();
  const next = { ...state.prefs, ...patch };
  state.set({ prefs: next });
  applyTheme(next);
  fire(setDoc(prefsRef(user.uid), patch, { merge: true }));
}

export function rememberLastDocument(documentId: string): void {
  const user = auth.currentUser;
  if (!user) return;
  fire(setDoc(userRef(user.uid), { lastDocumentId: documentId }, { merge: true }));
}
