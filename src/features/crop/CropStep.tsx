import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageFilter, Quad } from '../../data/types';
import { FULL_FRAME } from '../../lib/imaging/detect';
import { processInWorker } from '../../lib/imaging/imagingClient';
import { resizeJpeg } from '../../lib/imaging/canvas';
import type { QualityReport } from '../../lib/imaging/quality';
import { Icon } from '../../components/Icon';
import { Button, IconButton, Segmented, Switch } from '../../components/ui';

export interface CropParams {
  quad: Quad;
  rotation: number;
  straighten: number;
  filter: ImageFilter;
  autoDetect: boolean;
}

export interface CropResult extends CropParams {
  derived: Blob;
  thumb: Blob;
  width: number;
  height: number;
  report: QualityReport;
}

const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const;

export function CropStep({
  source,
  detected,
  initial,
  maxDim,
  quality,
  title,
  onBack,
  onRetake,
  retakeLabel,
  onUse,
  useLabel,
  header,
}: {
  source: Blob;
  detected: Quad | null;
  initial?: Partial<CropParams>;
  maxDim: number;
  quality: number;
  title: string;
  onBack: () => void;
  onRetake?: () => void;
  retakeLabel?: string;
  onUse: (r: CropResult) => void | Promise<void>;
  useLabel?: string;
  header?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [autoDetect, setAutoDetect] = useState(initial?.autoDetect ?? !!detected);
  const [quad, setQuad] = useState<Quad>(initial?.quad ?? detected ?? FULL_FRAME);
  const [rotation, setRotation] = useState(initial?.rotation ?? 0);
  const [straighten, setStraighten] = useState(initial?.straighten ?? 0);
  const [filter, setFilter] = useState<ImageFilter>(initial?.filter ?? 'autoContrast');
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; report: QualityReport } | null>(null);
  const [previewSource, setPreviewSource] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [displayW, setDisplayW] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(source);
    setSrcUrl(url);
    void resizeJpeg(source, 1400, 0.85).then((r) => setPreviewSource(r.blob));
    return () => URL.revokeObjectURL(url);
  }, [source]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisplayW(el.clientWidth || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [srcUrl]);

  // Live, low-resolution render of the result: re-runs after each change.
  useEffect(() => {
    if (!previewSource) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const r = await processInWorker({ blob: previewSource, quad, rotation, straighten, filter, maxDim: 900, quality: 0.8 });
        if (cancelled) return;
        setPreview({ url: URL.createObjectURL(r.blob), report: r.report });
      } catch {
        /* preview is best effort */
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [previewSource, quad, rotation, straighten, filter]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const toNorm = (clientX: number, clientY: number) => {
    const r = frameRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  };

  const moveCorner = (i: number, p: { x: number; y: number }) =>
    setQuad((q) => q.map((c, k) => (k === i ? p : c)) as Quad);

  const nudge = (i: number, dx: number, dy: number) =>
    setQuad((q) =>
      q.map((c, k) => (k === i ? { x: Math.min(1, Math.max(0, c.x + dx)), y: Math.min(1, Math.max(0, c.y + dy)) } : c)) as Quad,
    );

  const resetFull = () => {
    setQuad(FULL_FRAME);
    setAutoDetect(false);
  };

  const flags = preview?.report.flags ?? [];
  const w = natural?.w ?? 1000;
  const h = natural?.h ?? 750;
  const px = 1 / (displayW / w); // one screen pixel in image units
  const points = useMemo(() => quad.map((c) => `${c.x * w},${c.y * h}`).join(' '), [quad, w, h]);

  const use = async () => {
    setBusy(true);
    try {
      const r = await processInWorker({ blob: source, quad, rotation, straighten, filter, maxDim, quality, withThumb: true });
      await onUse({
        quad,
        rotation,
        straighten,
        filter,
        autoDetect,
        derived: r.blob,
        thumb: r.thumb!,
        width: r.width,
        height: r.height,
        report: r.report,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <IconButton icon="back" label={t('common.back')} onClick={onBack} />
        <h1 className="topbar-title">{title}</h1>
        <Button variant="ghost" size="sm" onClick={resetFull}>
          {t('crop.reset')}
        </Button>
      </div>
      {header}
      <div className="step-layout two-col">
        <div className="step-visual">
          <div className="crop-stage" style={{ minHeight: 260 }}>
            {srcUrl && (
              <div ref={frameRef} className="crop-frame" style={{ maxWidth: '100%', maxHeight: '100%' }}>
                <img
                  src={srcUrl}
                  alt={t('crop.sourceAlt')}
                  style={{ maxHeight: 'min(52dvh, 560px)' }}
                  onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  draggable={false}
                />
                {natural && (
                  <svg
                    viewBox={`0 0 ${w} ${h}`}
                    preserveAspectRatio="none"
                    onPointerMove={(e) => {
                      if (dragging.current == null) return;
                      moveCorner(dragging.current, toNorm(e.clientX, e.clientY));
                    }}
                    onPointerUp={() => {
                      dragging.current = null;
                    }}
                  >
                    <path
                      d={`M0 0H${w}V${h}H0Z M${points.replace(/ /g, ' L')}Z`}
                      fill="rgba(0,0,0,0.35)"
                      fillRule="evenodd"
                      pointerEvents="none"
                    />
                    <polygon points={points} fill="none" stroke="var(--accent)" strokeWidth={2 * px} pointerEvents="none" />
                    {quad.map((c, i) => (
                      <g key={CORNER_KEYS[i]}>
                        <circle
                          className="crop-handle-hit"
                          cx={c.x * w}
                          cy={c.y * h}
                          r={24 * px}
                          role="slider"
                          tabIndex={0}
                          aria-label={t(`crop.corner.${CORNER_KEYS[i]}`)}
                          aria-valuetext={`${Math.round(c.x * 100)}%, ${Math.round(c.y * 100)}%`}
                          onPointerDown={(e) => {
                            (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                            dragging.current = i;
                            setAutoDetect(false);
                          }}
                          onKeyDown={(e) => {
                            const step = e.shiftKey ? 0.02 : 0.005;
                            const d: Record<string, [number, number]> = {
                              ArrowLeft: [-step, 0],
                              ArrowRight: [step, 0],
                              ArrowUp: [0, -step],
                              ArrowDown: [0, step],
                            };
                            if (d[e.key]) {
                              e.preventDefault();
                              nudge(i, ...d[e.key]);
                              setAutoDetect(false);
                            }
                          }}
                        />
                        <circle className="crop-handle" cx={c.x * w} cy={c.y * h} r={8 * px} strokeWidth={2 * px} pointerEvents="none" />
                      </g>
                    ))}
                  </svg>
                )}
              </div>
            )}
          </div>
          {flags.length > 0 && (
            <div className="notice notice-accent" role="status">
              <Icon name="alert" size={18} />
              <span className="grow">
                {flags.map((f) => t(`quality.${f}`, { percent: preview?.report.glarePercent })).join(' ')}
                {onRetake && (
                  <>
                    {' '}
                    <button type="button" className="link-btn" onClick={onRetake}>
                      {t('crop.retakeSuggestion')}
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="col gap-16">
          <div className="col">
            <span className="label">{t('crop.result')}</span>
            <div className="crop-result" style={{ height: 180 }}>
              {preview ? <img src={preview.url} alt={t('crop.resultAlt')} /> : <span className="spinner" aria-hidden="true" />}
            </div>
          </div>
          <div className="switch-row">
            <span className="grow" style={{ fontSize: '0.875rem' }}>
              {t('crop.autoDetect')}
              {!detected && <span className="meta"> · {t('crop.noneDetected')}</span>}
            </span>
            <Switch
              label={t('crop.autoDetect')}
              checked={autoDetect}
              disabled={!detected}
              onChange={(v) => {
                setAutoDetect(v);
                setQuad(v && detected ? detected : FULL_FRAME);
              }}
            />
          </div>
          <div className="field">
            <span className="field-label">{t('crop.filter')}</span>
            <Segmented<ImageFilter>
              label={t('crop.filter')}
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'none', label: t('crop.filters.none') },
                { value: 'autoContrast', label: t('crop.filters.autoContrast') },
                { value: 'greyscale', label: t('crop.filters.greyscale') },
                { value: 'bw', label: t('crop.filters.bw') },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="straighten" className="field-label">
              {t('crop.straighten')} <span className="meta">{straighten.toFixed(1)}°</span>
            </label>
            <input
              id="straighten"
              type="range"
              min={-15}
              max={15}
              step={0.5}
              value={straighten}
              onChange={(e) => setStraighten(Number(e.target.value))}
              onDoubleClick={() => setStraighten(0)}
              style={{ accentColor: 'var(--accent)', minHeight: 32 }}
            />
          </div>
          <div className="field">
            <span className="field-label">{t('crop.rotate')}</span>
            <div className="row">
              <Button size="sm" icon="rotateLeft" onClick={() => setRotation((r) => (r + 270) % 360)}>
                {t('crop.rotateLeft')}
              </Button>
              <Button size="sm" icon="rotateRight" onClick={() => setRotation((r) => (r + 90) % 360)}>
                {t('crop.rotateRight')}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="step-footer">
        {onRetake && <Button onClick={onRetake}>{retakeLabel ?? t('crop.retake')}</Button>}
        <Button variant="primary" busy={busy} onClick={() => void use()}>
          {useLabel ?? t('crop.use')}
        </Button>
      </div>
    </>
  );
}
