// Named-field extraction from recognised label text (lot, batch, expiry, catalogue number, CAS number).

import type { FieldPatternKey } from '../../data/types';

const ID = '([A-Z0-9][A-Z0-9\\-/.]{2,24})';
const MONTHS = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC';
const DATE =
  `(\\d{4}[-/.]\\d{1,2}(?:[-/.]\\d{1,2})?` +
  `|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}` +
  `|\\d{1,2}\\s?(?:${MONTHS})[A-Z]*\\.?\\s?\\d{2,4}` +
  `|(?:${MONTHS})[A-Z]*\\.?\\s?\\d{4}` +
  `|\\d{1,2}[-/.]\\d{4})`;

export const FIELD_PATTERNS: Record<FieldPatternKey, RegExp> = {
  lot: new RegExp(`\\b(?:LOT|LOT\\s*NO\\.?|LOT\\s*NUMBER)\\s*[:#.]?\\s*${ID}`, 'i'),
  batch: new RegExp(`\\b(?:BATCH|BATCH\\s*NO\\.?|B/N|BN)\\s*[:#.]?\\s*${ID}`, 'i'),
  expiry: new RegExp(
    `\\b(?:EXP(?:IRY|IRES|\\.)?(?:\\s*DATE)?|USE\\s*BY|BEST\\s*BEFORE(?:\\s*END)?|BB(?:E)?|BBD)\\s*[:.]?\\s*${DATE}`,
    'i',
  ),
  catalogue: new RegExp(
    `\\b(?:CAT(?:ALOG(?:UE)?)?\\.?\\s*(?:NO\\.?|#|NUMBER)?|REF|P/N|PART\\s*NO\\.?)\\s*[:#.]?\\s*${ID}`,
    'i',
  ),
  cas: /\b(\d{2,7}-\d{2}-\d)\b/,
};

/** CAS registry numbers carry a check digit: weighted sum of the other digits, mod 10. */
export function isValidCas(cas: string): boolean {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
  if (!m) return false;
  const digits = (m[1] + m[2]).split('').reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * (i + 1), 0);
  return sum % 10 === Number(m[3]);
}

const MONTH_INDEX: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Normalises unambiguous dates to ISO (YYYY-MM-DD or YYYY-MM). Ambiguous day/month orders are kept as printed. */
export function normaliseDate(raw: string): string {
  const s = raw.trim().toUpperCase();
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    if (Number(mo) > 12) return raw;
    return d ? `${y}-${pad(Number(mo))}-${pad(Number(d))}` : `${y}-${pad(Number(mo))}`;
  }
  m = /^(\d{1,2})\s?([A-Z]{3})[A-Z]*\.?\s?(\d{2,4})$/.exec(s);
  if (m && MONTH_INDEX[m[2]]) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(MONTH_INDEX[m[2]])}-${pad(Number(m[1]))}`;
  }
  m = /^([A-Z]{3})[A-Z]*\.?\s?(\d{4})$/.exec(s);
  if (m && MONTH_INDEX[m[1]]) return `${m[2]}-${pad(MONTH_INDEX[m[1]])}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m && Number(m[1]) <= 12) return `${m[2]}-${pad(Number(m[1]))}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    // Only one reading is a valid calendar date: use it.
    if (a > 12 && b <= 12) return `${year}-${pad(b)}-${pad(a)}`;
    if (b > 12 && a <= 12) return `${year}-${pad(a)}-${pad(b)}`;
  }
  return raw.trim();
}

function cleanId(v: string): string {
  return v.replace(/[.\-/]+$/, '');
}

/** Extracts every known field from OCR text. OCR often reads O for 0 in numeric positions; that is left to review. */
export function extractFields(text: string): Partial<Record<FieldPatternKey, string>> {
  const out: Partial<Record<FieldPatternKey, string>> = {};
  if (!text) return out;
  const flat = text.replace(/\r/g, '');

  const lot = FIELD_PATTERNS.lot.exec(flat);
  if (lot) out.lot = cleanId(lot[1]);

  const batch = FIELD_PATTERNS.batch.exec(flat);
  if (batch) out.batch = cleanId(batch[1]);

  const exp = FIELD_PATTERNS.expiry.exec(flat);
  if (exp) out.expiry = normaliseDate(exp[1]);

  const cat = FIELD_PATTERNS.catalogue.exec(flat);
  if (cat) out.catalogue = cleanId(cat[1]);

  const casRe = new RegExp(FIELD_PATTERNS.cas.source, 'g');
  for (const m of flat.matchAll(casRe)) {
    if (isValidCas(m[1])) {
      out.cas = m[1];
      break;
    }
  }
  return out;
}
