import { collection, doc } from 'firebase/firestore';
import { db } from '../lib/firebase/app';
import { toastError } from '../stores/toastStore';
import i18n from '../i18n';

export const userRef = (uid: string) => doc(db, 'users', uid);
export const prefsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'preferences');
export const spaceRef = (spaceId: string) => doc(db, 'spaces', spaceId);
export const memberRef = (spaceId: string, uid: string) => doc(db, 'spaces', spaceId, 'members', uid);
export const templatesCol = (spaceId: string) => collection(db, 'spaces', spaceId, 'templates');
export const templateRef = (spaceId: string, id: string) => doc(db, 'spaces', spaceId, 'templates', id);
export const documentsCol = (spaceId: string) => collection(db, 'spaces', spaceId, 'documents');
export const documentRef = (spaceId: string, documentId: string) => doc(db, 'spaces', spaceId, 'documents', documentId);
export const entriesCol = (spaceId: string, documentId: string) =>
  collection(db, 'spaces', spaceId, 'documents', documentId, 'entries');
export const entryRef = (spaceId: string, documentId: string, entryId: string) =>
  doc(db, 'spaces', spaceId, 'documents', documentId, 'entries', entryId);
export const ocrRef = (spaceId: string, documentId: string, entryId: string) =>
  doc(db, 'spaces', spaceId, 'documents', documentId, 'entries', entryId, 'ocr', 'result');

export const personalSpaceId = (uid: string) => `personal_${uid}`;

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

/**
 * Fire-and-forget a Firestore write. Offline, the promise only settles once the server acknowledges,
 * so the UI never awaits it; failures surface as a toast.
 */
export function fire(p: Promise<unknown>): void {
  p.catch((err: unknown) => {
    console.error(err);
    const code = (err as { code?: string })?.code ?? '';
    toastError(
      code === 'permission-denied' ? i18n.t('errors.permissionDenied') : i18n.t('errors.saveFailed'),
    );
  });
}
