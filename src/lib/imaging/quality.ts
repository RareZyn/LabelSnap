// Pre-save quality checks: blur, underexposure and glare.

import type { QualityFlag } from '../../data/types';

export interface QualityReport {
  flags: QualityFlag[];
  sharpness: number;
  meanLuminance: number;
  glarePercent: number;
}

export const BLUR_THRESHOLD = 40;
export const DARK_THRESHOLD = 60;
export const GLARE_THRESHOLD = 0.06;

/** Variance of the Laplacian: low values mean few sharp edges, i.e. a blurred image. */
export function laplacianVariance(gray: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Analyses a grayscale image (ideally downscaled to ~512 px on the long side). */
export function assessQuality(gray: Uint8ClampedArray, w: number, h: number): QualityReport {
  const sharpness = laplacianVariance(gray, w, h);
  let total = 0;
  let clipped = 0;
  for (let i = 0; i < gray.length; i++) {
    total += gray[i];
    if (gray[i] >= 252) clipped++;
  }
  const meanLuminance = gray.length ? total / gray.length : 0;
  const glareFraction = gray.length ? clipped / gray.length : 0;
  const flags: QualityFlag[] = [];
  if (sharpness < BLUR_THRESHOLD) flags.push('blur');
  if (meanLuminance < DARK_THRESHOLD) flags.push('dark');
  if (glareFraction > GLARE_THRESHOLD) flags.push('glare');
  return { flags, sharpness, meanLuminance, glarePercent: Math.round(glareFraction * 100) };
}
