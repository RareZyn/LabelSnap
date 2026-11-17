// Export filename patterns. Tokens: {title} {date} {time} {count} {format}.

export const DEFAULT_FILENAME_PATTERN = '{title}_{date}';

export function compactTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80);
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildFilename(
  pattern: string,
  ctx: { title: string; date: Date; count: number; format: 'pdf' | 'docx' },
): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const values: Record<string, string> = {
    title: compactTitle(ctx.title) || 'LabelSnap',
    date: isoDate(ctx.date),
    time: `${p(ctx.date.getHours())}${p(ctx.date.getMinutes())}`,
    count: String(ctx.count),
    format: ctx.format.toUpperCase(),
  };
  const base = (pattern || DEFAULT_FILENAME_PATTERN)
    .replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  return `${base || 'LabelSnap'}.${ctx.format}`;
}
