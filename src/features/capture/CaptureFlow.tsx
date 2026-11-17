// Capture → Crop & enhance → Review, as one route so the camera stream survives between steps
// (Save & next resumes the preview instantly). The stream is released when the page is hidden or left.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { useAppStore } from '../../stores/appStore';
import { useDocumentRec } from '../../data/documents';
import { deviceSummary, replaceEntryImages, saveNewEntry, useEntries, type EntryView } from '../../data/entries';
import { useTemplates } from '../../data/templates';
import { attachWhenDone } from '../../data/ocrJobs';
import { newId } from '../../data/refs';
import { updatePrefs } from '../../data/session';
import { resolveTemplate } from '../../lib/templates/builtins';
import { figureLabel } from '../../lib/templates/layout';
import { ORDER_STEP, orderBetween } from '../../lib/order';
import { detectFrame, detectStill, detectorBusy } from '../../lib/imaging/imagingClient';
import { smoothQuad } from '../../lib/imaging/detect';
import { toGray } from '../../lib/imaging/raster';
import { rasterFromBitmap, resizeJpeg } from '../../lib/imaging/canvas';
import type { DocumentRec, Quad, Template } from '../../data/types';
import { cameraPermission, hasCameraApi, useCamera } from './useCamera';
import { CropStep, type CropResult } from '../crop/CropStep';
import { ReviewStep, type ReviewData } from '../review/ReviewStep';
import { Icon } from '../../components/Icon';
import { Button, IconButton, Spinner } from '../../components/ui';
import { toast, toastError } from '../../stores/toastStore';

type Step = 'explain' | 'camera' | 'crop' | 'review';

interface Source {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  source: 'camera' | 'import';
  capturedAt: Date;
  detected: Quad | null;
  geo: { lat: number; lng: number } | null;
  cameraLabel?: string;
}

const CAMERA_IDLE_RELEASE_MS = 2 * 60_000;
const DERIVED_MAX = 2400;

function getGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}

export default function CaptureFlow() {
  const { docId } = useParams();
  const { spaceId } = useAuthed();
  const { data: doc } = useDocumentRec(spaceId, docId);
  const { data: entries } = useEntries(spaceId, docId);
  const { templates } = useTemplates(spaceId);
  const template = useMemo(() => (doc ? resolveTemplate(doc, templates) : null), [doc, templates]);
  const { t } = useTranslation();
  if (doc === null) {
    return (
      <div className="capture center">
        <p>{t('detail.notFound')}</p>
      </div>
    );
  }
  if (!doc || !template) {
    return (
      <div className="capture center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  return <CaptureSession doc={doc} template={template} entries={entries} />;
}

function CaptureSession({ doc, template, entries }: { doc: DocumentRec; template: Template; entries: EntryView[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { uid } = useAuthed();
  const prefs = useSession((s) => s.prefs);
  const setApp = useAppStore((s) => s.set);
  const cam = useCamera(prefs.captureQuality);
  const replaceId = params.get('replace');
  const replaceEntry = replaceId ? entries.find((e) => e.id === replaceId) : undefined;
  const insertAfter = params.get('after');
  const insertBefore = params.get('before');

  const [step, setStep] = useState<Step>('explain');
  const [current, setCurrent] = useState<Source | null>(null);
  const [queue, setQueue] = useState<Source[]>([]);
  const [crop, setCrop] = useState<CropResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sessionThumbs, setSessionThumbs] = useState<string[]>([]);
  const [liveQuad, setLiveQuad] = useState<Quad | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 1280, h: 720 });
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; k: number } | null>(null);
  const [flash, setFlash] = useState(false);
  const lastDetectAt = useRef(0);
  const lastOrder = useRef<number | null>(null);
  const cameraUsed = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const ocrOn = doc.ocrEnabled && prefs.ocrEnabled;

  useEffect(() => {
    setApp({ captureBusy: true });
    return () => setApp({ captureBusy: false });
  }, [setApp]);

  useEffect(() => () => sessionThumbs.forEach((u) => URL.revokeObjectURL(u)), [sessionThumbs]);

  // Start straight away when permission is already granted; otherwise explain first.
  useEffect(() => {
    void (async () => {
      if (!hasCameraApi()) return;
      if ((await cameraPermission()) === 'granted' && (await cam.start())) {
        cameraUsed.current = true;
        setStep('camera');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the camera when the page is hidden.
  useEffect(() => {
    const stop = cam.stop;
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [cam.stop]);

  // Keep the stream warm between steps for a quick Save & next, but not forever.
  useEffect(() => {
    if (step === 'camera' || cam.state !== 'live') return;
    const stop = cam.stop;
    const id = setTimeout(stop, CAMERA_IDLE_RELEASE_MS);
    return () => clearTimeout(id);
  }, [step, cam.state, cam.stop]);

  // Resume playback when the viewfinder becomes visible again.
  useEffect(() => {
    if (step === 'camera' && cam.state === 'live') void cam.videoRef.current?.play().catch(() => undefined);
  }, [step, cam.state, cam.videoRef]);

  // Live label detection, about eight times a second.
  useEffect(() => {
    if (step !== 'camera' || cam.state !== 'live' || !prefs.autoDetect) {
      setLiveQuad(null);
      return;
    }
    let stopped = false;
    let prev: Quad | null = null;
    const tick = async () => {
      if (stopped) return;
      const v = cam.videoRef.current;
      if (v && v.videoWidth && !detectorBusy()) {
        const scale = 320 / Math.max(v.videoWidth, v.videoHeight);
        const w = Math.round(v.videoWidth * scale);
        const h = Math.round(v.videoHeight * scale);
        try {
          const r = rasterFromBitmap(v, w, h);
          const q = await detectFrame(toGray(r), w, h);
          if (q) {
            prev = smoothQuad(prev, q);
            lastDetectAt.current = Date.now();
            if (!stopped) setLiveQuad(prev);
          } else if (Date.now() - lastDetectAt.current > 700) {
            prev = null;
            if (!stopped) setLiveQuad(null);
          }
        } catch {
          /* skip this frame */
        }
      }
      if (!stopped) setTimeout(tick, 120);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [step, cam.state, cam.videoRef, prefs.autoDetect]);

  const peekOrder = useCallback(() => {
    if (insertAfter != null || insertBefore != null) {
      const prev = lastOrder.current ?? (insertAfter != null ? Number(insertAfter) : null);
      return orderBetween(prev, insertBefore != null ? Number(insertBefore) : null);
    }
    const maxExisting = entries.length ? entries[entries.length - 1].order : 0;
    return Math.max(maxExisting, lastOrder.current ?? 0) + ORDER_STEP;
  }, [entries, insertAfter, insertBefore]);

  const pendingOrder = peekOrder();
  const figureNumber = entries.filter((e) => e.order < pendingOrder).length + 1;
  const figureText =
    figureLabel(template.numberingScheme, figureNumber, {
      figure: t('numbering.figureWord'),
      fig: t('numbering.figWord'),
      plate: t('numbering.plateWord'),
      image: t('numbering.imageWord'),
    }) || `#${figureNumber}`;

  const openCamera = async () => {
    if (await cam.start()) {
      cameraUsed.current = true;
      setStep('camera');
    }
  };

  const afterSource = (next: Source[]) => {
    if (next.length) {
      setCurrent(next[0]);
      setQueue(next.slice(1));
      setCrop(null);
      setStep('crop');
      return;
    }
    setCurrent(null);
    setCrop(null);
    // Back to the viewfinder (it offers "Resume" if the stream was released), or to the explainer.
    setStep(cameraUsed.current ? 'camera' : 'explain');
  };

  const shoot = async () => {
    const g = await cam.grab(prefs.compressionTarget);
    if (!g) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    const fresh = liveQuad && Date.now() - lastDetectAt.current < 500 ? liveQuad : null;
    const src: Source = {
      id: newId(),
      blob: g.blob,
      width: g.width,
      height: g.height,
      source: 'camera',
      capturedAt: new Date(),
      detected: fresh,
      geo: null,
      cameraLabel: cam.label,
    };
    setCurrent(src);
    setCrop(null);
    setStep('crop');
    if (!fresh && prefs.autoDetect) {
      void detectStill(g.blob).then((q) => q && setCurrent((c) => (c?.id === src.id ? { ...c, detected: q } : c)));
    }
    if (doc.captureLocation && prefs.captureLocationConsent) {
      void getGeo().then((geo) => setCurrent((c) => (c?.id === src.id ? { ...c, geo } : c)));
    }
  };

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (fileRef.current) fileRef.current.value = '';
    if (!list.length) return;
    setImporting(true);
    const sources: Source[] = [];
    for (const f of list) {
      try {
        const r = await resizeJpeg(f, 4000, prefs.compressionTarget);
        sources.push({
          id: newId(),
          blob: r.blob,
          width: r.width,
          height: r.height,
          source: 'import',
          capturedAt: new Date(f.lastModified || Date.now()),
          detected: prefs.autoDetect ? await detectStill(r.blob) : null,
          geo: null,
        });
      } catch {
        toastError(t('capture.importFailed', { name: f.name }));
      }
    }
    setImporting(false);
    if (sources.length > 1) toast(t('capture.importQueued', { count: sources.length }));
    afterSource([...sources, ...queue]);
  };

  const onCropped = async (r: CropResult) => {
    if (!current) return;
    if (replaceEntry) {
      await replaceEntryImages(replaceEntry, {
        original: current.blob,
        derived: r.derived,
        thumb: r.thumb,
        width: r.width,
        height: r.height,
        cropQuad: r.quad,
        rotation: r.rotation,
        straighten: r.straighten,
        filter: r.filter,
        qualityFlags: r.report.flags,
      });
      toast(t('entries.imageReplaced'));
      navigate(`/d/${doc.id}/e/${replaceEntry.id}`, { replace: true });
      return;
    }
    setCrop(r);
    setStep('review');
  };

  const onSave = async (kind: 'next' | 'done' | 'skip', data: ReviewData) => {
    if (!current || !crop) return;
    setSaving(true);
    try {
      const order = peekOrder();
      lastOrder.current = order;
      const entryId = newId();
      await saveNewEntry(doc, uid, {
        entryId,
        order,
        original: current.blob,
        derived: crop.derived,
        thumb: crop.thumb,
        width: crop.width,
        height: crop.height,
        cropQuad: crop.quad,
        rotation: crop.rotation,
        straighten: crop.straighten,
        filter: crop.filter,
        qualityFlags: crop.report.flags,
        caption: data.caption,
        footnote: data.footnote,
        tags: data.tags,
        customFieldValues: data.fields,
        ocr: data.ocr,
        ocrEditedText: data.ocrEditedText,
        ocrRegion: data.ocrRegion,
        ocrState: data.ocrState,
        capturedAt: current.capturedAt,
        source: current.source,
        geo: current.geo,
        deviceInfo: deviceSummary(current.cameraLabel),
      });
      if (data.ocrPromise) {
        attachWhenDone(data.ocrPromise, { spaceId: doc.spaceId, documentId: doc.id, entryId }, template.customFields, data.fields, data.ocrRegion);
      }
      setSessionThumbs((s) => [...s, URL.createObjectURL(crop.thumb)]);
      try {
        localStorage.setItem('ls.savedCount', String(Number(localStorage.getItem('ls.savedCount') || '0') + 1));
      } catch {
        /* storage unavailable */
      }
      if (kind === 'done') {
        cam.stop();
        navigate(`/d/${doc.id}`, { replace: true });
        return;
      }
      toast(t('capture.saved', { figure: figureText }));
      afterSource(queue);
    } finally {
      setSaving(false);
    }
  };

  const retake = () => {
    setCrop(null);
    afterSource(queue);
  };

  const close = () => {
    cam.stop();
    navigate(replaceEntry ? `/d/${doc.id}/e/${replaceEntry.id}` : `/d/${doc.id}`);
  };

  // ---- Viewfinder gestures: pinch to zoom, tap to focus ----
  const vfPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && cam.caps.zoom) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom };
    }
  };
  const vfPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      void cam.setZoom(pinch.current.zoom * (d / pinch.current.dist));
    }
  };
  const vfPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasPinch = !!pinch.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (wasPinch || !cam.caps.focus) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setFocusPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top, k: Date.now() });
    void cam.focusAt(x, y);
  };

  const savingTo = (
    <div className="row" style={{ padding: '0 16px 6px', fontSize: '0.75rem' }}>
      <span className="meta">{t('capture.savingTo')}</span>
      <span className="truncate" style={{ fontWeight: 600, color: 'var(--accent)' }}>
        {doc.title}
      </span>
    </div>
  );

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => void onFiles(e.target.files)}
    />
  );

  const strip = (
    <div className="capture-strip" aria-label={t('capture.sessionStrip')}>
      {sessionThumbs.slice(-6).map((u) => (
        <img key={u} src={u} alt="" />
      ))}
      {sessionThumbs.length === 0 && <span className="meta">{t('capture.sessionEmpty')}</span>}
      {queue.length > 0 && <span className="pill pill-muted">{t('capture.queued', { count: queue.length })}</span>}
    </div>
  );

  return (
    <div className="capture">
      {fileInput}

      {/* The video element stays mounted so the stream can be resumed instantly. */}
      <div style={{ display: step === 'camera' ? 'contents' : 'none' }}>
        <div className="capture-head">
          <IconButton icon="close" label={t('capture.close')} onClick={close} />
          <div className="grow">
            <div className="meta">{t('capture.savingTo')}</div>
            <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent)' }}>
              {doc.title}
            </div>
          </div>
          {sessionThumbs.length > 0 && <span className="pill">{t('capture.sessionCount', { count: sessionThumbs.length })}</span>}
        </div>
        <div className="capture-body">
          <div
            className="viewfinder"
            onPointerDown={vfPointerDown}
            onPointerMove={vfPointerMove}
            onPointerUp={vfPointerUp}
            onPointerCancel={vfPointerUp}
          >
            <video
              ref={cam.videoRef}
              playsInline
              muted
              autoPlay
              aria-label={t('capture.viewfinder')}
              onLoadedMetadata={(e) => setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            />
            {prefs.showGrid && <div className="vf-grid" />}
            {liveQuad && (
              <svg className="overlay" viewBox={`0 0 ${videoSize.w} ${videoSize.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <polygon
                  points={liveQuad.map((p) => `${p.x * videoSize.w},${p.y * videoSize.h}`).join(' ')}
                  fill="rgba(231,163,174,0.12)"
                  stroke="var(--detect-overlay)"
                  strokeWidth={Math.max(2, videoSize.w / 300)}
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {focusPoint && <span key={focusPoint.k} className="focus-ring" style={{ left: focusPoint.x, top: focusPoint.y }} />}
            {flash && <div style={{ position: 'absolute', inset: 0, background: 'var(--camera-text)', opacity: 0.6 }} />}
            {cam.state === 'live' && (
              <span className="vf-tag" style={{ top: 12, left: 12 }} role="status">
                {liveQuad ? t('capture.detected') : prefs.autoDetect ? t('capture.searching') : t('capture.detectOff')}
              </span>
            )}
            {cam.caps.zoom && cam.state === 'live' && (
              <span className="vf-tag" style={{ top: 12, right: 12 }}>
                {cam.zoom.toFixed(1)}×
              </span>
            )}
            {cam.state !== 'live' && (
              <div className="vf-message">
                {cam.state === 'starting' ? (
                  <Spinner label={t('capture.starting')} />
                ) : (
                  <>
                    <Icon name="camera" size={32} />
                    <span>{t('capture.paused')}</span>
                    <Button variant="primary" onClick={() => void openCamera()}>
                      {t('capture.resume')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="capture-controls">
            {strip}
            <div className="capture-buttons">
              {cam.caps.torch ? (
                <IconButton
                  icon="torch"
                  label={cam.torch ? t('capture.torchOff') : t('capture.torchOn')}
                  pressed={cam.torch}
                  onClick={() => void cam.setTorch(!cam.torch)}
                />
              ) : (
                <span style={{ width: 44 }} />
              )}
              <IconButton
                icon="grid"
                label={prefs.showGrid ? t('capture.gridOff') : t('capture.gridOn')}
                pressed={prefs.showGrid}
                onClick={() => updatePrefs({ showGrid: !prefs.showGrid })}
              />
              <button
                type="button"
                className="shutter"
                aria-label={t('capture.shutter')}
                disabled={cam.state !== 'live'}
                onClick={() => void shoot()}
              >
                <span />
              </button>
              {cam.devices.length > 1 ? (
                <IconButton icon="switchCamera" label={t('capture.switchCamera')} onClick={() => void cam.switchCamera()} />
              ) : (
                <span style={{ width: 44 }} />
              )}
              <IconButton icon="image" label={t('capture.import')} onClick={() => fileRef.current?.click()} />
            </div>
            <p className="meta" style={{ textAlign: 'center' }}>
              {t('capture.nextFigure', { figure: figureText })}
            </p>
          </div>
        </div>
      </div>

      {step === 'explain' && (
        <>
          <div className="capture-head">
            <IconButton icon="close" label={t('capture.close')} onClick={close} />
            <span className="grow" />
          </div>
          {savingTo}
          <div className="onboard" style={{ minHeight: 0, flex: 1, paddingTop: 8 }}>
            <div className="onboard-art">
              <Icon name="camera" size={64} strokeWidth={1.2} />
            </div>
            <h1 className="h1">{t('capture.explain.title')}</h1>
            <p className="muted">{t('capture.explain.body')}</p>
            {cam.state === 'denied' && (
              <div className="notice notice-warning" role="alert">
                <Icon name="alert" size={16} />
                <span>{t('capture.explain.denied')}</span>
              </div>
            )}
            {(cam.state === 'unavailable' || !hasCameraApi()) && (
              <div className="notice" role="status">
                <Icon name="info" size={16} />
                <span>{t('capture.explain.noCamera')}</span>
              </div>
            )}
            {cam.state === 'error' && (
              <div className="notice notice-danger" role="alert">
                <Icon name="alert" size={16} />
                <span>{t('capture.explain.error')}</span>
              </div>
            )}
            <div className="col">
              {hasCameraApi() && cam.state !== 'unavailable' && (
                <Button variant="primary" block icon="camera" busy={cam.state === 'starting'} onClick={() => void openCamera()}>
                  {t('capture.explain.open')}
                </Button>
              )}
              <Button block icon="image" busy={importing} onClick={() => fileRef.current?.click()}>
                {t('capture.explain.import')}
              </Button>
            </div>
            {sessionThumbs.length > 0 && strip}
          </div>
        </>
      )}

      {step === 'crop' && current && (
        <CropStep
          key={current.id}
          source={current.blob}
          detected={current.detected}
          initial={{ filter: 'autoContrast', autoDetect: !!current.detected }}
          maxDim={DERIVED_MAX}
          quality={prefs.compressionTarget}
          title={replaceEntry ? t('crop.replaceTitle') : t('crop.title')}
          header={savingTo}
          onBack={retake}
          onRetake={retake}
          retakeLabel={current.source === 'import' ? t('crop.skipImage') : t('crop.retake')}
          onUse={onCropped}
          useLabel={replaceEntry ? t('crop.replaceUse') : undefined}
        />
      )}

      {step === 'review' && current && crop && (
        <ReviewStep
          key={current.id}
          doc={doc}
          template={template}
          processed={crop}
          capturedAt={current.capturedAt}
          figureNumber={figureNumber}
          figureText={figureText}
          captionSuggestions={Array.from(new Set(entries.map((e) => e.caption).filter(Boolean))).slice(-50)}
          tagSuggestions={Array.from(new Set([...entries.flatMap((e) => e.tags), ...doc.tags]))}
          ocrEnabled={ocrOn}
          languages={prefs.ocrLanguages}
          onBack={() => setStep('crop')}
          onSave={(kind, data) => void onSave(kind, data)}
          saving={saving}
        />
      )}
    </div>
  );
}
