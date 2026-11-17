// On-device OCR with Tesseract.js. Tesseract runs in its own Web Worker, so recognition never blocks the
// UI or the shutter. Language data is downloaded on first use and cached in IndexedDB by Tesseract.

import type { Worker as TesseractWorker } from 'tesseract.js';
import type { OcrBlock, OcrWord } from '../../data/types';
import { kvGet, kvSet } from '../db/dexie';

export const OCR_ENGINE = 'tesseract.js@5';
const LANG_DATA_URL = (lang: string) =>
  `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
const DOWNLOADED_KEY = 'ocr:downloaded';
const TESSERACT_CACHE_DB = 'keyval-store';

export interface OcrProgress {
  phase: 'loading' | 'recognizing';
  progress: number;
}

export interface OcrOutput {
  text: string;
  confidence: number;
  words: OcrWord[];
  blocks: OcrBlock[];
  languages: string[];
  durationMs: number;
}

export interface OcrRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Tesseract language codes offered in Settings, with BCP-47 equivalents for display names. */
export const OCR_LANGUAGES: Array<{ code: string; bcp47: string }> = [
  { code: 'eng', bcp47: 'en' },
  { code: 'deu', bcp47: 'de' },
  { code: 'fra', bcp47: 'fr' },
  { code: 'spa', bcp47: 'es' },
  { code: 'ita', bcp47: 'it' },
  { code: 'por', bcp47: 'pt' },
  { code: 'nld', bcp47: 'nl' },
  { code: 'pol', bcp47: 'pl' },
  { code: 'swe', bcp47: 'sv' },
  { code: 'dan', bcp47: 'da' },
  { code: 'nor', bcp47: 'no' },
  { code: 'fin', bcp47: 'fi' },
  { code: 'ces', bcp47: 'cs' },
  { code: 'tur', bcp47: 'tr' },
  { code: 'ell', bcp47: 'el' },
  { code: 'rus', bcp47: 'ru' },
  { code: 'ukr', bcp47: 'uk' },
  { code: 'ind', bcp47: 'id' },
  { code: 'msa', bcp47: 'ms' },
  { code: 'vie', bcp47: 'vi' },
  { code: 'tha', bcp47: 'th' },
  { code: 'hin', bcp47: 'hi' },
  { code: 'ara', bcp47: 'ar' },
  { code: 'heb', bcp47: 'he' },
  { code: 'chi_sim', bcp47: 'zh-Hans' },
  { code: 'chi_tra', bcp47: 'zh-Hant' },
  { code: 'jpn', bcp47: 'ja' },
  { code: 'kor', bcp47: 'ko' },
];

export function languageName(code: string, locale = navigator.language): string {
  const bcp = OCR_LANGUAGES.find((l) => l.code === code)?.bcp47 ?? code;
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(bcp) ?? code;
  } catch {
    return code;
  }
}

let worker: TesseractWorker | null = null;
let workerLangs = '';
let progressCb: ((p: OcrProgress) => void) | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function getWorker(langs: string[]): Promise<TesseractWorker> {
  const key = langs.join('+');
  if (worker && workerLangs === key) return worker;
  const { createWorker } = await import('tesseract.js');
  const logger = (m: { status: string; progress: number }) => {
    if (!progressCb) return;
    if (m.status === 'recognizing text') progressCb({ phase: 'recognizing', progress: m.progress });
    else progressCb({ phase: 'loading', progress: m.progress });
  };
  if (worker) {
    await worker.reinitialize(key);
  } else {
    worker = await createWorker(key, 1, { logger });
  }
  workerLangs = key;
  const downloaded = (await kvGet<Record<string, number>>(DOWNLOADED_KEY)) ?? {};
  let changed = false;
  for (const l of langs) {
    if (!(l in downloaded)) {
      downloaded[l] = (await languageDownloadSize(l)) ?? 0;
      changed = true;
    }
  }
  if (changed) await kvSet(DOWNLOADED_KEY, downloaded);
  return worker;
}

/** Recognises text. Jobs are serialised through one worker. */
export function recognize(
  image: Blob,
  opts: { languages: string[]; rectangle?: OcrRect; onProgress?: (p: OcrProgress) => void },
): Promise<OcrOutput> {
  const langs = opts.languages.length ? opts.languages : ['eng'];
  const run = async (): Promise<OcrOutput> => {
    const started = performance.now();
    progressCb = opts.onProgress ?? null;
    try {
      const w = await getWorker(langs);
      const { data } = await w.recognize(image, opts.rectangle ? { rectangle: opts.rectangle } : {}, {
        text: true,
        blocks: true,
        hocr: false,
        tsv: false,
      });
      const words: OcrWord[] = (data.words ?? []).map((wd) => ({
        text: wd.text,
        confidence: Math.round(wd.confidence),
        bbox: wd.bbox,
      }));
      const blocks: OcrBlock[] = (data.blocks ?? []).map((b) => ({
        text: b.text,
        confidence: Math.round(b.confidence),
        bbox: b.bbox,
      }));
      return {
        text: data.text.trim(),
        confidence: Math.round(data.confidence),
        words,
        blocks,
        languages: langs,
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      progressCb = null;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

export async function terminateOcr(): Promise<void> {
  const w = worker;
  worker = null;
  workerLangs = '';
  await w?.terminate();
}

export async function downloadedLanguages(): Promise<Record<string, number>> {
  return (await kvGet<Record<string, number>>(DOWNLOADED_KEY)) ?? {};
}

export async function isLanguageCached(code: string): Promise<boolean> {
  return code in (await downloadedLanguages());
}

/** Size in bytes of a language's data file, read from the CDN without downloading it. */
export async function languageDownloadSize(code: string): Promise<number | null> {
  try {
    const res = await fetch(LANG_DATA_URL(code), { method: 'HEAD' });
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

export function isMeteredConnection(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } })
    .connection;
  if (!c) return false;
  return Boolean(c.saveData) || c.type === 'cellular' || ['slow-2g', '2g', '3g'].includes(c.effectiveType ?? '');
}

/** Deletes cached language data (re-downloaded on next use). */
export async function clearOcrData(): Promise<void> {
  await terminateOcr();
  await kvSet(DOWNLOADED_KEY, {});
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(TESSERACT_CACHE_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
