// .docx export: one borderless table per page from the shared layout engine, so the document stays
// editable in a word processor. Footnotes are real Word footnotes.

import {
  AlignmentType,
  BorderStyle,
  Document,
  FootnoteReferenceRun,
  Footer,
  Header,
  ImageRun,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
} from 'docx';
import type { FontFamily } from '../../data/types';
import { computeLayout, fitContain, MARGIN, PAGE_SIZES } from '../templates/layout';
import { slotTexts } from '../templates/render';
import { expandTokens } from '../templates/tokens';
import { yieldToUi, type ExportInput } from './types';

const WORD_FONTS: Record<FontFamily, string> = { Helvetica: 'Arial', Times: 'Times New Roman', Courier: 'Courier New' };
const twips = (pt: number) => Math.round(pt * 20);
const px = (pt: number) => Math.round((pt * 96) / 72);
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

/** Header/footer runs, with live page fields for {page} and {pages}. */
function bandRuns(template: string, ctx: { document: string; date: string }, font: string, size: number) {
  const parts = template.split(/(\{page\}|\{pages\})/);
  const children: Array<TextRun> = [];
  for (const part of parts) {
    if (part === '{page}') children.push(new TextRun({ children: [PageNumber.CURRENT], font, size }));
    else if (part === '{pages}') children.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size }));
    else if (part) {
      const text = expandTokens(part, { document: ctx.document, date: ctx.date });
      // expandTokens tidies separators; keep surrounding spaces next to page fields.
      const lead = /^\s/.test(part) ? ' ' : '';
      const trail = /\s$/.test(part) ? ' ' : '';
      if (text) children.push(new TextRun({ text: `${lead}${text}${trail}`, font, size, color: '777777' }));
    }
  }
  return children;
}

export async function buildDocx(input: ExportInput): Promise<Blob> {
  const { template: s, items, signal } = input;
  const layout = computeLayout(s, items.length);
  const texts = slotTexts(items, s.numberingScheme, input.labels.figureWords);
  const capFont = WORD_FONTS[s.captionFont];
  const bodyFont = WORD_FONTS[s.bodyFont];
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  const children: Array<Paragraph | Table> = [];
  const right = s.captionPosition === 'right';
  const colsPerItem = right ? 2 : 1;
  let done = 0;

  for (const page of layout.pages) {
    if (page.index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    const rows: TableRow[] = [];
    for (let r = 0; r < layout.rows; r++) {
      const cells: TableCell[] = [];
      for (let c = 0; c < layout.cols; c++) {
        const slot = page.slots[r * layout.cols + c];
        if (!slot) {
          for (let k = 0; k < colsPerItem; k++) cells.push(new TableCell({ children: [new Paragraph('')], borders: NO_BORDERS }));
          continue;
        }
        const item = items[slot.entryIndex];
        const text = texts[slot.entryIndex];
        const fit = fitContain(slot.image, item.image.width, item.image.height);
        const imagePara = new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: 'jpg',
              data: item.image.bytes,
              transformation: { width: px(fit.w), height: px(fit.h) },
              altText: { name: text.line.slice(0, 60), description: text.line, title: text.label || text.line.slice(0, 60) },
            }),
          ],
        });
        const capRuns: Array<TextRun | FootnoteReferenceRun> = [
          new TextRun({ text: text.line, bold: true, font: capFont, size: s.captionFontSize * 2 }),
        ];
        if (text.footnoteNo) {
          footnotes[text.footnoteNo] = {
            children: [new Paragraph({ children: [new TextRun({ text: text.footnote, font: bodyFont, size: s.bodyFontSize * 2 })] })],
          };
          capRuns.push(new FootnoteReferenceRun(text.footnoteNo));
        }
        const captionOpts: IParagraphOptions = { children: capRuns, spacing: { before: 60, after: 60 } };
        const captionPara = new Paragraph(captionOpts);
        const width = { size: twips(slot.cell.w / colsPerItem), type: WidthType.DXA };
        if (right) {
          cells.push(new TableCell({ children: [imagePara], borders: NO_BORDERS, width, verticalAlign: VerticalAlign.CENTER }));
          cells.push(new TableCell({ children: [captionPara], borders: NO_BORDERS, width, verticalAlign: VerticalAlign.CENTER }));
        } else {
          cells.push(
            new TableCell({
              children: s.captionPosition === 'above' ? [captionPara, imagePara] : [imagePara, captionPara],
              borders: NO_BORDERS,
              width,
              verticalAlign: VerticalAlign.TOP,
            }),
          );
        }
        done++;
        input.onProgress(done, items.length, 'render');
        await yieldToUi(signal);
      }
      rows.push(new TableRow({ children: cells, cantSplit: true }));
    }
    children.push(
      new Table({
        rows,
        borders: NO_BORDERS,
        layout: TableLayoutType.FIXED,
        width: { size: twips(layout.pageWidth - 2 * MARGIN), type: WidthType.DXA },
      }),
    );
  }

  if (input.includeOcrAppendix) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: input.labels.appendixTitle, bold: true, font: capFont, size: (s.captionFontSize + 3) * 2 })],
        spacing: { after: 240 },
      }),
    );
    items.forEach((item, i) => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: texts[i].line, bold: true, font: 'Courier New', size: (s.bodyFontSize + 1) * 2 })],
          spacing: { before: 160, after: 60 },
          keepNext: true,
        }),
      );
      const body = item.ocrText.trim() || input.labels.noText;
      for (const line of body.split('\n')) {
        children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New', size: s.bodyFontSize * 2, color: '555555' })] }));
      }
      input.onProgress(i + 1, items.length, 'appendix');
    });
  }

  const size = PAGE_SIZES[s.pageSize];
  const bandSize = Math.max(6, s.bodyFontSize - 1) * 2;
  const doc = new Document({
    creator: 'LabelSnap',
    title: input.documentTitle,
    footnotes,
    styles: { default: { document: { run: { font: bodyFont, size: s.bodyFontSize * 2 } } } },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: twips(size.w),
              height: twips(size.h),
              orientation: s.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: twips(MARGIN + 6), bottom: twips(MARGIN + 6), left: twips(MARGIN), right: twips(MARGIN), header: twips(MARGIN / 2), footer: twips(MARGIN / 2) },
          },
        },
        headers: s.headerText.trim()
          ? { default: new Header({ children: [new Paragraph({ children: bandRuns(s.headerText, { document: input.documentTitle, date: input.dateText }, bodyFont, bandSize) })] }) }
          : undefined,
        footers: s.footerText.trim()
          ? {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: bandRuns(s.footerText, { document: input.documentTitle, date: input.dateText }, bodyFont, bandSize),
                  }),
                ],
              }),
            }
          : undefined,
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
