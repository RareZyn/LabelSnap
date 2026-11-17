// Text shared by every output (preview, print, PDF, .docx): figure labels, caption lines, footnote numbers.

import type { NumberingScheme } from '../../data/types';
import { captionLine, DEFAULT_FIGURE_WORDS, figureLabel } from './layout';
import { expandTokens } from './tokens';

export interface SlotText {
  figure: number;
  label: string;
  caption: string;
  line: string;
  /** Sequential across the Document, counting only Entries that have a footnote. */
  footnoteNo: number | null;
  footnote: string;
}

export function slotTexts(
  entries: Array<{ caption: string; footnote: string }>,
  scheme: NumberingScheme,
  words: Record<Exclude<NumberingScheme, 'none'>, string> = DEFAULT_FIGURE_WORDS,
): SlotText[] {
  let fn = 0;
  return entries.map((e, i) => {
    const label = figureLabel(scheme, i + 1, words);
    const caption = e.caption?.trim() ?? '';
    const footnote = e.footnote?.trim() ?? '';
    return {
      figure: i + 1,
      label,
      caption,
      line: captionLine(label, caption),
      footnoteNo: footnote ? ++fn : null,
      footnote,
    };
  });
}

export function bandText(template: string, ctx: { document: string; page: number; pages: number; date: string }): string {
  return expandTokens(template, ctx);
}
