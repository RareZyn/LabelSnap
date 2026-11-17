// Building blocks shared by the capture Review step and the saved-Entry editor.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomField, OcrWord, Quad } from '../../data/types';
import {
  isLanguageCached,
  isMeteredConnection,
  languageDownloadSize,
  languageName,
  recognize,
  type OcrOutput,
  type OcrProgress,
  type OcrRect,
} from '../../lib/ocr/ocrService';
import { formatBytes } from '../../lib/sync/quota';
import { useDictation } from '../../hooks/useDictation';
import { useSession } from '../../stores/sessionStore';
import { Icon } from '../../components/Icon';
import { Button, IconButton, Progress, TextField } from '../../components/ui';
import { toast } from '../../stores/toastStore';

export const LOW_CONFIDENCE = 70;

export type OcrStatus = 'idle' | 'confirm' | 'running' | 'done' | 'failed' | 'disabled';

export interface OcrRun {
  status: OcrStatus;
  progress: OcrProgress | null;
  output: OcrOutput | null;
  promise: Promise<OcrOutput> | null;
  downloadNote: string | null;
  region: Quad | null;
  run: (opts?: { rect?: OcrRect; region?: Quad | null; languages?: string[]; force?: boolean }) => void;
  confirmDownload: () => void;
  skip: () => void;
}

/** Runs OCR on a blob, asking first when language data must be downloaded over a metered connection. */
export function useOcrRun(blob: Blob | null, enabled: boolean, languages: string[], autoStart = true): OcrRun {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OcrStatus>(enabled ? 'idle' : 'disabled');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [output, setOutput] = useState<OcrOutput | null>(null);
  const [promise, setPromise] = useState<Promise<OcrOutput> | null>(null);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [region, setRegion] = useState<Quad | null>(null);
  const pending = useRef<{ rect?: OcrRect; region?: Quad | null; languages?: string[] } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    // Set on every mount: StrictMode mounts, unmounts and remounts in development.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(
    (opts: { rect?: OcrRect; region?: Quad | null; languages?: string[] } = {}) => {
      if (!blob) return;
      const langs = opts.languages ?? languages;
      setStatus('running');
      setProgress({ phase: 'loading', progress: 0 });
      setRegion(opts.region ?? null);
      const p = recognize(blob, {
        languages: langs,
        rectangle: opts.rect,
        onProgress: (pr) => alive.current && setProgress(pr),
      });
      setPromise(p);
      p.then((out) => {
        if (!alive.current) return;
        setOutput(out);
        setStatus('done');
        setDownloadNote(null);
      }).catch(() => alive.current && setStatus('failed'));
    },
    [blob, languages],
  );

  const run = useCallback(
    (opts: { rect?: OcrRect; region?: Quad | null; languages?: string[]; force?: boolean } = {}) => {
      const langs = opts.languages ?? languages;
      void (async () => {
        const missing: string[] = [];
        for (const l of langs) if (!(await isLanguageCached(l))) missing.push(l);
        if (!missing.length) return start(opts);
        const sizes = await Promise.all(missing.map(languageDownloadSize));
        const total = sizes.reduce<number>((a, b) => a + (b ?? 0), 0);
        const names = missing.map((l) => languageName(l)).join(', ');
        const size = total ? formatBytes(total) : t('ocr.unknownSize');
        if (!navigator.onLine) {
          setDownloadNote(t('ocr.offlineNoData', { names }));
          setStatus('failed');
          return;
        }
        setDownloadNote(t('ocr.downloadNote', { names, size }));
        if (isMeteredConnection() && !opts.force) {
          pending.current = opts;
          setStatus('confirm');
          return;
        }
        start(opts);
      })();
    },
    [languages, start, t],
  );

  const autoStarted = useRef<Blob | null>(null);
  useEffect(() => {
    if (enabled && autoStart && blob && autoStarted.current !== blob) {
      autoStarted.current = blob;
      run();
    }
    if (!enabled) setStatus('disabled');
    // Start once per image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, enabled]);

  return {
    status,
    progress,
    output,
    promise,
    downloadNote,
    region,
    run,
    confirmDownload: () => start(pending.current ?? {}),
    skip: () => setStatus('idle'),
  };
}

/** Recognised text with low-confidence words underlined. */
function HighlightedText({ text, words }: { text: string; words: OcrWord[] }) {
  const tokens = text.split(/(\s+)/);
  // Words come in reading order: match each token against a short look-ahead window.
  let w = 0;
  return (
    <>
      {tokens.map((tok, i) => {
        if (!tok.trim()) return tok;
        let low = false;
        for (let k = w; k < Math.min(words.length, w + 4); k++) {
          if (words[k].text === tok) {
            low = words[k].confidence < LOW_CONFIDENCE;
            w = k + 1;
            break;
          }
        }
        return low ? (
          <span key={i} className="ocr-low">
            {tok}
          </span>
        ) : (
          <span key={i}>{tok}</span>
        );
      })}
    </>
  );
}

export function confidenceTone(c: number): 'success' | 'warning' | 'danger' {
  return c >= 80 ? 'success' : c >= LOW_CONFIDENCE ? 'warning' : 'danger';
}

export function OcrPanel({
  status,
  progress,
  text,
  rawText,
  words,
  confidence,
  downloadNote,
  editedText,
  onEdit,
  onConfirmDownload,
  onRun,
  onSelectRegion,
  regionActive,
  languages,
}: {
  status: OcrStatus;
  progress: OcrProgress | null;
  text: string;
  rawText: string;
  words: OcrWord[];
  confidence: number | null;
  downloadNote: string | null;
  editedText: string | null;
  onEdit: (text: string) => void;
  onConfirmDownload: () => void;
  onRun: () => void;
  onSelectRegion?: () => void;
  regionActive?: boolean;
  languages: string[];
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const lowCount = words.filter((w) => w.confidence < LOW_CONFIDENCE).length;
  const shown = editedText ?? text;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      toast(t('ocr.copied'));
    } catch {
      toast(t('ocr.copyFailed'), { kind: 'error' });
    }
  };

  if (status === 'disabled') {
    return (
      <div className="ocr-box">
        <span className="meta">{t('ocr.disabledHere')}</span>
      </div>
    );
  }

  return (
    <section className="ocr-box" aria-label={t('ocr.title')}>
      <div className="row" style={{ fontSize: '0.75rem' }}>
        <span className="grow label">
          {t('ocr.title')} · {languages.map((l) => languageName(l)).join(', ')}
        </span>
        {status === 'done' && confidence != null && (
          <span
            className="pill"
            style={{
              background: `var(--${confidenceTone(confidence) === 'success' ? 'success-tint' : confidenceTone(confidence) === 'warning' ? 'warning-bg' : 'danger-tint'})`,
              color: `var(--${confidenceTone(confidence) === 'success' ? 'success' : confidenceTone(confidence) === 'warning' ? 'warning-text' : 'danger'})`,
            }}
          >
            {t('ocr.confidence', { value: confidence })}
          </span>
        )}
      </div>

      {status === 'confirm' && (
        <div className="notice notice-warning" role="alert">
          <Icon name="download" size={16} />
          <span className="grow">
            {downloadNote} {t('ocr.meteredWarning')}
            <span className="row" style={{ marginTop: 8 }}>
              <Button size="sm" variant="primary" onClick={onConfirmDownload}>
                {t('ocr.download')}
              </Button>
            </span>
          </span>
        </div>
      )}

      {status === 'running' && (
        <div className="col gap-4" role="status">
          <span className="meta">
            {progress?.phase === 'loading' ? (downloadNote ?? t('ocr.loading')) : t('ocr.recognising')}
          </span>
          <Progress value={progress?.progress ?? 0} label={t('ocr.progressLabel')} />
          <span className="meta">{t('ocr.saveAnyway')}</span>
        </div>
      )}

      {status === 'failed' && (
        <div className="row">
          <span className="grow meta">{downloadNote ?? t('ocr.failed')}</span>
          <Button size="sm" onClick={onRun}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {status === 'idle' && (
        <div className="row">
          <span className="grow meta">{t('ocr.notRun')}</span>
          <Button size="sm" onClick={onRun}>
            {t('ocr.run')}
          </Button>
        </div>
      )}

      {status === 'done' &&
        (shown.trim() ? (
          editing ? (
            <textarea
              className="textarea mono"
              aria-label={t('ocr.editLabel')}
              value={shown}
              rows={Math.min(10, Math.max(4, shown.split('\n').length + 1))}
              onChange={(e) => onEdit(e.target.value)}
              style={{ fontSize: '0.75rem' }}
              autoFocus
            />
          ) : (
            <div className="ocr-text">
              {editedText != null && editedText !== rawText ? shown : <HighlightedText text={shown} words={words} />}
            </div>
          )
        ) : (
          <span className="meta">{t('ocr.noText')}</span>
        ))}

      {status === 'done' && (
        <div className="row wrap gap-4">
          {lowCount > 0 && editedText == null && (
            <span className="meta grow">{t('ocr.lowWords', { count: lowCount })}</span>
          )}
          <span className="spacer" />
          {shown.trim() && (
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing((v) => !v)}>
              {editing ? t('common.done') : t('ocr.edit')}
            </Button>
          )}
          {shown.trim() && (
            <Button size="sm" variant="ghost" icon="copy" onClick={() => void copy()}>
              {t('ocr.copy')}
            </Button>
          )}
          {onSelectRegion && (
            <Button size="sm" variant={regionActive ? 'primary' : 'ghost'} icon="scan" onClick={onSelectRegion}>
              {t('ocr.region')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function CaptionFields({
  caption,
  footnote,
  onCaption,
  onFootnote,
  suggestions,
}: {
  caption: string;
  footnote: string;
  onCaption: (v: string) => void;
  onFootnote: (v: string) => void;
  suggestions: string[];
}) {
  const { t } = useTranslation();
  const locale = useSession((s) => s.prefs.locale);
  const dictation = useDictation(locale || navigator.language);
  const mic = (field: 'caption' | 'footnote', value: string, set: (v: string) => void) =>
    dictation.supported ? (
      <IconButton
        icon="mic"
        label={dictation.listening === field ? t('dictation.stop') : t('dictation.start')}
        pressed={dictation.listening === field}
        onClick={() =>
          dictation.listening === field
            ? dictation.stop()
            : dictation.start(field, (text) => set(value ? `${value} ${text}` : text))
        }
      />
    ) : undefined;
  return (
    <>
      <TextField
        label={t('review.caption')}
        value={caption}
        onChange={(e) => onCaption(e.target.value)}
        list="caption-suggestions"
        action={mic('caption', caption, onCaption)}
        maxLength={300}
      />
      <datalist id="caption-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <TextField
        label={t('review.footnote')}
        value={footnote}
        onChange={(e) => onFootnote(e.target.value)}
        action={mic('footnote', footnote, onFootnote)}
        maxLength={500}
      />
      {dictation.listening && (
        <span className="meta" role="status">
          {t('dictation.listening')}
        </span>
      )}
    </>
  );
}

export function validateFields(fields: CustomField[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (f.required && !v) errors[f.key] = 'required';
    else if (v && f.type === 'number' && Number.isNaN(Number(v))) errors[f.key] = 'number';
  }
  return errors;
}

export function CustomFieldsForm({
  fields,
  values,
  onChange,
  errors,
  fromOcr,
}: {
  fields: CustomField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors: Record<string, string>;
  fromOcr: Set<string>;
}) {
  const { t } = useTranslation();
  if (!fields.length) return null;
  return (
    <fieldset className="col gap-12" style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend className="label" style={{ marginBottom: 8 }}>
        {t('review.fields')}
      </legend>
      {fields.map((f) => {
        const id = `field-${f.key}`;
        const label = `${f.label}${f.required ? ' *' : ''}`;
        const err = errors[f.key] ? t(`review.fieldError.${errors[f.key]}`) : undefined;
        const chip = fromOcr.has(f.key) ? <span className="chip chip-accent">{t('review.fromOcr')}</span> : null;
        if (f.type === 'choice') {
          return (
            <div className="field" key={f.key}>
              <label htmlFor={id}>
                {label} {chip}
              </label>
              <select
                id={id}
                className="select"
                value={values[f.key] ?? ''}
                aria-invalid={err ? true : undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
              >
                <option value="">{t('review.choose')}</option>
                {(f.choices ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {err && <span className="field-error">{err}</span>}
            </div>
          );
        }
        const isIsoDate = f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(values[f.key] ?? '');
        return (
          <div className="field" key={f.key}>
            <label htmlFor={id}>
              {label} {chip}
            </label>
            <input
              id={id}
              className="input"
              type={f.type === 'number' ? 'text' : f.type === 'date' && (isIsoDate || !values[f.key]) ? 'date' : 'text'}
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              value={values[f.key] ?? ''}
              aria-invalid={err ? true : undefined}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
            {err && <span className="field-error">{err}</span>}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Rectangle selection over an image, for OCR on a region. Reports pixel and normalised coordinates. */
export function RegionSelector({
  imageUrl,
  naturalWidth,
  naturalHeight,
  onSelect,
  alt,
}: {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  onSelect: (rect: OcrRect, quad: Quad) => void;
  alt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const norm = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  return (
    <div
      ref={ref}
      style={{ position: 'relative', touchAction: 'none', cursor: 'crosshair', display: 'inline-block' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = norm(e);
        setStart(p);
        setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!start) return;
        const p = norm(e);
        setBox({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (box) {
          const x0 = Math.min(box.x0, box.x1);
          const y0 = Math.min(box.y0, box.y1);
          const x1 = Math.max(box.x0, box.x1);
          const y1 = Math.max(box.y0, box.y1);
          if (x1 - x0 > 0.03 && y1 - y0 > 0.02) {
            onSelect(
              {
                left: Math.round(x0 * naturalWidth),
                top: Math.round(y0 * naturalHeight),
                width: Math.round((x1 - x0) * naturalWidth),
                height: Math.round((y1 - y0) * naturalHeight),
              },
              [
                { x: x0, y: y0 },
                { x: x1, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 },
              ],
            );
          }
        }
        setStart(null);
      }}
    >
      <img src={imageUrl} alt={alt} draggable={false} style={{ maxHeight: 'min(46dvh, 520px)', maxWidth: '100%' }} />
      {box && (
        <div
          className="region-box"
          style={{
            left: `${Math.min(box.x0, box.x1) * 100}%`,
            top: `${Math.min(box.y0, box.y1) * 100}%`,
            width: `${Math.abs(box.x1 - box.x0) * 100}%`,
            height: `${Math.abs(box.y1 - box.y0) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
