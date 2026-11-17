import { localDb } from '../db/dexie';
import { downloadedLanguages } from '../ocr/ocrService';

export interface StorageUsage {
  usage: number;
  quota: number;
  images: number;
  imagesUnsynced: number;
  imagesEvictable: number;
  ocrData: number;
}

export const QUOTA_WARNING_RATIO = 0.8;

export async function storageUsage(): Promise<StorageUsage> {
  let usage = 0;
  let quota = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch {
    /* not supported */
  }
  let images = 0;
  let imagesUnsynced = 0;
  let imagesEvictable = 0;
  await localDb.image_blobs.each((row) => {
    images += row.byteSize;
    if (row.uploaded) {
      if (row.variant !== 'thumb') imagesEvictable += row.byteSize;
    } else imagesUnsynced += row.byteSize;
  });
  const langs = await downloadedLanguages();
  const ocrData = Object.values(langs).reduce((a, b) => a + b, 0);
  return { usage, quota, images, imagesUnsynced, imagesEvictable, ocrData };
}

/** Removes already-uploaded originals and derived images from the device. Thumbnails stay for lists. */
export async function evictUploadedImages(): Promise<number> {
  let freed = 0;
  const keys: string[] = [];
  await localDb.image_blobs
    .where('uploaded')
    .equals(1)
    .each((row) => {
      if (row.variant === 'thumb') return;
      keys.push(row.key);
      freed += row.byteSize;
    });
  await localDb.image_blobs.bulkDelete(keys);
  return freed;
}

/** Asks the browser not to evict our storage. Best effort; matters most on iOS. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number, locale?: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}
