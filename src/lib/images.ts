// Loads Entry images: from IndexedDB first, otherwise from Google Drive (cached locally afterwards).

import { useEffect, useState } from 'react';
import type { Entry, ImageVariant } from '../data/types';
import { blobKey, getImage, putImage } from './db/dexie';
import { downloadFile, DriveAuthError } from './drive/driveApi';
import { getCachedToken } from './drive/gis';
import { useDriveStore } from '../stores/driveStore';

const MAX_URLS = 300;
const urls = new Map<string, string>();

function remember(key: string, url: string): void {
  urls.set(key, url);
  while (urls.size > MAX_URLS) {
    const [oldKey, oldUrl] = urls.entries().next().value as [string, string];
    URL.revokeObjectURL(oldUrl);
    urls.delete(oldKey);
  }
}

export function forgetImage(entryId: string, variant: ImageVariant): void {
  const key = blobKey(entryId, variant);
  const url = urls.get(key);
  if (url) URL.revokeObjectURL(url);
  urls.delete(key);
  listeners.forEach((l) => l(key));
}

const listeners = new Set<(key: string) => void>();

// At most four Drive downloads at a time.
let active = 0;
const waiting: Array<() => void> = [];
async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const FIELD: Record<ImageVariant, 'originalImagePath' | 'imagePath' | 'thumbPath'> = {
  original: 'originalImagePath',
  derived: 'imagePath',
  thumb: 'thumbPath',
};

export function driveIdOf(entry: Pick<Entry, 'originalImagePath' | 'imagePath' | 'thumbPath'>, variant: ImageVariant) {
  return entry[FIELD[variant]];
}

export type ImageSource = { entryId: string; variant: ImageVariant; driveId?: string };

/** The image blob, from the device or downloaded from Drive. Null if it is not reachable right now. */
export async function loadImageBlob(src: ImageSource): Promise<Blob | null> {
  const local = await getImage(src.entryId, src.variant);
  if (local) return local.blob;
  if (!src.driveId || !getCachedToken() || !navigator.onLine) return null;
  try {
    const blob = await throttle(() => downloadFile(src.driveId!));
    await putImage(src.entryId, src.variant, blob, 1, src.driveId);
    return blob;
  } catch (e) {
    if (e instanceof DriveAuthError) useDriveStore.getState().setStatus('expired');
    return null;
  }
}

export function getEntryBlob(
  entry: Pick<Entry, 'id' | 'originalImagePath' | 'imagePath' | 'thumbPath'>,
  variant: ImageVariant,
): Promise<Blob | null> {
  return loadImageBlob({ entryId: entry.id, variant, driveId: driveIdOf(entry, variant) });
}

export type ImageState = 'loading' | 'ready' | 'unavailable';

export function useImage(src: ImageSource | null): { url: string | null; state: ImageState } {
  const key = src ? blobKey(src.entryId, src.variant) : null;
  const driveStatus = useDriveStore((s) => s.status);
  const [url, setUrl] = useState<string | null>(key ? (urls.get(key) ?? null) : null);
  const [state, setState] = useState<ImageState>(url ? 'ready' : 'loading');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const l = (k: string) => k === key && setVersion((v) => v + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [key]);

  useEffect(() => {
    if (!src || !key) {
      setUrl(null);
      setState('unavailable');
      return;
    }
    const cached = urls.get(key);
    if (cached) {
      setUrl(cached);
      setState('ready');
      return;
    }
    let cancelled = false;
    setState('loading');
    void loadImageBlob(src).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setUrl(null);
        setState('unavailable');
        return;
      }
      const existing = urls.get(key);
      const u = existing ?? URL.createObjectURL(blob);
      if (!existing) remember(key, u);
      setUrl(u);
      setState('ready');
    });
    return () => {
      cancelled = true;
    };
    // Re-run when the Drive connection comes back or the image is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, src?.driveId, driveStatus, version]);

  return { url, state };
}

export function useEntryImage(
  entry: Pick<Entry, 'id' | 'originalImagePath' | 'imagePath' | 'thumbPath'> | null | undefined,
  variant: ImageVariant,
) {
  return useImage(entry ? { entryId: entry.id, variant, driveId: driveIdOf(entry, variant) } : null);
}
