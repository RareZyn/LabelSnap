// Label / document quadrilateral detection on a small grayscale frame (~320 px), with no OpenCV.
// Two strategies are tried and the best valid quad wins:
//   1. Edge enclosure: Sobel edges, closed by dilation; regions not reachable from the frame border are enclosed.
//   2. Intensity: Otsu threshold, both polarities; the largest blob not spanning the frame.
// Each candidate region's convex hull is simplified to four corners and validated.

import type { Point, Quad } from '../../data/types';
import { isConvex, orderCorners, polygonArea } from './homography';

export interface DetectOptions {
  minAreaRatio?: number;
  maxAreaRatio?: number;
}

function blur(gray: Uint8ClampedArray, w: number, h: number): Float32Array {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += gray[y * w + xx] * k[i + 2];
      }
      tmp[y * w + x] = s / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp[yy * w + x] * k[i + 2];
      }
      out[y * w + x] = s / 16;
    }
  }
  return out;
}

function sobel(img: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -img[i - w - 1] - 2 * img[i - 1] - img[i + w - 1] + img[i - w + 1] + 2 * img[i + 1] + img[i + w + 1];
      const gy =
        -img[i - w - 1] - 2 * img[i - w] - img[i - w + 1] + img[i + w - 1] + 2 * img[i + w] + img[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function percentileF(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** Flood fill from every border pixel through pixels where passable[i] is 1. */
function floodFromBorder(passable: Uint8Array, w: number, h: number): Uint8Array {
  const reached = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (passable[i] && !reached[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return reached;
}

interface Component {
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  rows: Map<number, [number, number]>;
}

function components(mask: Uint8Array, w: number, h: number, minCount: number): Component[] {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const out: Component[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const c: Component = { count: 0, minX: w, maxX: 0, minY: h, maxY: 0, rows: new Map() };
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      c.count++;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      const r = c.rows.get(y);
      if (!r) c.rows.set(y, [x, x]);
      else {
        if (x < r[0]) r[0] = x;
        if (x > r[1]) r[1] = x;
      }
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of nb) {
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (c.count >= minCount) out.push(c);
  }
  return out.sort((a, b) => b.count - a.count);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Reduces a convex polygon to four vertices by repeatedly dropping the vertex that loses the least area. */
export function simplifyToQuad(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null;
  const pts = [...hull];
  while (pts.length > 4) {
    let minArea = Infinity;
    let minIdx = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs(cross(a, b, c)) / 2;
      if (area < minArea) {
        minArea = area;
        minIdx = i;
      }
    }
    pts.splice(minIdx, 1);
  }
  return pts;
}

function cornerAnglesOk(q: Point[]): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (deg < 40 || deg > 140) return false;
  }
  return true;
}

interface Candidate {
  quad: Point[];
  score: number;
}

/** Moves corners toward the centroid: the edge strategy's blur and dilation grow the region by ~2 px. */
function inset(quad: Point[], px: number): Point[] {
  const cx = quad.reduce((a, p) => a + p.x, 0) / quad.length;
  const cy = quad.reduce((a, p) => a + p.y, 0) / quad.length;
  return quad.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((cx - p.x) / d) * px, y: p.y + ((cy - p.y) / d) * px };
  });
}

function candidateFrom(
  c: Component,
  w: number,
  h: number,
  opts: Required<DetectOptions>,
  insetPx = 0,
): Candidate | null {
  const edgePts: Point[] = [];
  for (const [y, [x0, x1]] of c.rows) {
    edgePts.push({ x: x0, y }, { x: x1 + 1, y }, { x: x0, y: y + 1 }, { x: x1 + 1, y: y + 1 });
  }
  const hull = convexHull(edgePts);
  const quad = simplifyToQuad(hull);
  if (!quad) return null;
  const hullArea = polygonArea(hull);
  const quadArea = polygonArea(quad);
  const frameArea = w * h;
  const ratio = quadArea / frameArea;
  if (ratio < opts.minAreaRatio || ratio > opts.maxAreaRatio) return null;
  if (quadArea / hullArea < 0.86) return null; // round or irregular shape, not a label
  if (c.count / hullArea < 0.55) return null; // open region, not an enclosed one
  if (!isConvex(quad) || !cornerAnglesOk(quad)) return null;
  return { quad: insetPx ? inset(quad, insetPx) : quad, score: quadArea * (quadArea / hullArea) };
}

function otsu(img: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.length; i++) hist[Math.max(0, Math.min(255, Math.round(img[i])))]++;
  const total = img.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function touchesBorders(c: Component, w: number, h: number): number {
  return (c.minX <= 0 ? 1 : 0) + (c.minY <= 0 ? 1 : 0) + (c.maxX >= w - 1 ? 1 : 0) + (c.maxY >= h - 1 ? 1 : 0);
}

/** Detects the dominant label quad. Returns corners normalised to 0–1 (TL, TR, BR, BL), or null. */
export function detectQuad(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  options: DetectOptions = {},
): Quad | null {
  const opts: Required<DetectOptions> = { minAreaRatio: 0.06, maxAreaRatio: 0.97, ...options };
  const minCount = Math.round(w * h * opts.minAreaRatio * 0.5);
  const smooth = blur(gray, w, h);
  const candidates: Candidate[] = [];

  // Strategy 1: edge enclosure.
  const mag = sobel(smooth, w, h);
  const thr = Math.max(18, percentileF(mag, 0.85));
  let edges = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) edges[i] = mag[i] >= thr ? 1 : 0;
  edges = dilate(edges, w, h);
  const open = new Uint8Array(w * h);
  for (let i = 0; i < open.length; i++) open[i] = edges[i] ? 0 : 1;
  const outside = floodFromBorder(open, w, h);
  const enclosed = new Uint8Array(w * h);
  for (let i = 0; i < enclosed.length; i++) enclosed[i] = outside[i] ? 0 : 1;
  for (const c of components(enclosed, w, h, minCount).slice(0, 3)) {
    const cand = candidateFrom(c, w, h, opts, 4);
    if (cand) candidates.push(cand);
  }

  // Strategy 2: intensity blobs, both polarities.
  const t = otsu(smooth);
  for (const bright of [true, false]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = (smooth[i] > t) === bright ? 1 : 0;
    for (const c of components(mask, w, h, minCount).slice(0, 2)) {
      if (touchesBorders(c, w, h) >= 3) continue;
      const cand = candidateFrom(c, w, h, opts, 2);
      if (cand) candidates.push({ ...cand, score: cand.score * 0.9 });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const ordered = orderCorners(candidates[0].quad);
  return ordered.map((p) => ({ x: Math.min(1, Math.max(0, p.x / w)), y: Math.min(1, Math.max(0, p.y / h)) })) as Quad;
}

export const FULL_FRAME: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Exponential smoothing between consecutive detections, to stop the live overlay jittering. */
export function smoothQuad(prev: Quad | null, next: Quad, alpha = 0.45): Quad {
  if (!prev) return next;
  const moved = next.some((p, i) => Math.hypot(p.x - prev[i].x, p.y - prev[i].y) > 0.15);
  if (moved) return next;
  return next.map((p, i) => ({
    x: prev[i].x + (p.x - prev[i].x) * alpha,
    y: prev[i].y + (p.y - prev[i].y) * alpha,
  })) as Quad;
}
