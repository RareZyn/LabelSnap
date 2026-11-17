// The Drive upload / file-operation queue. Drains in the foreground on start-up, `online` and
// `visibilitychange` (iOS has no Background Sync). Local blobs are never deleted before an upload is confirmed.

import { getDoc, updateDoc } from 'firebase/firestore';
import { blobKey, deleteEntryImages, getImage, localDb, type PendingOp } from '../db/dexie';
import {
  copyFile,
  deleteFile,
  DriveAuthError,
  DriveNotFoundError,
  ensureDocumentFolder,
  findDocumentFolder,
  findEntryFile,
  forgetDocumentFolder,
  moveFile,
  uploadFile,
} from '../drive/driveApi';
import { getCachedToken } from '../drive/gis';
import { backoffDelay, isPermanentFailure } from './backoff';
import { documentRef, entryRef } from '../../data/refs';
import type { ImageVariant } from '../../data/types';
import { countEvent } from '../firebase/analytics';
import { useDriveStore } from '../../stores/driveStore';

const FIELD: Record<ImageVariant, 'originalImagePath' | 'imagePath' | 'thumbPath'> = {
  original: 'originalImagePath',
  derived: 'imagePath',
  thumb: 'thumbPath',
};

let running = false;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export type NewOp = Omit<PendingOp, 'id' | 'status' | 'attempts' | 'createdAt' | 'nextAttemptAt'>;

export async function enqueue(op: NewOp, delayMs = 0): Promise<number> {
  const id = await localDb.pending_ops.add({
    ...op,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: Date.now() + delayMs,
  });
  schedule(delayMs);
  return id;
}

export async function enqueueUploads(
  spaceId: string,
  documentId: string,
  entryId: string,
  variants: ImageVariant[] = ['thumb', 'derived', 'original'],
): Promise<void> {
  // Thumbnails first: they are what other devices need to render lists.
  for (const variant of variants) await enqueue({ type: 'upload', spaceId, documentId, entryId, variant });
}

export async function removeOps(ids: number[]): Promise<void> {
  await localDb.pending_ops.bulkDelete(ids);
}

export async function removeUploadOpsForEntry(entryId: string): Promise<void> {
  await localDb.pending_ops
    .where('entryId')
    .equals(entryId)
    .filter((o) => o.type === 'upload' || o.type === 'copy')
    .delete();
}

/** Points queued operations of a moved Entry at its new Document. */
export async function retargetEntryOps(entryId: string, spaceId: string, documentId: string): Promise<void> {
  await localDb.pending_ops
    .where('entryId')
    .equals(entryId)
    .modify((o) => {
      o.spaceId = spaceId;
      o.documentId = documentId;
    });
}

export async function retryFailed(): Promise<void> {
  await localDb.pending_ops
    .where('status')
    .equals('failed')
    .modify({ status: 'pending', attempts: 0, nextAttemptAt: Date.now(), lastError: undefined });
  schedule(0);
}

export async function discardFailed(): Promise<void> {
  await localDb.pending_ops.where('status').equals('failed').delete();
}

function schedule(delayMs: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void drainQueue(), Math.max(0, delayMs));
}

async function scheduleNext(): Promise<void> {
  const next = await localDb.pending_ops.where('status').equals('pending').sortBy('nextAttemptAt');
  if (next.length) schedule(Math.max(500, next[0].nextAttemptAt - Date.now()));
}

function needsDrive(op: PendingOp): boolean {
  return !(op.type === 'deleteFiles' && !op.driveIds?.length);
}

async function markEntrySyncedIfDone(op: PendingOp, currentId: number): Promise<void> {
  if (!op.entryId) return;
  const remaining = await localDb.pending_ops
    .where('entryId')
    .equals(op.entryId)
    .filter((o) => o.id !== currentId && (o.type === 'upload' || o.type === 'copy'))
    .count();
  if (remaining === 0) {
    updateDoc(entryRef(op.spaceId, op.documentId, op.entryId), { syncState: 'synced' }).catch(() => undefined);
  }
}

async function documentTitle(op: PendingOp): Promise<string> {
  try {
    const snap = await getDoc(documentRef(op.spaceId, op.documentId));
    return (snap.data()?.title as string) ?? 'Document';
  } catch {
    return 'Document';
  }
}

async function entryExists(op: PendingOp): Promise<boolean> {
  try {
    const snap = await getDoc(entryRef(op.spaceId, op.documentId, op.entryId!));
    return snap.exists();
  } catch {
    return true;
  }
}

async function recordDriveId(op: PendingOp, variant: ImageVariant, driveId: string): Promise<void> {
  const ref = entryRef(op.spaceId, op.documentId, op.entryId!);
  updateDoc(ref, { [FIELD[variant]]: driveId }).catch(() => undefined);
  if (variant === 'thumb') {
    try {
      const d = await getDoc(documentRef(op.spaceId, op.documentId));
      if (d.data()?.coverEntryId === op.entryId) {
        updateDoc(documentRef(op.spaceId, op.documentId), { coverThumbPath: driveId }).catch(() => undefined);
      }
    } catch {
      /* cover is cosmetic */
    }
  }
}

async function runUpload(op: PendingOp): Promise<void> {
  const variant = op.variant!;
  const row = await getImage(op.entryId!, variant);
  if (!row) return; // Entry deleted or image replaced: nothing to upload.
  if (row.uploaded && row.driveId) return recordDriveId(op, variant, row.driveId);
  if (!(await entryExists(op))) return;
  const folder = await ensureDocumentFolder(op.documentId, await documentTitle(op));
  const recovered = op.attempts > 0 ? await findEntryFile(op.entryId!, variant) : null;
  const driveId =
    recovered ??
    (await uploadFile(row.blob, `${op.entryId}_${variant}.jpg`, folder, {
      labelsnapEntry: op.entryId!,
      labelsnapVariant: variant,
      labelsnapDocument: op.documentId,
    }));
  // The Entry may have been deleted while the upload was in flight: do not leave an orphan in Drive.
  if (!(await entryExists(op))) {
    await deleteFile(driveId);
    return;
  }
  // The local blob may have been replaced meanwhile; only confirm the blob that was uploaded.
  const current = await localDb.image_blobs.get(blobKey(op.entryId!, variant));
  if (current && current.updatedAt === row.updatedAt) {
    await localDb.image_blobs.update(blobKey(op.entryId!, variant), { uploaded: 1, driveId });
  }
  await recordDriveId(op, variant, driveId);
}

async function runCopy(op: PendingOp): Promise<void> {
  const src = op.driveIds?.[0];
  if (!src || !op.variant) return;
  if (!(await entryExists(op))) return;
  const folder = await ensureDocumentFolder(op.documentId, await documentTitle(op));
  const id = await copyFile(src, folder, `${op.entryId}_${op.variant}.jpg`, {
    labelsnapEntry: op.entryId!,
    labelsnapVariant: op.variant,
    labelsnapDocument: op.documentId,
  });
  await recordDriveId(op, op.variant, id);
}

async function runMove(op: PendingOp): Promise<void> {
  const target = await ensureDocumentFolder(op.documentId, await documentTitle(op));
  const source = op.fromDocumentId ? await findDocumentFolder(op.fromDocumentId) : null;
  for (const id of op.driveIds ?? []) {
    try {
      await moveFile(id, target, source ?? undefined);
    } catch (e) {
      if (!(e instanceof DriveNotFoundError)) throw e;
    }
  }
}

async function runDeleteFiles(op: PendingOp): Promise<void> {
  for (const id of op.driveIds ?? []) await deleteFile(id);
  if (op.entryId) await deleteEntryImages(op.entryId);
}

async function runDeleteFolder(op: PendingOp): Promise<void> {
  const folder = await findDocumentFolder(op.documentId);
  if (folder) await deleteFile(folder);
  await forgetDocumentFolder(op.documentId);
}

async function runOp(op: PendingOp): Promise<void> {
  switch (op.type) {
    case 'upload':
      return runUpload(op);
    case 'copy':
      return runCopy(op);
    case 'move':
      return runMove(op);
    case 'deleteFiles':
      return runDeleteFiles(op);
    case 'deleteFolder':
      return runDeleteFolder(op);
  }
}

/** Drops uploads whose Entry was deleted or rejected by the server; needs no Drive access. */
async function pruneOrphanUploads(): Promise<void> {
  const ops = await localDb.pending_ops.filter((o) => (o.type === 'upload' || o.type === 'copy') && !!o.entryId).toArray();
  const checked = new Map<string, boolean>();
  for (const op of ops) {
    let alive = checked.get(op.entryId!);
    if (alive === undefined) {
      try {
        alive = (await getDoc(entryRef(op.spaceId, op.documentId, op.entryId!))).exists();
      } catch {
        alive = true; // Unknown: keep it.
      }
      checked.set(op.entryId!, alive);
    }
    if (!alive) await localDb.pending_ops.delete(op.id!);
  }
}

export async function drainQueue(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    if (navigator.onLine) await pruneOrphanUploads();
    for (;;) {
      if (!navigator.onLine) break;
      const now = Date.now();
      const op = await localDb.pending_ops
        .where('status')
        .equals('pending')
        .filter((o) => o.nextAttemptAt <= now && (!needsDrive(o) || !!getCachedToken()))
        .first();
      if (!op) break;
      try {
        await runOp(op);
        await markEntrySyncedIfDone(op, op.id!);
        await localDb.pending_ops.delete(op.id!);
      } catch (e) {
        if (e instanceof DriveAuthError) {
          useDriveStore.getState().setStatus('expired');
          break;
        }
        const attempts = op.attempts + 1;
        const failed = isPermanentFailure(attempts);
        await localDb.pending_ops.update(op.id!, {
          attempts,
          status: failed ? 'failed' : 'pending',
          nextAttemptAt: Date.now() + backoffDelay(attempts),
          lastError: e instanceof Error ? e.message : String(e),
        });
        if (failed) {
          countEvent('sync_failure');
          if (op.entryId) {
            updateDoc(entryRef(op.spaceId, op.documentId, op.entryId), { syncState: 'failed' }).catch(() => undefined);
          }
        }
      }
    }
  } finally {
    running = false;
    await scheduleNext();
    if (rerun) {
      rerun = false;
      void drainQueue();
    }
  }
}

let started = false;

export function startSyncEngine(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void drainQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drainQueue();
  });
  useDriveStore.subscribe((s, prev) => {
    if (s.status === 'connected' && prev.status !== 'connected') void drainQueue();
  });
  void drainQueue();
}
