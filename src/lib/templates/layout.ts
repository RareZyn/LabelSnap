// The single layout engine. The Template live preview, page-preview tab, print view, PDF and .docx exports
// all place Entries with these boxes, so every output agrees. Units are PDF points, origin top-left.

import type { NumberingScheme, Orientation, PageSize, TemplateSettings } from '../../data/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSlot {
  /** Index into the Entry list passed to the layout. */
  entryIndex: number;
  /** 1-based figure number. */
  figure: number;
  cell: Rect;
  image: Rect;
  caption: Rect;
}

export interface LayoutPage {
  index: number;
  header: Rect | null;
  footer: Rect | null;
  slots: LayoutSlot[];
}

export interface Layout {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  cols: number;
  rows: number;
  pages: LayoutPage[];
}

export const PAGE_SIZES: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
};

export const MARGIN = 42;
const BAND = 14;
const BAND_GAP = 10;
const GAP = 16;
const CAPTION_GAP = 6;

export function pageDimensions(size: PageSize, orientation: Orientation): { w: number; h: number } {
  const s = PAGE_SIZES[size];
  return orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

export function gridFor(perPage: number, orientation: Orientation): { cols: number; rows: number } {
  const portrait = orientation === 'portrait';
  switch (perPage) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return portrait ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return portrait ? { cols: 2, rows: 3 } : { cols: 3, rows: 2 };
    default:
      return { cols: 1, rows: 1 };
  }
}

/** Height reserved for a caption block under or over an image. */
export function captionBlockHeight(s: Pick<TemplateSettings, 'captionFontSize' | 'bodyFontSize'>): number {
  return s.captionFontSize * 1.25 * 3 + s.bodyFontSize * 1.25 * 2 + 4;
}

export function computeLayout(
  s: Pick<
    TemplateSettings,
    | 'pageSize'
    | 'orientation'
    | 'imagesPerPage'
    | 'captionPosition'
    | 'headerText'
    | 'footerText'
    | 'captionFontSize'
    | 'bodyFontSize'
  >,
  entryCount: number,
  opts: { minPages?: number } = {},
): Layout {
  const { w: pageWidth, h: pageHeight } = pageDimensions(s.pageSize, s.orientation);
  const { cols, rows } = gridFor(s.imagesPerPage, s.orientation);
  const perPage = cols * rows;
  const pageCount = Math.max(opts.minPages ?? 0, Math.ceil(entryCount / perPage));

  const header = s.headerText.trim() ? { x: MARGIN, y: MARGIN - BAND, w: pageWidth - 2 * MARGIN, h: BAND } : null;
  const footer = s.footerText.trim() ? { x: MARGIN, y: pageHeight - MARGIN, w: pageWidth - 2 * MARGIN, h: BAND } : null;

  const top = MARGIN + (header ? BAND_GAP : 0);
  const bottom = pageHeight - MARGIN - (footer ? BAND_GAP : 0);
  const contentW = pageWidth - 2 * MARGIN;
  const contentH = bottom - top;
  const cellW = (contentW - GAP * (cols - 1)) / cols;
  const cellH = (contentH - GAP * (rows - 1)) / rows;
  const capH = captionBlockHeight(s);

  const pages: LayoutPage[] = [];
  for (let p = 0; p < pageCount; p++) {
    const slots: LayoutSlot[] = [];
    for (let i = 0; i < perPage; i++) {
      const entryIndex = p * perPage + i;
      if (entryIndex >= entryCount && entryCount > 0) break;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cell = { x: MARGIN + col * (cellW + GAP), y: top + row * (cellH + GAP), w: cellW, h: cellH };
      let image: Rect;
      let caption: Rect;
      if (s.captionPosition === 'right') {
        const capW = Math.min(cell.w * 0.4, 220);
        image = { x: cell.x, y: cell.y, w: cell.w - capW - CAPTION_GAP * 2, h: cell.h };
        caption = { x: cell.x + image.w + CAPTION_GAP * 2, y: cell.y, w: capW, h: cell.h };
      } else if (s.captionPosition === 'above') {
        caption = { x: cell.x, y: cell.y, w: cell.w, h: capH };
        image = { x: cell.x, y: cell.y + capH + CAPTION_GAP, w: cell.w, h: cell.h - capH - CAPTION_GAP };
      } else {
        image = { x: cell.x, y: cell.y, w: cell.w, h: cell.h - capH - CAPTION_GAP };
        caption = { x: cell.x, y: cell.y + image.h + CAPTION_GAP, w: cell.w, h: capH };
      }
      slots.push({ entryIndex, figure: entryIndex + 1, cell, image, caption });
    }
    pages.push({ index: p, header, footer, slots });
  }
  return { pageWidth, pageHeight, margin: MARGIN, cols, rows, pages };
}

/** The largest rectangle with the image's aspect ratio that fits in a box, centred horizontally. */
export function fitContain(box: Rect, imgW: number, imgH: number, align: 'top' | 'center' | 'bottom' = 'center'): Rect {
  if (imgW <= 0 || imgH <= 0) return { ...box };
  const scale = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const y = align === 'top' ? box.y : align === 'bottom' ? box.y + box.h - h : box.y + (box.h - h) / 2;
  return { x: box.x + (box.w - w) / 2, y, w, h };
}

export const DEFAULT_FIGURE_WORDS: Record<Exclude<NumberingScheme, 'none'>, string> = {
  figure: 'Figure',
  fig: 'Fig.',
  plate: 'Plate',
  image: 'Image',
};

export function figureLabel(
  scheme: NumberingScheme,
  n: number,
  words: Record<Exclude<NumberingScheme, 'none'>, string> = DEFAULT_FIGURE_WORDS,
): string {
  if (scheme === 'none') return '';
  return `${words[scheme]} ${n}`;
}

/** The caption line as printed: "Figure 3 — Sealed cup". */
export function captionLine(label: string, caption: string): string {
  const c = caption.trim();
  if (!label) return c;
  return c ? `${label} — ${c}` : label;
}
