import type { TemplateSettings } from '../../data/types';

export interface ExportImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface ExportItem {
  caption: string;
  footnote: string;
  ocrText: string;
  image: ExportImage;
}

export interface ExportInput {
  template: TemplateSettings;
  documentTitle: string;
  dateText: string;
  items: ExportItem[];
  includeOcrAppendix: boolean;
  labels: {
    figureWords: { figure: string; fig: string; plate: string; image: string };
    appendixTitle: string;
    noText: string;
  };
  signal: AbortSignal;
  onProgress: (done: number, total: number, phase: 'render' | 'appendix') => void;
}

export class ExportCancelled extends Error {
  constructor() {
    super('export-cancelled');
  }
}

/** Gives the browser a frame between chunks of work, and honours cancellation. */
export async function yieldToUi(signal: AbortSignal): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  if (signal.aborted) throw new ExportCancelled();
}
