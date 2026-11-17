// The PDF standard fonts encode text as WinAnsi (Windows-1252). Characters outside it are transliterated.

const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const MAP: Record<string, string> = {
  'μ': 'µ',
  '≤': '<=',
  '≥': '>=',
  '→': '->',
  '←': '<-',
  '≈': '~',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '′': "'",
  '″': '"',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '℃': '°C',
  '⁰': '0',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
};

export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.includes(ch);
}

export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (ch === '\n' || ch === '\t') out += ch === '\t' ? ' ' : ch;
    else if (isWinAnsi(ch)) out += ch;
    else if (MAP[ch]) out += MAP[ch];
    else {
      const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += stripped && [...stripped].every(isWinAnsi) ? stripped : '?';
    }
  }
  return out;
}
