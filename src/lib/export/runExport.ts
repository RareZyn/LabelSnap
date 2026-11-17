// Export orchestration: checks every image is on the device, prepares them at the chosen resolution,
// then renders PDF or .docx.

import type { Entry, ExportFormat, ExportResolution, TemplateSettings } from '../../data/types';
import { getImage } from '../db/dexie';
import { getEntryBlob } from '../images';
import { resizeJpeg } from '../imaging/canvas';
import { yieldToUi, type ExportInput, type ExportItem } from './types';

export const RESOLUTION: Record<ExportResolution, { maxDim: number; quality: number }> = {
  low: { maxDim: 1200, quality: 0.72 },
  medium: { maxDim: 2000, quality: 0.82 },
  high: { maxDim: 3000, quality: 0.9 },
};

type ExportEntry = Pick<
  Entry,
  'id' | 'caption' | 'footnote' | 'width' | 'height' | 'ocrTextCache' | 'originalImagePath' | 'imagePath' | 'thumbPath'
>;

/** Entries whose derived image is not on this device (export would fail). */
export async function missingImages(entries: ExportEntry[]): Promise<ExportEntry[]> {
  const out: ExportEntry[] = [];
  for (const e of entries) if (!(await getImage(e.id, 'derived'))) out.push(e);
  return out;
}

/** Downloads missing derived images from Drive. Returns those still missing. */
export async function fetchMissing(entries: ExportEntry[], onProgress?: (done: number) => void): Promise<ExportEntry[]> {
  const still: ExportEntry[] = [];
  let done = 0;
  for (const e of entries) {
    if (!(await getEntryBlob(e, 'derived'))) still.push(e);
    onProgress?.(++done);
  }
  return still;
}

/** Rough output size: JPEG at these settings averages ~0.12–0.2 bytes per pixel. */
export function estimateBytes(entries: Array<Pick<Entry, 'width' | 'height'>>, resolution: ExportResolution): number {
  const { maxDim, quality } = RESOLUTION[resolution];
  const bpp = 0.08 + quality * 0.12;
  return entries.reduce((sum, e) => {
    const scale = Math.min(1, maxDim / Math.max(e.width || 1, e.height || 1));
    return sum + (e.width || 1600) * scale * (e.height || 1200) * scale * bpp;
  }, 40_000);
}

export interface RunExportOptions {
  format: ExportFormat;
  resolution: ExportResolution;
  includeOcrAppendix: boolean;
  template: TemplateSettings;
  documentTitle: string;
  dateText: string;
  entries: ExportEntry[];
  ocrTexts: Map<string, string>;
  labels: ExportInput['labels'];
  signal: AbortSignal;
  onProgress: (fraction: number, label: { phase: 'prepare' | 'render' | 'appendix'; done: number; total: number }) => void;
}

export async function runExport(o: RunExportOptions): Promise<Blob> {
  const { maxDim, quality } = RESOLUTION[o.resolution];
  const items: ExportItem[] = [];
  const total = o.entries.length;
  // Preparing images is ~60% of the work, rendering the rest.
  for (let i = 0; i < total; i++) {
    const e = o.entries[i];
    const row = await getImage(e.id, 'derived');
    if (!row) throw new Error(`missing:${e.id}`);
    const r = await resizeJpeg(row.blob, maxDim, quality);
    items.push({
      caption: e.caption,
      footnote: e.footnote,
      ocrText: o.ocrTexts.get(e.id) ?? e.ocrTextCache ?? '',
      image: { bytes: new Uint8Array(await r.blob.arrayBuffer()), width: r.width, height: r.height },
    });
    o.onProgress(((i + 1) / total) * 0.6, { phase: 'prepare', done: i + 1, total });
    await yieldToUi(o.signal);
  }
  const input: ExportInput = {
    template: o.template,
    documentTitle: o.documentTitle,
    dateText: o.dateText,
    items,
    includeOcrAppendix: o.includeOcrAppendix,
    labels: o.labels,
    signal: o.signal,
    onProgress: (done, t, phase) =>
      o.onProgress(phase === 'render' ? 0.6 + (done / t) * (o.includeOcrAppendix ? 0.3 : 0.4) : 0.9 + (done / t) * 0.1, {
        phase,
        done,
        total: t,
      }),
  };
  if (o.format === 'pdf') {
    const { buildPdf } = await import('./pdf');
    const bytes = await buildPdf(input);
    return new Blob([bytes], { type: 'application/pdf' });
  }
  const { buildDocx } = await import('./docx');
  return buildDocx(input);
}
