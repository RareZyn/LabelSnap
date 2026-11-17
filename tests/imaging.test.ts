import { describe, expect, it } from 'vitest';
import { applyHomography, computeHomography, orderCorners, rectifiedSize } from '../src/lib/imaging/homography';
import { applyFilter, createRaster, rotate90, straighten, toGray, warpPerspective } from '../src/lib/imaging/raster';
import { detectQuad, simplifyToQuad, convexHull } from '../src/lib/imaging/detect';
import { assessQuality } from '../src/lib/imaging/quality';
import type { Point } from '../src/data/types';

/** Point-in-convex-quad test, for drawing synthetic labels. */
function inside(q: Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const s = Math.sign(c);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function syntheticFrame(w: number, h: number, quad: Point[], bg = 60, fg = 235, noise = 8) {
  const gray = new Uint8ClampedArray(w * h);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = inside(quad, x + 0.5, y + 0.5) ? fg : bg;
      // Some "text" lines inside the label.
      if (v === fg && y % 14 < 2 && x % 9 < 6) v = 40;
      gray[y * w + x] = v + rand() * noise;
    }
  }
  return gray;
}

describe('homography', () => {
  it('maps the four corners exactly', () => {
    const from = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const to = [
      { x: 12, y: 8 },
      { x: 180, y: 30 },
      { x: 170, y: 140 },
      { x: 5, y: 120 },
    ];
    const H = computeHomography(from, to);
    from.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo(to[i].x, 6);
      expect(q.y).toBeCloseTo(to[i].y, 6);
    });
  });

  it('orders corners clockwise from top-left', () => {
    const pts = [
      { x: 90, y: 95 },
      { x: 10, y: 5 },
      { x: 5, y: 90 },
      { x: 95, y: 10 },
    ];
    expect(orderCorners(pts)).toEqual([
      { x: 10, y: 5 },
      { x: 95, y: 10 },
      { x: 90, y: 95 },
      { x: 5, y: 90 },
    ]);
  });

  it('sizes the rectified output and respects the cap', () => {
    const quad = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(rectifiedSize(quad, 1000)).toEqual({ w: 400, h: 200 });
    expect(rectifiedSize(quad, 200)).toEqual({ w: 200, h: 100 });
  });
});

describe('raster ops', () => {
  it('rectifies a skewed bright quad into a uniformly bright image', () => {
    const w = 200;
    const h = 160;
    const quad = [
      { x: 40, y: 30 },
      { x: 170, y: 45 },
      { x: 160, y: 130 },
      { x: 30, y: 120 },
    ];
    const src = createRaster(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = inside(quad, x + 0.5, y + 0.5) ? 240 : 20;
        const i = (y * w + x) * 4;
        src.data[i] = src.data[i + 1] = src.data[i + 2] = v;
        src.data[i + 3] = 255;
      }
    const out = warpPerspective(src, quad, 120, 80);
    const g = toGray(out);
    // Sample away from the edges: should all be the bright label.
    let min = 255;
    for (let y = 8; y < 72; y++) for (let x = 8; x < 112; x++) min = Math.min(min, g[y * 120 + x]);
    expect(min).toBeGreaterThan(200);
  });

  it('rotates by quarter turns', () => {
    const src = createRaster(3, 2);
    src.data.set([255, 0, 0, 255], 0); // red at (0,0)
    const r = rotate90(src, 1);
    expect([r.width, r.height]).toEqual([2, 3]);
    // (0,0) rotates clockwise to (h-1, 0) = (1, 0).
    expect(r.data[(0 * 2 + 1) * 4]).toBe(255);
    expect(rotate90(src, 4)).toBe(src);
  });

  it('straightens without leaving white corners on a uniform image', () => {
    const src = createRaster(60, 40);
    src.data.fill(100);
    const out = straighten(src, 6);
    const g = toGray(out);
    expect(g[0]).toBeLessThan(150);
    expect(g[g.length - 1]).toBeLessThan(150);
  });

  it('thresholds to pure black and white', () => {
    const src = createRaster(32, 32);
    for (let i = 0; i < 32 * 32; i++) {
      const v = (i % 32) < 16 ? 30 : 220;
      src.data.set([v, v, v, 255], i * 4);
    }
    const bw = applyFilter(src, 'bw');
    const values = new Set(Array.from(toGray(bw)));
    for (const v of values) expect([0, 255]).toContain(v);
    const ac = applyFilter(src, 'autoContrast');
    const g = toGray(ac);
    expect(Math.min(...g)).toBeLessThan(10);
    expect(Math.max(...g)).toBeGreaterThan(245);
  });
});

describe('detection', () => {
  it('simplifies a hull to four corners', () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      pts.push({ x: i * 5, y: 0 }, { x: i * 5, y: 50 }, { x: 0, y: i * 2.5 }, { x: 100, y: i * 2.5 });
    }
    const q = simplifyToQuad(convexHull(pts))!;
    expect(q).toHaveLength(4);
    expect(orderCorners(q)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it('finds a rotated label on a dark bench', () => {
    const w = 320;
    const h = 240;
    const quad = [
      { x: 70, y: 50 },
      { x: 250, y: 70 },
      { x: 240, y: 190 },
      { x: 60, y: 175 },
    ];
    const found = detectQuad(syntheticFrame(w, h, quad), w, h);
    expect(found).not.toBeNull();
    found!.forEach((p, i) => {
      expect(Math.abs(p.x * w - quad[i].x)).toBeLessThan(8);
      expect(Math.abs(p.y * h - quad[i].y)).toBeLessThan(8);
    });
  });

  it('finds a dark label on a light background', () => {
    const w = 320;
    const h = 240;
    const quad = [
      { x: 100, y: 60 },
      { x: 230, y: 60 },
      { x: 230, y: 180 },
      { x: 100, y: 180 },
    ];
    const found = detectQuad(syntheticFrame(w, h, quad, 230, 50), w, h);
    expect(found).not.toBeNull();
    expect(Math.abs(found![0].x * w - 100)).toBeLessThan(8);
  });

  it('returns null for a featureless frame', () => {
    const w = 160;
    const h = 120;
    const gray = new Uint8ClampedArray(w * h).fill(128);
    expect(detectQuad(gray, w, h)).toBeNull();
  });
});

describe('quality', () => {
  it('flags blur, darkness and glare', () => {
    const w = 100;
    const h = 100;
    const sharp = new Uint8ClampedArray(w * h);
    for (let i = 0; i < sharp.length; i++) sharp[i] = (i % 2) ^ (Math.floor(i / w) % 2) ? 200 : 60;
    expect(assessQuality(sharp, w, h).flags).not.toContain('blur');

    const flat = new Uint8ClampedArray(w * h).fill(140);
    expect(assessQuality(flat, w, h).flags).toContain('blur');

    const dark = new Uint8ClampedArray(w * h).fill(20);
    expect(assessQuality(dark, w, h).flags).toContain('dark');

    const glare = new Uint8ClampedArray(w * h).fill(150);
    glare.fill(255, 0, 2000);
    const r = assessQuality(glare, w, h);
    expect(r.flags).toContain('glare');
    expect(r.glarePercent).toBe(20);
  });
});
