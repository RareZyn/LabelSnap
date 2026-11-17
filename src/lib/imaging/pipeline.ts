// Original → derived image: perspective crop, rotation, straighten, enhancement filter, quality report.

import type { ImageFilter, Quad } from '../../data/types';
import { decode, fitSize, makeCanvas, ctx2d, encodeJpeg, rasterFromBitmap, rasterToJpeg } from './canvas';
import { rectifiedSize } from './homography';
import { applyFilter, downscaleGray, rotate90, straighten as straightenRaster, toGray, warpPerspective } from './raster';
import { assessQuality, type QualityReport } from './quality';
import { detectQuad } from './detect';

export interface ProcessParams {
  blob: Blob;
  quad: Quad | null;
  rotation: number;
  straighten: number;
  filter: ImageFilter;
  maxDim: number;
  quality: number;
  withThumb?: boolean;
}

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
  report: QualityReport;
  thumb?: Blob;
}

/** Long side the source is decoded at before warping: enough detail for OCR without exhausting memory. */
const SOURCE_MAX = 3200;

export async function processImage(p: ProcessParams): Promise<ProcessResult> {
  const bmp = await decode(p.blob);
  const src = fitSize(bmp.width, bmp.height, Math.max(p.maxDim * 1.25, Math.min(SOURCE_MAX, p.maxDim * 2)));
  const raster = rasterFromBitmap(bmp, src.w, src.h);
  bmp.close();

  const quad = p.quad ?? [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const px = quad.map((q) => ({ x: q.x * (src.w - 1), y: q.y * (src.h - 1) }));
  const size = rectifiedSize(px, p.maxDim);
  let out = warpPerspective(raster, px, size.w, size.h);
  out = rotate90(out, Math.round(p.rotation / 90));
  out = straightenRaster(out, p.straighten);

  const small = downscaleGray(toGray(out), out.width, out.height, 512);
  const report = assessQuality(small.gray, small.width, small.height);

  out = applyFilter(out, p.filter);
  const blob = await rasterToJpeg(out, p.quality);
  let thumb: Blob | undefined;
  if (p.withThumb) {
    const t = fitSize(out.width, out.height, 320);
    const c = makeCanvas(out.width, out.height);
    ctx2d(c).putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
    const tc = makeCanvas(t.w, t.h);
    const tctx = ctx2d(tc);
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(c as CanvasImageSource, 0, 0, t.w, t.h);
    thumb = await encodeJpeg(tc, 0.75);
  }
  return { blob, width: out.width, height: out.height, report, thumb };
}

/** Detects the label quad on a still image (used on import and on the shutter frame). */
export async function detectInBlob(blob: Blob): Promise<Quad | null> {
  const bmp = await decode(blob);
  const { w, h } = fitSize(bmp.width, bmp.height, 320);
  const r = rasterFromBitmap(bmp, w, h);
  bmp.close();
  return detectQuad(toGray(r), w, h);
}
