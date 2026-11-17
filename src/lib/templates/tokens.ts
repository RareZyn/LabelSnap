// Caption-template and header/footer token expansion.
// Tokens: {index} {date} {time} {ocr} {barcode} {document} {page} {pages} and any custom field key.

export interface TokenContext {
  index?: number;
  date?: string;
  time?: string;
  ocr?: string;
  barcode?: string;
  document?: string;
  page?: number;
  pages?: number;
  fields?: Record<string, string | undefined>;
}

const TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

export function listTokens(template: string): string[] {
  return Array.from(template.matchAll(TOKEN_RE), (m) => m[1]);
}

/** First meaningful line of OCR text, used by the {ocr} token. */
export function ocrHeadline(text: string | undefined, max = 80): string {
  if (!text) return '';
  const line =
    text
      .split(/\r?\n/)
      // OCR reads label borders and shadows as stray bars and brackets at line ends.
      .map((l) => l.replace(/^[\s|[\]{}_~=]+|[\s|[\]{}_~=]+$/g, ''))
      .find((l) => l.replace(/[^a-zA-Z0-9]/g, '').length >= 3) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function valueFor(name: string, ctx: TokenContext): string {
  switch (name) {
    case 'index':
      return ctx.index != null ? String(ctx.index) : '';
    case 'date':
      return ctx.date ?? '';
    case 'time':
      return ctx.time ?? '';
    case 'ocr':
      return ocrHeadline(ctx.ocr);
    case 'barcode':
      return ctx.barcode ?? '';
    case 'document':
      return ctx.document ?? '';
    case 'page':
      return ctx.page != null ? String(ctx.page) : '';
    case 'pages':
      return ctx.pages != null ? String(ctx.pages) : '';
    default:
      return ctx.fields?.[name] ?? '';
  }
}

/** Removes the debris left by empty tokens: "()", doubled separators, leading/trailing punctuation. */
export function tidy(text: string): string {
  let out = text;
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/\(\s*\)|\[\s*\]/g, '')
      .replace(/\s*([,;·|—–-])\s*(?=[,;·|—–-])/g, '')
      .replace(/\s{2,}/g, ' ');
  }
  return out.replace(/^[\s,;·|—–:-]+|[\s,;·|—–:-]+$/g, '').trim();
}

export function expandTokens(template: string, ctx: TokenContext): string {
  if (!template) return '';
  return tidy(template.replace(TOKEN_RE, (_, name: string) => valueFor(name, ctx)));
}
