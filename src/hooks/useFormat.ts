import { useCallback, useMemo } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { useSession } from '../stores/sessionStore';
import type { DateFormat } from '../data/types';

type DateLike = Date | Timestamp | number | null | undefined;

export function toDate(d: DateLike): Date | null {
  if (!d) return null;
  if (d instanceof Date) return d;
  if (typeof d === 'number') return new Date(d);
  if (typeof (d as Timestamp).toDate === 'function') return (d as Timestamp).toDate();
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: Date, format: DateFormat, locale: string): string {
  switch (format) {
    case 'dmy':
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    case 'mdy':
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
    case 'long':
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    default:
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

export function formatTime(d: Date, h24: boolean, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: !h24 }).format(d);
}

export function useFormat() {
  const prefs = useSession((s) => s.prefs);
  const locale = prefs.locale || navigator.language;
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);

  const date = useCallback((d: DateLike) => {
    const v = toDate(d);
    return v ? formatDate(v, prefs.dateFormat, locale) : '';
  }, [prefs.dateFormat, locale]);

  const time = useCallback((d: DateLike) => {
    const v = toDate(d);
    return v ? formatTime(v, prefs.timeFormat24h, locale) : '';
  }, [prefs.timeFormat24h, locale]);

  const relative = useCallback(
    (d: DateLike) => {
      const v = toDate(d);
      if (!v) return '';
      const sec = (v.getTime() - Date.now()) / 1000;
      const abs = Math.abs(sec);
      if (abs < 60) return rtf.format(Math.round(sec), 'second');
      if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
      if (abs < 86400 * 7) return rtf.format(Math.round(sec / 86400), 'day');
      if (abs < 86400 * 30) return rtf.format(Math.round(sec / (86400 * 7)), 'week');
      return formatDate(v, prefs.dateFormat, locale);
    },
    [rtf, prefs.dateFormat, locale],
  );

  return { date, time, relative, locale };
}
