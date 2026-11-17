// Document repository: live hooks and local-first operations.

import {
  Timestamp,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase/app';
import { useDocSnapshot, useQuerySnapshot } from '../hooks/useFirestore';
import { documentRef, documentsCol, entriesCol, entryRef, fire, newId, ocrRef, spaceRef } from './refs';
import type { DocumentRec, Entry } from './types';
import { TRASH_RETENTION_DAYS } from '../config';
import { enqueue, enqueueUploads } from '../lib/sync/uploadQueue';
import { deleteEntryImages, getImage, putImage } from '../lib/db/dexie';
import { ORDER_STEP } from '../lib/order';

export function docFromSnap(snap: DocumentSnapshot | QueryDocumentSnapshot, spaceId: string): DocumentRec {
  const d = snap.data() as Record<string, unknown>;
  return {
    tags: [],
    notes: '',
    entryCount: 0,
    nextOrder: ORDER_STEP,
    pinned: false,
    ocrEnabled: true,
    captureLocation: false,
    status: 'active',
    ...d,
    id: snap.id,
    spaceId,
  } as unknown as DocumentRec;
}

export function useDocuments(spaceId: string | null) {
  return useQuerySnapshot<DocumentRec>(
    spaceId ? documentsCol(spaceId) : null,
    spaceId ? `docs:${spaceId}` : null,
    (s) => docFromSnap(s, spaceId!),
  );
}

export function useDocumentRec(spaceId: string | null, documentId: string | undefined) {
  return useDocSnapshot<DocumentRec>(
    spaceId && documentId ? documentRef(spaceId, documentId) : null,
    spaceId && documentId ? `doc:${spaceId}:${documentId}` : null,
    (s) => (s.exists() ? docFromSnap(s, spaceId!) : null),
  );
}

export function createDocument(
  spaceId: string,
  uid: string,
  input: { title: string; templateId: string; tags?: string[]; ocrEnabled: boolean },
): string {
  const id = newId();
  const batch = writeBatch(db);
  batch.set(documentRef(spaceId, id), {
    title: input.title.trim(),
    templateId: input.templateId,
    tags: input.tags ?? [],
    notes: '',
    entryCount: 0,
    nextOrder: ORDER_STEP,
    status: 'active',
    trashedAt: null,
    pinned: false,
    ocrEnabled: input.ocrEnabled,
    captureLocation: false,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(spaceRef(spaceId), { documentCount: increment(1) });
  fire(batch.commit());
  return id;
}

export function updateDocument(spaceId: string, documentId: string, patch: Partial<Omit<DocumentRec, 'id' | 'spaceId'>>) {
  fire(updateDoc(documentRef(spaceId, documentId), { ...patch, updatedAt: serverTimestamp() }));
}

export function trashDocument(doc: DocumentRec): void {
  fire(
    updateDoc(documentRef(doc.spaceId, doc.id), {
      status: 'trashed',
      trashedAt: Timestamp.now(),
      pinned: false,
      updatedAt: serverTimestamp(),
    }),
  );
}

export function restoreDocument(doc: DocumentRec): void {
  fire(
    updateDoc(documentRef(doc.spaceId, doc.id), { status: 'active', trashedAt: null, updatedAt: serverTimestamp() }),
  );
}

async function loadEntries(spaceId: string, documentId: string): Promise<Entry[]> {
  const snap = await getDocs(entriesCol(spaceId, documentId));
  return snap.docs.map((d) => ({ ...(d.data() as Entry), id: d.id, spaceId, documentId }));
}

/** Commits writes in chunks below Firestore's 500-operation batch limit. */
async function chunkedWrites(ops: Array<(b: ReturnType<typeof writeBatch>) => void>): Promise<void> {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    fire(batch.commit());
  }
}

/** Duplicates a Document with all its Entries. Images are copied locally or, if only in Drive, server-side. */
export async function duplicateDocument(doc: DocumentRec, uid: string, title: string): Promise<string> {
  const newDocId = newId();
  const entries = await loadEntries(doc.spaceId, doc.id);
  const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  const { id: _id, spaceId: _s, ...rest } = doc;
  ops.push((b) =>
    b.set(documentRef(doc.spaceId, newDocId), {
      ...rest,
      title,
      pinned: false,
      status: 'active',
      trashedAt: null,
      coverEntryId: null,
      coverThumbPath: null,
      driveFolderId: null,
      lastExport: rest.lastExport ?? null,
      entryCount: entries.length,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  ops.push((b) => b.update(spaceRef(doc.spaceId), { documentCount: increment(1) }));
  const copies = await copyEntriesData(entries, doc.spaceId, newDocId, entries.map((e) => e.order));
  copies.ops.forEach((op) => ops.push(op));
  if (copies.firstId) ops.push((b) => b.update(documentRef(doc.spaceId, newDocId), { coverEntryId: copies.firstId }));
  await chunkedWrites(ops);
  await copies.afterCommit();
  return newDocId;
}

/**
 * Builds the writes that copy Entries into a Document under new ids, and the image work to do afterwards:
 * a local blob is copied and uploaded; an image held only in Drive is copied in Drive.
 */
export async function copyEntriesData(
  entries: Entry[],
  spaceId: string,
  targetDocId: string,
  orders: number[],
): Promise<{
  ops: Array<(b: ReturnType<typeof writeBatch>) => void>;
  afterCommit: () => Promise<void>;
  firstId?: string;
  newIds: string[];
}> {
  const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  const after: Array<() => Promise<void>> = [];
  const newIds: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const id = newId();
    newIds.push(id);
    let ocr: Record<string, unknown> | undefined;
    try {
      ocr = (await getDoc(ocrRef(e.spaceId, e.documentId, e.id))).data();
    } catch {
      ocr = undefined;
    }
    const { id: _id, spaceId: _sp, documentId: _d, ...data } = e;
    ops.push((b) =>
      b.set(entryRef(spaceId, targetDocId, id), {
        ...data,
        order: orders[i],
        originalImagePath: '',
        imagePath: '',
        thumbPath: '',
        syncState: 'local',
        updatedAt: serverTimestamp(),
      }),
    );
    if (ocr) ops.push((b) => b.set(ocrRef(spaceId, targetDocId, id), ocr!));
    after.push(async () => {
      const variants = [
        ['thumb', e.thumbPath],
        ['derived', e.imagePath],
        ['original', e.originalImagePath],
      ] as const;
      for (const [variant, driveId] of variants) {
        const local = await getImage(e.id, variant);
        if (local) {
          await putImage(id, variant, local.blob);
          await enqueueUploads(spaceId, targetDocId, id, [variant]);
        } else if (driveId) {
          await enqueue({ type: 'copy', spaceId, documentId: targetDocId, entryId: id, variant, driveIds: [driveId] });
        }
      }
    });
  }
  return {
    ops,
    newIds,
    firstId: newIds[0],
    afterCommit: async () => {
      for (const a of after) await a();
    },
  };
}

/** Permanently deletes a Document, its Entries, their OCR results, the local images and the Drive folder. */
export async function purgeDocument(doc: DocumentRec): Promise<void> {
  let entries: Entry[] = [];
  try {
    entries = await loadEntries(doc.spaceId, doc.id);
  } catch {
    entries = [];
  }
  const ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  for (const e of entries) {
    ops.push((b) => b.delete(ocrRef(doc.spaceId, doc.id, e.id)));
    ops.push((b) => b.delete(entryRef(doc.spaceId, doc.id, e.id)));
  }
  ops.push((b) => b.delete(documentRef(doc.spaceId, doc.id)));
  ops.push((b) => b.update(spaceRef(doc.spaceId), { documentCount: increment(-1) }));
  await chunkedWrites(ops);
  for (const e of entries) await deleteEntryImages(e.id);
  await enqueue({ type: 'deleteFolder', spaceId: doc.spaceId, documentId: doc.id });
}

/** Purges Documents that have been in Trash longer than the retention period. */
export async function purgeExpiredTrash(docs: DocumentRec[]): Promise<number> {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
  const expired = docs.filter((d) => d.status === 'trashed' && d.trashedAt && d.trashedAt.toMillis() < cutoff);
  for (const d of expired) await purgeDocument(d);
  return expired.length;
}

export function daysUntilPurge(doc: DocumentRec): number {
  if (!doc.trashedAt) return TRASH_RETENTION_DAYS;
  const ms = doc.trashedAt.toMillis() + TRASH_RETENTION_DAYS * 86_400_000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function allTags(docs: DocumentRec[]): string[] {
  return Array.from(new Set(docs.flatMap((d) => d.tags))).sort((a, b) => a.localeCompare(b));
}
