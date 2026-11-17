// OCR orchestration for saved Entries: attach results that finish after save, re-run, and recover jobs
// interrupted by a reload.

import type { CustomField, Entry, Quad } from './types';
import { recognize, type OcrOutput, type OcrRect } from '../lib/ocr/ocrService';
import { setOcrState, writeOcrResult } from './entries';
import { getEntryBlob } from '../lib/images';

const running = new Set<string>();

export function isOcrRunning(entryId: string): boolean {
  return running.has(entryId);
}

/** Attaches a recognition that was still running when the Entry was saved. */
export function attachWhenDone(
  promise: Promise<OcrOutput>,
  target: { spaceId: string; documentId: string; entryId: string },
  fields: CustomField[],
  currentValues: Record<string, string>,
  region: Quad | null,
): void {
  running.add(target.entryId);
  promise
    .then((out) => writeOcrResult(target, out, { fields, currentValues, region }))
    .catch(() => setOcrState({ spaceId: target.spaceId, documentId: target.documentId, id: target.entryId }, 'failed'))
    .finally(() => running.delete(target.entryId));
}

/** Runs OCR on a saved Entry's derived image, optionally on a region and/or other languages. */
export async function runOcrForEntry(
  entry: Entry,
  opts: { languages: string[]; fields: CustomField[]; rect?: OcrRect; region?: Quad | null },
): Promise<OcrOutput | null> {
  if (running.has(entry.id)) return null;
  running.add(entry.id);
  try {
    const blob = await getEntryBlob(entry, 'derived');
    if (!blob) return null;
    setOcrState(entry, 'pending');
    const out = await recognize(blob, { languages: opts.languages, rectangle: opts.rect });
    writeOcrResult({ spaceId: entry.spaceId, documentId: entry.documentId, entryId: entry.id }, out, {
      fields: opts.fields,
      currentValues: entry.customFieldValues,
      region: opts.region ?? null,
    });
    return out;
  } catch {
    setOcrState(entry, 'failed');
    return null;
  } finally {
    running.delete(entry.id);
  }
}

/** Re-queues Entries left in "pending" by an interrupted session. */
export function recoverPendingOcr(entries: Entry[], languages: string[], fields: CustomField[]): void {
  const stale = entries.filter(
    (e) => e.ocrState === 'pending' && !running.has(e.id) && (e.updatedAt?.toMillis?.() ?? 0) < Date.now() - 60_000,
  );
  for (const e of stale) void runOcrForEntry(e, { languages: e.ocrLanguages?.length ? e.ocrLanguages : languages, fields });
}
