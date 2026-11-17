// IndexedDB stores. Image blobs stay here, authoritative, until Google Drive confirms the upload.

import Dexie, { type Table } from 'dexie';
import type { ImageVariant } from '../../data/types';

export interface ImageBlobRow {
  /** `${entryId}:${variant}` */
  key: string;
  entryId: string;
  variant: ImageVariant;
  blob: Blob;
  byteSize: number;
  /** 1 once the Drive upload is confirmed. Only uploaded blobs may be evicted. */
  uploaded: 0 | 1;
  driveId?: string;
  updatedAt: number;
}

export type PendingOpType = 'upload' | 'copy' | 'move' | 'deleteFiles' | 'deleteFolder';
export type PendingOpStatus = 'pending' | 'failed';

export interface PendingOp {
  id?: number;
  type: PendingOpType;
  spaceId: string;
  documentId: string;
  entryId?: string;
  variant?: ImageVariant;
  /** Drive ids for copy/move/delete operations. */
  driveIds?: string[];
  /** For moves: the folder being left. */
  fromDocumentId?: string;
  status: PendingOpStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
}

export interface KvRow {
  key: string;
  value: unknown;
}

class LabelSnapDb extends Dexie {
  image_blobs!: Table<ImageBlobRow, string>;
  pending_ops!: Table<PendingOp, number>;
  kv!: Table<KvRow, string>;

  constructor() {
    super('labelsnap');
    this.version(1).stores({
      image_blobs: 'key, entryId, variant, uploaded, updatedAt',
      pending_ops: '++id, type, entryId, documentId, status, nextAttemptAt',
      kv: 'key',
    });
  }
}

export const localDb = new LabelSnapDb();

export const blobKey = (entryId: string, variant: ImageVariant) => `${entryId}:${variant}`;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await localDb.kv.get(key);
  return row?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await localDb.kv.put({ key, value });
}

export async function putImage(entryId: string, variant: ImageVariant, blob: Blob, uploaded: 0 | 1 = 0, driveId?: string) {
  await localDb.image_blobs.put({
    key: blobKey(entryId, variant),
    entryId,
    variant,
    blob,
    byteSize: blob.size,
    uploaded,
    driveId,
    updatedAt: Date.now(),
  });
}

export async function getImage(entryId: string, variant: ImageVariant): Promise<ImageBlobRow | undefined> {
  return localDb.image_blobs.get(blobKey(entryId, variant));
}

export async function deleteEntryImages(entryId: string): Promise<void> {
  await localDb.image_blobs.where('entryId').equals(entryId).delete();
}
