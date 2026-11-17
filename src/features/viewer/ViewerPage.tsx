// Full-screen viewer: pinch / wheel / double-tap zoom, pan, swipe or arrow keys between Entries.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed } from '../../stores/sessionStore';
import { useDocumentRec } from '../../data/documents';
import { useEntries } from '../../data/entries';
import { useTemplates } from '../../data/templates';
import { resolveTemplate } from '../../lib/templates/builtins';
import { figureLabel } from '../../lib/templates/layout';
import { useEntryImage } from '../../lib/images';
import { IconButton, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';

export default function ViewerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { docId, entryId } = useParams();
  const { spaceId } = useAuthed();
  const { data: doc } = useDocumentRec(spaceId, docId);
  const { data: entries } = useEntries(spaceId, docId);
  const { templates } = useTemplates(spaceId);
  const template = useMemo(() => (doc ? resolveTemplate(doc, templates) : null), [doc, templates]);
  const index = entries.findIndex((e) => e.id === entryId);
  const entry = entries[index];
  const derived = useEntryImage(entry, 'derived');
  const thumb = useEntryImage(entry, 'thumb');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist?: number; scale: number; start: { x: number; y: number }; offset: { x: number; y: number }; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const go = (delta: number) => {
    const next = entries[index + delta];
    if (next) navigate(`/d/${docId}/view/${next.id}`, { replace: true });
  };
  const close = () => navigate(`/d/${docId}`);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [entryId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') close();
      else if (e.key === '+' || e.key === '=') setScale((s) => Math.min(5, s * 1.25));
      else if (e.key === '-') setScale((s) => Math.max(1, s / 1.25));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!doc || !template) return <div className="viewer center"><Spinner label={t('common.loading')} /></div>;
  if (!entry) return <div className="viewer center"><p>{t('entries.notFound')}</p></div>;

  const label =
    figureLabel(template.numberingScheme, index + 1, {
      figure: t('numbering.figureWord'),
      fig: t('numbering.figWord'),
      plate: t('numbering.plateWord'),
      image: t('numbering.imageWord'),
    }) || `#${index + 1}`;
  const url = derived.url ?? thumb.url;

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointers.current.values());
    gesture.current = {
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined,
      scale,
      start: { x: e.clientX, y: e.clientY },
      offset,
      moved: false,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = Array.from(pointers.current.values());
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setScale(Math.min(5, Math.max(1, g.scale * (d / g.dist))));
      g.moved = true;
    } else if (pts.length === 1) {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (scale > 1) setOffset({ x: g.offset.x + dx, y: g.offset.y + dy });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g || pointers.current.size > 0) return;
    const dx = e.clientX - g.start.x;
    if (scale <= 1.01 && Math.abs(dx) > 60 && g.moved) go(dx < 0 ? 1 : -1);
    else if (!g.moved) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        setScale((s) => (s > 1 ? 1 : 2.5));
        setOffset({ x: 0, y: 0 });
      }
      lastTap.current = now;
    }
    if (scale <= 1.01) setOffset({ x: 0, y: 0 });
    gesture.current = null;
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={t('viewer.label', { label })}>
      <div className="topbar" style={{ background: 'transparent' }}>
        <IconButton icon="close" label={t('common.close')} onClick={close} />
        <span className="topbar-title">
          {t('viewer.position', { label, n: index + 1, total: entries.length })}
        </span>
        <IconButton icon="zoomIn" label={t('viewer.zoom')} onClick={() => setScale((s) => (s >= 4 ? 1 : s * 1.5))} />
        <Link to={`/d/${docId}/e/${entry.id}`} className="icon-btn" aria-label={t('entries.actions.edit')}>
          <Icon name="edit" />
        </Link>
      </div>
      <div
        className="viewer-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={(e) => setScale((s) => Math.min(5, Math.max(1, s * (e.deltaY < 0 ? 1.1 : 0.9))))}
      >
        {url ? (
          <img
            src={url}
            alt={entry.caption || label}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            draggable={false}
          />
        ) : (
          <Spinner label={t('common.loading')} />
        )}
        {index > 0 && (
          <IconButton icon="back" label={t('entries.previous')} onClick={() => go(-1)} className="desktop-only" style={{ position: 'absolute', left: 8 }} />
        )}
        {index < entries.length - 1 && (
          <IconButton icon="chevronRight" label={t('entries.next')} onClick={() => go(1)} className="desktop-only" style={{ position: 'absolute', right: 8 }} />
        )}
      </div>
      <div className="viewer-caption">
        <strong>{label}</strong>
        {entry.caption ? ` — ${entry.caption}` : ''}
        {entry.footnote && <div style={{ opacity: 0.8, fontSize: '0.8125rem' }}>{entry.footnote}</div>}
      </div>
    </div>
  );
}
