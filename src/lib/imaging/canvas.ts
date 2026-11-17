// Canvas helpers that work both in a Worker (OffscreenCanvas) and on the main thread.

import type { Raster } from './raster';

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: AnyCanvas): AnyContext {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as AnyContext | null;
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return ctx;
}

export async function encodeJpeg(c: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  );
}

export async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}

export function fitSize(w: number, h: number, maxDim: number): { w: number; h: number } {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export function rasterFromBitmap(bmp: ImageBitmap | HTMLVideoElement | HTMLCanvasElement, w: number, h: number): Raster {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

export async function rasterToJpeg(r: Raster, quality: number): Promise<Blob> {
  const c = makeCanvas(r.width, r.height);
  const ctx = ctx2d(c);
  ctx.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  return encodeJpeg(c, quality);
}

/** Re-encodes an image to fit maxDim. */
export async function resizeJpeg(
  blob: Blob,
  maxDim: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await decode(blob);
  const { w, h } = fitSize(bmp.width, bmp.height, maxDim);
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { blob: await encodeJpeg(c, quality), width: w, height: h };
}
