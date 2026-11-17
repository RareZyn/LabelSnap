// Entry repository. Every new or edited Entry is written locally first (Firestore offline cache + IndexedDB
// image blobs); uploads to Drive are queued and drained when online.

import {
  GeoPoint,
  Timestamp,
  arrayUnion,
  getDoc,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase/app';
import { useDocSnapshot, useQuerySnapshot } from '../hooks/useFirestore';
import { documentRef, entriesCol, entryRef, fire, ocrRef } from './refs';
import type {
  CustomField,
  DocumentRec,
  Entry,
  ImageFilter,
  ImageVariant,
  OcrResult,
  OcrState,
  QualityFlag,
  Quad,
} from './types';
import { getImage, localDb, putImage } from '../lib/db/dexie';
import {
  enqueue,
  enqueueUploads,
  removeOps,
  removeUploadOpsForEntry,
  retargetEntryOps,
} from '../lib/sync/uploadQueue';
import { countEvent } from '../lib/firebase/analytics';
import { OCR_ENGINE, type OcrOutput } from '../lib/ocr/ocrService';
import { extractFields } from '../lib/ocr/fieldPatterns';
import { requestPersistence } from '../lib/sync/quota';
import { ORDER_STEP, orderBetween } from '../lib/order';
import { copyEntriesData } from './documents';
import { forgetImage } from '../lib/images';

export interface EntryView extends Entry {
  pendingWrites: boolean;
}

export function entryFromSnap(s: QueryDocumentSnapshot, spaceId: string, documentId: string): EntryView {
  const d = s.data() as Record<string, unknown>;
  return {
    caption: '',
    footnote: '',
    tags: [],
    customFieldValues: {},
    qualityFlags: [],
    rotation: 0,
    straighten: 0,
    filter: 'none',
    ocrState: 'disabled',
    ocrTextCache: '',
    originalImagePath: '',
    imagePath: '',
    thumbPath: '',
    syncState: 'local',
    ...d,
    id: s.id,
    spaceId,
    documentId,
    pendingWrites: s.metadata.hasPendingWrites,
  } as unknown as EntryView;
}

export function useEntries(spaceId: string | null, documentId: string | undefined) {
  return useQuerySnapshot<EntryView>(
    spaceId && documentId ? query(entriesCol(spaceId, documentId), orderBy('order')) : null,
    spaceId && documentId ? `entries:${spaceId}:${documentId}` : null,
    (s) => entryFromSnap(s, spaceId!, documentId!),
    true,
  );
}

export function useOcrResult(spaceId: string, documentId: string, entryId: string | undefined) {
  return useDocSnapshot<OcrResult>(
    entryId ? ocrRef(spaceId, documentId, entryId) : null,
    entryId ? `ocr:${spaceId}:${documentId}:${entryId}` : null,
    (s) => (s.exists() ? (s.data() as OcrResult) : null),
  );
}

export function deviceSummary(cameraLabel?: string): string {
  const ua = navigator.userAgent;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    (/iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'Unknown');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return [platform, browser, cameraLabel].filter(Boolean).join(' · ').slice(0, 120);
}

/** OCR-derived field values for fields that are still empty. */
export function fieldsFromOcr(text: string, fields: CustomField[], current: Record<string, string>): Record<string, string> {
  const parsed = extractFields(text);
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!f.ocrPattern || current[f.key]) continue;
    const v = parsed[f.ocrPattern];
    if (v) out[f.key] = v;
  }
  return out;
}

function ocrDoc(output: OcrOutput, editedText: string | null, region: Quad | null): OcrResult {
  return {
    engine: OCR_ENGINE,
    languages: output.languages,
    rawText: output.text,
    editedText: editedText && editedText !== output.text ? editedText : null,
    confidence: output.confidence,
    blocks: output.blocks.slice(0, 200),
    words: output.words.slice(0, 1500),
    region,
    parsedFields: extractFields(editedText ?? output.text),
    durationMs: output.durationMs,
    processedAt: serverTimestamp() as unknown as Timestamp,
  };
}

const ocrStateOf = (output: OcrOutput): OcrState => (output.text.trim() ? 'done' : 'empty');

export interface NewEntryInput {
  entryId: string;
  order: number;
  original: Blob;
  derived: Blob;
  thumb: Blob;
  width: number;
  height: number;
  cropQuad: Quad | null;
  rotation: number;
  straighten: number;
  filter: ImageFilter;
  qualityFlags: QualityFlag[];
  caption: string;
  footnote: string;
  tags: string[];
  customFieldValues: Record<string, string>;
  ocr: OcrOutput | null;
  ocrEditedText: string | null;
  ocrRegion: Quad | null;
  ocrState: OcrState;
  capturedAt: Date;
  source: 'camera' | 'import';
  geo: { lat: number; lng: number } | null;
  deviceInfo: string;
}

let persistenceAsked = false;

export async function saveNewEntry(doc: DocumentRec, uid: string, input: NewEntryInput): Promise<void> {
  await Promise.all([
    putImage(input.entryId, 'original', input.original),
    putImage(input.entryId, 'derived', input.derived),
    putImage(input.entryId, 'thumb', input.thumb),
  ]);
  const ref = entryRef(doc.spaceId, doc.id, input.entryId);
  const ocrText = input.ocrEditedText ?? input.ocr?.text ?? '';
  const batch = writeBatch(db);
  batch.set(ref, {
    order: input.order,
    originalImagePath: '',
    imagePath: '',
    thumbPath: '',
    imageStorage: 'gdrive',
    width: input.width,
    height: input.height,
    byteSize: input.original.size + input.derived.size + input.thumb.size,
    cropQuad: input.cropQuad,
    rotation: input.rotation,
    straighten: input.straighten,
    filter: input.filter,
    qualityFlags: input.qualityFlags,
    caption: input.caption.trim(),
    footnote: input.footnote.trim(),
    tags: input.tags,
    customFieldValues: input.customFieldValues,
    ocrState: input.ocr ? ocrStateOf(input.ocr) : input.ocrState,
    ocrTextCache: ocrText.slice(0, 1000),
    ocrConfidence: input.ocr?.confidence ?? null,
    ocrLanguages: input.ocr?.languages ?? [],
    capturedAt: Timestamp.fromDate(input.capturedAt),
    capturedBy: uid,
    deviceInfo: input.deviceInfo,
    geo: input.geo ? new GeoPoint(input.geo.lat, input.geo.lng) : null,
    source: input.source,
    syncState: 'local',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (input.ocr) batch.set(ocrRef(doc.spaceId, doc.id, input.entryId), ocrDoc(input.ocr, input.ocrEditedText, input.ocrRegion));
  batch.update(documentRef(doc.spaceId, doc.id), {
    entryCount: increment(1),
    nextOrder: Math.max(doc.nextOrder ?? 0, input.order + ORDER_STEP),
    updatedAt: serverTimestamp(),
    ...(doc.coverEntryId ? {} : { coverEntryId: input.entryId }),
  });
  fire(batch.commit());
  await enqueueUploads(doc.spaceId, doc.id, input.entryId);
  countEvent(input.source === 'import' ? 'import' : 'capture');
  if (!persistenceAsked) {
    persistenceAsked = true;
    void requestPersistence();
  }
}

/** Writes an OCR result onto an Entry and fills empty pattern-mapped custom fields. */
export function writeOcrResult(
  target: { spaceId: string; documentId: string; entryId: string },
  output: OcrOutput,
  opts: { editedText?: string | null; region?: Quad | null; fields: CustomField[]; currentValues: Record<string, string> },
): void {
  const text = opts.editedText ?? output.text;
  const fill = fieldsFromOcr(text, opts.fields, opts.currentValues);
  const patch: Record<string, unknown> = {
    ocrState: ocrStateOf(output),
    ocrTextCache: text.slice(0, 1000),
    ocrConfidence: output.confidence,
    ocrLanguages: output.languages,
    updatedAt: serverTimestamp(),
  };
  for (const [k, v] of Object.entries(fill)) patch[`customFieldValues.${k}`] = v;
  const batch = writeBatch(db);
  batch.set(ocrRef(target.spaceId, target.documentId, target.entryId), ocrDoc(output, opts.editedText ?? null, opts.region ?? null));
  batch.update(entryRef(target.spaceId, target.documentId, target.entryId), patch as DocumentData);
  fire(batch.commit());
  countEvent('ocr_run');
}

export function saveOcrEdit(entry: Entry, editedText: string): void {
  const batch = writeBatch(db);
  batch.set(ocrRef(entry.spaceId, entry.documentId, entry.id), { editedText }, { merge: true });
  batch.update(entryRef(entry.spaceId, entry.documentId, entry.id), {
    ocrTextCache: editedText.slice(0, 1000),
    updatedAt: serverTimestamp(),
  });
  fire(batch.commit());
}

export function setOcrState(entry: Pick<Entry, 'spaceId' | 'documentId' | 'id'>, state: OcrState): void {
  fire(updateDoc(entryRef(entry.spaceId, entry.documentId, entry.id), { ocrState: state }));
}

export function updateEntry(entry: Pick<Entry, 'spaceId' | 'documentId' | 'id'>, patch: Partial<Entry>): void {
  const { id: _i, spaceId: _s, documentId: _d, ...rest } = patch as Entry;
  fire(updateDoc(entryRef(entry.spaceId, entry.documentId, entry.id), { ...rest, updatedAt: serverTimestamp() }));
}

export function setEntryOrder(entry: Entry, order: number): void {
  fire(updateDoc(entryRef(entry.spaceId, entry.documentId, entry.id), { order, updatedAt: serverTimestamp() }));
}

export function rebalanceOrders(entries: Entry[]): void {
  const batch = writeBatch(db);
  entries.forEach((e, i) => batch.update(entryRef(e.spaceId, e.documentId, e.id), { order: (i + 1) * ORDER_STEP }));
  if (entries[0]) {
    batch.update(documentRef(entries[0].spaceId, entries[0].documentId), {
      nextOrder: (entries.length + 1) * ORDER_STEP,
    });
  }
  fire(batch.commit());
}

export function tagEntries(entries: Entry[], tag: string): void {
  const batch = writeBatch(db);
  for (const e of entries) {
    batch.update(entryRef(e.spaceId, e.documentId, e.id), { tags: arrayUnion(tag), updatedAt: serverTimestamp() });
  }
  fire(batch.commit());
}

async function driveIdsOf(e: Entry): Promise<string[]> {
  const ids = new Set([e.originalImagePath, e.imagePath, e.thumbPath].filter(Boolean));
  const rows = await localDb.image_blobs.where('entryId').equals(e.id).toArray();
  rows.forEach((r) => r.driveId && ids.add(r.driveId));
  return Array.from(ids);
}

const UNDO_WINDOW_MS = 10_000;

/** Deletes Entries now; Drive files and local blobs are removed after the undo window. Returns undo. */
export async function deleteEntries(doc: DocumentRec, entries: Entry[]): Promise<() => Promise<void>> {
  const snapshots = await Promise.all(
    entries.map(async (e) => {
      let ocr: Record<string, unknown> | undefined;
      try {
        ocr = (await getDoc(ocrRef(e.spaceId, e.documentId, e.id))).data();
      } catch {
        ocr = undefined;
      }
      return { entry: e, ocr };
    }),
  );
  const batch = writeBatch(db);
  for (const e of entries) {
    batch.delete(entryRef(e.spaceId, e.documentId, e.id));
    batch.delete(ocrRef(e.spaceId, e.documentId, e.id));
  }
  const removedCover = entries.some((e) => e.id === doc.coverEntryId);
  batch.update(documentRef(doc.spaceId, doc.id), {
    entryCount: increment(-entries.length),
    updatedAt: serverTimestamp(),
    ...(removedCover ? { coverEntryId: null, coverThumbPath: null } : {}),
  });
  fire(batch.commit());

  const opIds: number[] = [];
  for (const e of entries) {
    await removeUploadOpsForEntry(e.id);
    opIds.push(
      await enqueue(
        { type: 'deleteFiles', spaceId: doc.spaceId, documentId: doc.id, entryId: e.id, driveIds: await driveIdsOf(e) },
        UNDO_WINDOW_MS,
      ),
    );
  }

  return async () => {
    await removeOps(opIds);
    const undo = writeBatch(db);
    for (const { entry, ocr } of snapshots) {
      const { id: _i, spaceId: _s, documentId: _d, pendingWrites: _p, ...data } = entry as EntryView;
      undo.set(entryRef(entry.spaceId, entry.documentId, entry.id), { ...data, updatedAt: serverTimestamp() });
      if (ocr) undo.set(ocrRef(entry.spaceId, entry.documentId, entry.id), ocr as DocumentData);
    }
    undo.update(documentRef(doc.spaceId, doc.id), {
      entryCount: increment(entries.length),
      updatedAt: serverTimestamp(),
      ...(removedCover ? { coverEntryId: doc.coverEntryId ?? null, coverThumbPath: doc.coverThumbPath ?? null } : {}),
    });
    fire(undo.commit());
    for (const { entry } of snapshots) {
      const pending = await localDb.image_blobs.where('entryId').equals(entry.id).filter((r) => !r.uploaded).toArray();
      if (pending.length) {
        await enqueueUploads(
          entry.spaceId,
          entry.documentId,
          entry.id,
          pending.map((r) => r.variant),
        );
      }
    }
  };
}

/** Duplicates Entries in place, each right after its original. */
export async function duplicateEntries(doc: DocumentRec, sorted: Entry[], selected: Entry[]): Promise<void> {
  const orders = selected.map((e) => {
    const idx = sorted.findIndex((s) => s.id === e.id);
    return orderBetween(e.order, sorted[idx + 1]?.order);
  });
  const copies = await copyEntriesData(selected, doc.spaceId, doc.id, orders);
  const batch = writeBatch(db);
  copies.ops.forEach((op) => op(batch));
  batch.update(documentRef(doc.spaceId, doc.id), { entryCount: increment(selected.length), updatedAt: serverTimestamp() });
  fire(batch.commit());
  await copies.afterCommit();
}

/** Copies Entries to the end of another Document. */
export async function copyEntriesTo(target: DocumentRec, entries: Entry[]): Promise<void> {
  const base = target.nextOrder ?? ORDER_STEP;
  const orders = entries.map((_, i) => base + i * ORDER_STEP);
  const copies = await copyEntriesData(entries, target.spaceId, target.id, orders);
  const batch = writeBatch(db);
  copies.ops.forEach((op) => op(batch));
  batch.update(documentRef(target.spaceId, target.id), {
    entryCount: increment(entries.length),
    nextOrder: base + entries.length * ORDER_STEP,
    updatedAt: serverTimestamp(),
    ...(target.coverEntryId ? {} : { coverEntryId: copies.firstId }),
  });
  fire(batch.commit());
  await copies.afterCommit();
}

/** Moves Entries (same ids) to the end of another Document; Drive files move with them. */
export async function moveEntriesTo(source: DocumentRec, target: DocumentRec, entries: Entry[]): Promise<void> {
  const base = target.nextOrder ?? ORDER_STEP;
  const ocrDocs = await Promise.all(
    entries.map(async (e) => {
      try {
        return (await getDoc(ocrRef(e.spaceId, e.documentId, e.id))).data();
      } catch {
        return undefined;
      }
    }),
  );
  const batch = writeBatch(db);
  entries.forEach((e, i) => {
    const { id: _i, spaceId: _s, documentId: _d, pendingWrites: _p, ...data } = e as EntryView;
    batch.set(entryRef(target.spaceId, target.id, e.id), { ...data, order: base + i * ORDER_STEP, updatedAt: serverTimestamp() });
    if (ocrDocs[i]) batch.set(ocrRef(target.spaceId, target.id, e.id), ocrDocs[i] as DocumentData);
    batch.delete(entryRef(e.spaceId, e.documentId, e.id));
    batch.delete(ocrRef(e.spaceId, e.documentId, e.id));
  });
  const removedCover = entries.some((e) => e.id === source.coverEntryId);
  batch.update(documentRef(source.spaceId, source.id), {
    entryCount: increment(-entries.length),
    updatedAt: serverTimestamp(),
    ...(removedCover ? { coverEntryId: null, coverThumbPath: null } : {}),
  });
  batch.update(documentRef(target.spaceId, target.id), {
    entryCount: increment(entries.length),
    nextOrder: base + entries.length * ORDER_STEP,
    updatedAt: serverTimestamp(),
    ...(target.coverEntryId ? {} : { coverEntryId: entries[0]?.id }),
  });
  fire(batch.commit());
  for (const e of entries) {
    await retargetEntryOps(e.id, target.spaceId, target.id);
    const ids = [e.originalImagePath, e.imagePath, e.thumbPath].filter(Boolean);
    if (ids.length) {
      await enqueue({
        type: 'move',
        spaceId: target.spaceId,
        documentId: target.id,
        entryId: e.id,
        fromDocumentId: source.id,
        driveIds: ids,
      });
    }
  }
}

export interface ReplacementImages {
  original?: Blob;
  derived: Blob;
  thumb: Blob;
  width: number;
  height: number;
  cropQuad: Quad | null;
  rotation: number;
  straighten: number;
  filter: ImageFilter;
  qualityFlags: QualityFlag[];
}

/**
 * Replaces an Entry's image (new original) or re-crops it (same original), keeping caption, footnote and
 * fields. The previous Drive copies are deleted once the new ones are queued.
 */
export async function replaceEntryImages(entry: Entry, images: ReplacementImages): Promise<void> {
  const variants: ImageVariant[] = images.original ? ['thumb', 'derived', 'original'] : ['thumb', 'derived'];
  const oldIds = [entry.thumbPath, entry.imagePath, ...(images.original ? [entry.originalImagePath] : [])].filter(Boolean);
  await removeUploadOpsForEntry(entry.id);
  if (images.original) await putImage(entry.id, 'original', images.original);
  await putImage(entry.id, 'derived', images.derived);
  await putImage(entry.id, 'thumb', images.thumb);
  variants.forEach((v) => forgetImage(entry.id, v));
  const keepOriginal = !images.original && (await getImage(entry.id, 'original'))?.uploaded === 0;
  fire(
    updateDoc(entryRef(entry.spaceId, entry.documentId, entry.id), {
      width: images.width,
      height: images.height,
      cropQuad: images.cropQuad,
      rotation: images.rotation,
      straighten: images.straighten,
      filter: images.filter,
      qualityFlags: images.qualityFlags,
      thumbPath: '',
      imagePath: '',
      ...(images.original ? { originalImagePath: '' } : {}),
      syncState: 'local',
      updatedAt: serverTimestamp(),
    }),
  );
  await enqueueUploads(entry.spaceId, entry.documentId, entry.id, keepOriginal ? [...variants, 'original'] : variants);
  if (oldIds.length) {
    // No entryId: the local blobs now hold the new images and must not be removed.
    await enqueue({ type: 'deleteFiles', spaceId: entry.spaceId, documentId: entry.documentId, driveIds: oldIds });
  }
}
