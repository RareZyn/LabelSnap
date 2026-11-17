// PDF export, laid out by the shared layout engine. Rendered in chunks with progress and cancellation.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { FontFamily } from '../../data/types';
import { computeLayout, fitContain, MARGIN, type Rect } from '../templates/layout';
import { bandText, slotTexts } from '../templates/render';
import { toWinAnsi } from './winansi';
import { yieldToUi, type ExportInput } from './types';

const FONT_FILES: Record<FontFamily, { regular: StandardFonts; bold: StandardFonts; italic: StandardFonts }> = {
  Helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, italic: StandardFonts.HelveticaOblique },
  Times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, italic: StandardFonts.TimesRomanItalic },
  Courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold, italic: StandardFonts.CourierOblique },
};

const INK = rgb(0.13, 0.13, 0.13);
const GREY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.47, 0.47, 0.47);

/** Greedy word wrap using real font metrics; very long words are broken by character. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of toWinAnsi(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    lines.push(line);
  }
  return lines;
}

function clampLines(lines: string[], max: number, font: PDFFont, size: number, width: number): string[] {
  if (lines.length <= max) return lines;
  const out = lines.slice(0, Math.max(1, max));
  let last = out[out.length - 1];
  while (last && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
  out[out.length - 1] = `${last}…`;
  return out;
}

export async function buildPdf(input: ExportInput): Promise<Uint8Array> {
  const { template: s, items, signal } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(toWinAnsi(input.documentTitle));
  pdf.setCreator('LabelSnap');
  pdf.setProducer('LabelSnap');
  const capFonts = FONT_FILES[s.captionFont];
  const bodyFonts = FONT_FILES[s.bodyFont];
  const capBold = await pdf.embedFont(capFonts.bold);
  const body = await pdf.embedFont(bodyFonts.regular);
  const bodyItalic = await pdf.embedFont(bodyFonts.italic);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold);

  const layout = computeLayout(s, items.length);
  const texts = slotTexts(items, s.numberingScheme, input.labels.figureWords);
  const { pageWidth: W, pageHeight: H } = layout;
  const toPdfY = (r: Rect) => H - r.y - r.h;
  const totalPages = layout.pages.length;
  let done = 0;

  const drawBands = (page: PDFPage, index: number, pages: number) => {
    const ctx = { document: input.documentTitle, page: index + 1, pages, date: input.dateText };
    const size = Math.max(6, s.bodyFontSize - 1);
    const headerRect = layout.pages[0]?.header;
    const footerRect = layout.pages[0]?.footer;
    if (s.headerText.trim()) {
      const text = clampLines(wrapText(bandText(s.headerText, ctx), body, size, W - 2 * MARGIN), 1, body, size, W - 2 * MARGIN)[0];
      const y = headerRect ? H - headerRect.y - size : H - MARGIN + 6;
      page.drawText(text, { x: MARGIN, y, size, font: body, color: LIGHT });
    }
    if (s.footerText.trim()) {
      const text = clampLines(wrapText(bandText(s.footerText, ctx), body, size, W - 2 * MARGIN), 1, body, size, W - 2 * MARGIN)[0];
      const tw = body.widthOfTextAtSize(text, size);
      const y = footerRect ? H - footerRect.y - size : MARGIN - 14;
      page.drawText(text, { x: (W - tw) / 2, y, size, font: body, color: LIGHT });
    }
  };

  const appendixPages: PDFPage[] = [];
  const figurePages: PDFPage[] = [];

  for (const lp of layout.pages) {
    const page = pdf.addPage([W, H]);
    figurePages.push(page);
    for (const slot of lp.slots) {
      const item = items[slot.entryIndex];
      const text = texts[slot.entryIndex];
      const align = s.captionPosition === 'below' ? 'bottom' : s.captionPosition === 'above' ? 'top' : 'center';
      const fit = fitContain(slot.image, item.image.width, item.image.height, align);
      const img = await pdf.embedJpg(item.image.bytes);
      page.drawImage(img, { x: fit.x, y: toPdfY(fit), width: fit.w, height: fit.h });

      // Caption block: caption line (bold) with footnote marker, then the footnote (smaller, grey).
      const c = slot.caption;
      const capSize = s.captionFontSize;
      const capLead = capSize * 1.25;
      const noteSize = s.bodyFontSize;
      const noteLead = noteSize * 1.25;
      const marker = text.footnoteNo ? String(text.footnoteNo) : '';
      const markerW = marker ? capBold.widthOfTextAtSize(marker, capSize * 0.62) + 1 : 0;
      const maxCapLines = Math.max(1, Math.floor((c.h - (text.footnote ? noteLead * 2 : 0)) / capLead));
      const capLines = clampLines(wrapText(text.line, capBold, capSize, c.w - markerW), maxCapLines, capBold, capSize, c.w - markerW);
      let y = H - c.y - capSize;
      capLines.forEach((line, i) => {
        page.drawText(line, { x: c.x, y, size: capSize, font: capBold, color: INK });
        if (marker && i === capLines.length - 1) {
          page.drawText(marker, {
            x: c.x + capBold.widthOfTextAtSize(line, capSize) + 1,
            y: y + capSize * 0.38,
            size: capSize * 0.62,
            font: capBold,
            color: INK,
          });
        }
        y -= capLead;
      });
      if (text.footnote) {
        const remaining = Math.max(1, Math.floor((y - (H - c.y - c.h)) / noteLead) + 1);
        const noteLines = clampLines(wrapText(`${marker} ${text.footnote}`, bodyItalic, noteSize, c.w), remaining, bodyItalic, noteSize, c.w);
        y -= 1;
        for (const line of noteLines) {
          page.drawText(line, { x: c.x, y, size: noteSize, font: bodyItalic, color: GREY });
          y -= noteLead;
        }
      }
      done++;
      input.onProgress(done, items.length, 'render');
      await yieldToUi(signal);
    }
  }

  if (input.includeOcrAppendix) {
    const size = s.bodyFontSize;
    const lead = size * 1.35;
    const width = W - 2 * MARGIN;
    let page = pdf.addPage([W, H]);
    appendixPages.push(page);
    let y = H - MARGIN - 14;
    page.drawText(toWinAnsi(input.labels.appendixTitle), { x: MARGIN, y, size: s.captionFontSize + 3, font: capBold, color: INK });
    y -= (s.captionFontSize + 3) * 2;
    const newPage = () => {
      page = pdf.addPage([W, H]);
      appendixPages.push(page);
      y = H - MARGIN - 14;
    };
    for (let i = 0; i < items.length; i++) {
      const heading = texts[i].line;
      const body = items[i].ocrText.trim() || input.labels.noText;
      const lines = wrapText(body, mono, size, width);
      if (y - lead * 2 < MARGIN + 10) newPage();
      for (const hl of wrapText(heading, monoBold, size + 1, width)) {
        page.drawText(hl, { x: MARGIN, y, size: size + 1, font: monoBold, color: INK });
        y -= lead;
      }
      for (const line of lines) {
        if (y < MARGIN + 10) newPage();
        page.drawText(line, { x: MARGIN, y, size, font: mono, color: GREY });
        y -= lead;
      }
      y -= lead * 0.8;
      input.onProgress(i + 1, items.length, 'appendix');
      if (i % 10 === 9) await yieldToUi(signal);
    }
  }

  const all = [...figurePages, ...appendixPages];
  all.forEach((p, i) => drawBands(p, i, all.length || totalPages));
  return pdf.save();
}
