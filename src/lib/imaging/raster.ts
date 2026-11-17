// Pixel operations on plain RGBA buffers. Pure functions: they run in a Worker or on the main thread.

import type { ImageFilter, Point } from '../../data/types';
import { computeHomography } from './homography';

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function createRaster(width: number, height: number): Raster {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

export function toGray(src: Raster): Uint8ClampedArray {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return out;
}

/** Bilinear sample of one RGBA pixel; outside the image returns white. */
function sample(src: Raster, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const { data, width, height } = src;
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
    out[o] = out[o + 1] = out[o + 2] = 255;
    out[o + 3] = 255;
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
    const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
  out[o + 3] = 255;
}

/** Rectifies the quadrilateral `quad` (pixel corners TL, TR, BR, BL) into an outW × outH image. */
export function warpPerspective(src: Raster, quad: Point[], outW: number, outH: number): Raster {
  const dst = createRaster(outW, outH);
  const rect = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  const H = computeHomography(rect, quad);
  const out = dst.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const d = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / d;
      const sy = (H[3] * x + H[4] * y + H[5]) / d;
      sample(src, sx, sy, out, (y * outW + x) * 4);
    }
  }
  return dst;
}

/** Rotates by a multiple of 90° exactly. */
export function rotate90(src: Raster, quarterTurns: number): Raster {
  const k = ((quarterTurns % 4) + 4) % 4;
  if (k === 0) return src;
  const { width: w, height: h, data } = src;
  const dw = k % 2 ? h : w;
  const dh = k % 2 ? w : h;
  const dst = createRaster(dw, dh);
  const out = dst.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (k === 1) {
        nx = h - 1 - y;
        ny = x;
      } else if (k === 2) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      const si = (y * w + x) * 4;
      const di = (ny * dw + nx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 255;
    }
  }
  return dst;
}

/** Rotates by a small free angle and zooms just enough that no empty corners show. */
export function straighten(src: Raster, degrees: number): Raster {
  if (Math.abs(degrees) < 0.05) return src;
  const { width: w, height: h } = src;
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const scale = Math.max(
    (w * Math.abs(cos) + h * Math.abs(sin)) / w,
    (w * Math.abs(sin) + h * Math.abs(cos)) / h,
  );
  const dst = createRaster(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Inverse map: undo zoom, then undo rotation.
      const dx = (x - cx) / scale;
      const dy = (y - cy) / scale;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      sample(src, sx, sy, dst.data, (y * w + x) * 4);
    }
  }
  return dst;
}

function histogram(gray: Uint8ClampedArray): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

export function applyFilter(src: Raster, filter: ImageFilter): Raster {
  if (filter === 'none') return src;
  const { width, height } = src;
  const data = new Uint8ClampedArray(src.data);
  const gray = toGray(src);
  if (filter === 'greyscale') {
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) data[i] = data[i + 1] = data[i + 2] = gray[j];
  } else if (filter === 'autoContrast') {
    const hist = histogram(gray);
    const lo = percentile(hist, gray.length, 0.01);
    const hi = percentile(hist, gray.length, 0.99);
    const range = Math.max(1, hi - lo);
    const f = 255 / range;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (data[i] - lo) * f;
      data[i + 1] = (data[i + 1] - lo) * f;
      data[i + 2] = (data[i + 2] - lo) * f;
    }
  } else if (filter === 'bw') {
    // Bradley adaptive threshold over an integral image: robust to uneven bench lighting.
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y++) {
      let rowSum = 0;
      for (let x = 1; x <= width; x++) {
        rowSum += gray[(y - 1) * width + (x - 1)];
        integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
      }
    }
    const s = Math.max(8, Math.round(Math.max(width, height) / 16));
    const half = s >> 1;
    const t = 0.15;
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(height - 1, y + half);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - half);
        const x1 = Math.min(width - 1, x + half);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum =
          integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
          integral[y0 * (width + 1) + (x1 + 1)] -
          integral[(y1 + 1) * (width + 1) + x0] +
          integral[y0 * (width + 1) + x0];
        const v = gray[y * width + x] * count < sum * (1 - t) ? 0 : 255;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
  }
  return { data, width, height };
}

/** Nearest-neighbour-free box downscale of a grayscale buffer to fit maxDim (area average). */
export function downscaleGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  maxDim: number,
): { gray: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale >= 1) return { gray, width, height };
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h);
  const sx = width / w;
  const sy = height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += gray[yy * width + xx];
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { gray: out, width: w, height: h };
}
