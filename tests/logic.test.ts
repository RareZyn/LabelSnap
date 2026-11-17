import { describe, expect, it } from 'vitest';
import { figureNumbers, needsRebalance, orderBetween, orderForMove, rebalance, ORDER_STEP } from '../src/lib/order';
import { expandTokens, ocrHeadline, tidy } from '../src/lib/templates/tokens';
import { captionLine, computeLayout, figureLabel, fitContain, gridFor } from '../src/lib/templates/layout';
import { BUILT_IN_TEMPLATES, fieldKeyFromLabel, resolveTemplate } from '../src/lib/templates/builtins';
import { extractFields, isValidCas, normaliseDate } from '../src/lib/ocr/fieldPatterns';
import { backoffDelay, isPermanentFailure, MAX_DELAY_MS } from '../src/lib/sync/backoff';
import { buildFilename, compactTitle } from '../src/lib/export/filename';
import type { ImagesPerPage, TemplateSettings } from '../src/data/types';

describe('order', () => {
  it('places between, before and after neighbours', () => {
    expect(orderBetween(1024, 2048)).toBe(1536);
    expect(orderBetween(1024, null)).toBe(1024 + ORDER_STEP);
    expect(orderBetween(null, 1024)).toBe(0);
    expect(orderBetween(undefined, undefined)).toBe(ORDER_STEP);
  });

  it('computes the order for a drag move with one write', () => {
    const items = [1, 2, 3, 4].map((n) => ({ id: `e${n}`, order: n * 1024 }));
    // Move first item to the end.
    expect(orderForMove(items, 0, 3)).toBe(4 * 1024 + ORDER_STEP);
    // Move last item to the front.
    expect(orderForMove(items, 3, 0)).toBe(0);
    // Move item 0 to position 1: lands between e2 and e3.
    expect(orderForMove(items, 0, 1)).toBe((2048 + 3072) / 2);
    expect(orderForMove(items, 2, 2)).toBeNull();
  });

  it('renumbers figures from order and rebalances', () => {
    const items = [
      { id: 'a', order: 30 },
      { id: 'b', order: 10 },
      { id: 'c', order: 20 },
    ];
    const n = figureNumbers(items);
    expect([n.get('b'), n.get('c'), n.get('a')]).toEqual([1, 2, 3]);
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
    expect(needsRebalance(1, 2)).toBe(false);
    expect(rebalance(items).map((r) => r.order)).toEqual([1024, 2048, 3072]);
  });
});

describe('caption tokens', () => {
  it('expands tokens and custom fields', () => {
    const out = expandTokens('Figure {index} - {ocr} ({date}) lot {lot}', {
      index: 3,
      date: '2026-11-17',
      ocr: 'GREEK YOGURT · PLAIN\nINGREDIENTS: milk',
      fields: { lot: 'FT-2024-118' },
    });
    expect(out).toBe('Figure 3 - GREEK YOGURT · PLAIN (2026-11-17) lot FT-2024-118');
  });

  it('cleans up after empty tokens', () => {
    expect(expandTokens('{ocr} ({date})', { date: '2026-11-17' })).toBe('(2026-11-17)');
    expect(expandTokens('{ocr} ({barcode})', { ocr: 'LABEL' })).toBe('LABEL');
    expect(tidy(' — Sealed cup , ')).toBe('Sealed cup');
  });

  it('picks the first meaningful OCR line', () => {
    expect(ocrHeadline('  \n-- \nNET WT 150 g\nmore')).toBe('NET WT 150 g');
    expect(ocrHeadline('x'.repeat(100), 10)).toHaveLength(10);
    expect(ocrHeadline('[EE\n| GREEK YOGURT PLAIN |\n')).toBe('GREEK YOGURT PLAIN');
  });
});

describe('layout', () => {
  const base: TemplateSettings = { ...BUILT_IN_TEMPLATES[1] };

  it('chooses grids per orientation', () => {
    expect(gridFor(2, 'portrait')).toEqual({ cols: 1, rows: 2 });
    expect(gridFor(2, 'landscape')).toEqual({ cols: 2, rows: 1 });
    expect(gridFor(6, 'portrait')).toEqual({ cols: 2, rows: 3 });
    expect(gridFor(6, 'landscape')).toEqual({ cols: 3, rows: 2 });
  });

  it.each([1, 2, 4, 6] as ImagesPerPage[])('paginates %i images per page', (n) => {
    const layout = computeLayout({ ...base, imagesPerPage: n }, 7);
    expect(layout.pages).toHaveLength(Math.ceil(7 / n));
    const all = layout.pages.flatMap((p) => p.slots);
    expect(all.map((s) => s.entryIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const s of all) {
      expect(s.image.x).toBeGreaterThanOrEqual(layout.margin - 0.01);
      expect(s.image.x + s.image.w).toBeLessThanOrEqual(layout.pageWidth - layout.margin + 0.01);
      expect(s.cell.y + s.cell.h).toBeLessThanOrEqual(layout.pageHeight - layout.margin + 0.01);
      expect(s.image.h).toBeGreaterThan(0);
    }
  });

  it.each(['above', 'below', 'right'] as const)('keeps caption %s inside the cell without overlap', (pos) => {
    const layout = computeLayout({ ...base, captionPosition: pos }, 2);
    for (const s of layout.pages[0].slots) {
      const { image: i, caption: c, cell } = s;
      const overlap = i.x < c.x + c.w && c.x < i.x + i.w && i.y < c.y + c.h && c.y < i.y + i.h;
      expect(overlap).toBe(false);
      expect(c.x + c.w).toBeLessThanOrEqual(cell.x + cell.w + 0.01);
      expect(c.y + c.h).toBeLessThanOrEqual(cell.y + cell.h + 0.01);
      if (pos === 'above') expect(c.y).toBeLessThan(i.y);
      if (pos === 'below') expect(c.y).toBeGreaterThan(i.y);
      if (pos === 'right') expect(c.x).toBeGreaterThan(i.x);
    }
  });

  it('shows one empty page for an empty preview', () => {
    expect(computeLayout(base, 0, { minPages: 1 }).pages).toHaveLength(1);
    expect(computeLayout(base, 0).pages).toHaveLength(0);
  });

  it('fits images and labels figures', () => {
    const r = fitContain({ x: 0, y: 0, w: 100, h: 100 }, 200, 100);
    expect(r).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(figureLabel('fig', 4)).toBe('Fig. 4');
    expect(figureLabel('none', 4)).toBe('');
    expect(captionLine('Figure 2', 'Lid seal')).toBe('Figure 2 — Lid seal');
    expect(captionLine('', 'Lid seal')).toBe('Lid seal');
    expect(captionLine('Plate 1', '')).toBe('Plate 1');
  });

  it('applies Document overrides over the Template', () => {
    const t = resolveTemplate({ templateId: 'builtin-single', templateOverrides: { imagesPerPage: 4 } }, []);
    expect(t.imagesPerPage).toBe(4);
    expect(t.name).toBe('Single large image');
    expect(fieldKeyFromLabel('Lot number', ['lot_number'])).toBe('lot_number_2');
  });
});

describe('field patterns', () => {
  const label = `GREEK YOGURT · PLAIN
INGREDIENTS: Cultured pasteurized milk
NET WT 150 g · LOT FT-2024-118
BEST BEFORE 2025-11-02`;

  it('extracts lot and expiry from a food label', () => {
    expect(extractFields(label)).toMatchObject({ lot: 'FT-2024-118', expiry: '2025-11-02' });
  });

  it('extracts reagent fields', () => {
    const text = `Sodium chloride ACS reagent
Cat. No. S9888-500G   Batch: SLCD1234
CAS 7647-14-5  EXP 03/2027`;
    const f = extractFields(text);
    expect(f.catalogue).toBe('S9888-500G');
    expect(f.batch).toBe('SLCD1234');
    expect(f.cas).toBe('7647-14-5');
    expect(f.expiry).toBe('2027-03');
  });

  it('validates CAS check digits', () => {
    expect(isValidCas('7732-18-5')).toBe(true); // water
    expect(isValidCas('7732-18-4')).toBe(false);
    expect(extractFields('ref 7732-18-4 only')).not.toHaveProperty('cas');
  });

  it('normalises unambiguous dates only', () => {
    expect(normaliseDate('2025/1/5')).toBe('2025-01-05');
    expect(normaliseDate('15 MAR 2026')).toBe('2026-03-15');
    expect(normaliseDate('MAR 2026')).toBe('2026-03');
    expect(normaliseDate('25/12/2026')).toBe('2026-12-25');
    expect(normaliseDate('05/06/2026')).toBe('05/06/2026');
  });
});

describe('backoff', () => {
  it('grows exponentially with jitter and caps', () => {
    expect(backoffDelay(1, () => 0.5)).toBe(2000);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    expect(backoffDelay(30, () => 1)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(2, () => 0)).toBe(3200);
    expect(isPermanentFailure(7)).toBe(false);
    expect(isPermanentFailure(8)).toBe(true);
  });
});

describe('filename', () => {
  it('builds safe names from patterns', () => {
    const date = new Date(2026, 10, 17, 9, 5);
    expect(buildFilename('{title}_{date}', { title: 'Greek Yogurt — Batch 12 Trial', date, count: 14, format: 'pdf' })).toBe(
      'Greek_Yogurt_-_Batch_12_Trial_2026-11-17.pdf',
    );
    expect(buildFilename('{title}-{time}', { title: 'a/b:c', date, count: 1, format: 'docx' })).toBe('abc-0905.docx');
    expect(buildFilename('', { title: '', date, count: 1, format: 'pdf' })).toBe('LabelSnap_2026-11-17.pdf');
    expect(compactTitle('Crème brûlée')).toBe('Creme_brulee');
  });
});
