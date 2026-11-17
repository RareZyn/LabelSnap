import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { buildPdf } from '../src/lib/export/pdf';
import { buildDocx } from '../src/lib/export/docx';
import { toWinAnsi } from '../src/lib/export/winansi';
import { BUILT_IN_TEMPLATES } from '../src/lib/templates/builtins';
import { ExportCancelled, type ExportInput } from '../src/lib/export/types';

async function jpeg(w: number, h: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: '#f7f5ef' } }).jpeg().toBuffer();
  return new Uint8Array(buf);
}

async function input(count: number, overrides: Partial<ExportInput> = {}): Promise<ExportInput> {
  const bytes = await jpeg(400, 240);
  return {
    template: { ...BUILT_IN_TEMPLATES[1] },
    documentTitle: 'Greek Yogurt — Batch 12 Trial',
    dateText: '2026-11-17',
    items: Array.from({ length: count }, (_, i) => ({
      caption: `Sealed cup ${i + 1}, Lot FT-2024-118`,
      footnote: i === 0 ? 'Stored 4 °C; pH 4.6 at sampling, 5 µL aliquot.' : '',
      ocrText: i === 1 ? '' : 'GREEK YOGURT PLAIN\nLOT FT-2024-118',
      image: { bytes, width: 400, height: 240 },
    })),
    includeOcrAppendix: true,
    labels: {
      figureWords: { figure: 'Figure', fig: 'Fig.', plate: 'Plate', image: 'Image' },
      appendixTitle: 'Appendix — Recognised label text',
      noText: '(no text recognised)',
    },
    signal: new AbortController().signal,
    onProgress: () => undefined,
    ...overrides,
  };
}

describe('PDF export', () => {
  it('lays out figures by the Template and appends the OCR appendix', async () => {
    const progress: string[] = [];
    const bytes = await buildPdf(await input(3, { onProgress: (d, t, p) => progress.push(`${p}:${d}/${t}`) }));
    const pdf = await PDFDocument.load(bytes);
    // Two-up: 3 figures → 2 pages, plus 1 appendix page.
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(progress).toContain('render:3/3');
    expect(progress).toContain('appendix:3/3');
  });

  it('honours landscape and images per page', async () => {
    const i = await input(6, { includeOcrAppendix: false });
    const bytes = await buildPdf({ ...i, template: { ...i.template, orientation: 'landscape', imagesPerPage: 6 } });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize().width).toBeGreaterThan(pdf.getPage(0).getSize().height);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildPdf(await input(2, { signal: controller.signal }))).rejects.toBeInstanceOf(ExportCancelled);
  });

  it('transliterates text the standard fonts cannot encode', () => {
    expect(toWinAnsi('5 μL ≤ 10 → ok — “fine” 4 °C')).toBe('5 µL <= 10 -> ok — “fine” 4 °C');
    expect(toWinAnsi('漢')).toBe('?');
  });
});

describe('.docx export', () => {
  it('produces an editable Word file with captions, a real footnote and the appendix', async () => {
    const blob = await buildDocx(await input(3));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file('word/document.xml')!.async('string');
    const notes = await zip.file('word/footnotes.xml')!.async('string');
    expect(doc).toContain('Figure 1 — Sealed cup 1, Lot FT-2024-118');
    expect(doc).toContain('Figure 3 — Sealed cup 3');
    expect(doc).toContain('w:footnoteReference');
    expect(doc).toContain('Appendix — Recognised label text');
    expect(doc).toContain('(no text recognised)');
    expect(notes).toContain('Stored 4 °C; pH 4.6 at sampling');
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });
});
