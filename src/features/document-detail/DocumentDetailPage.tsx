import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { useDocumentRec, useDocuments, allTags, updateDocument } from '../../data/documents';
import {
  copyEntriesTo,
  deleteEntries,
  duplicateEntries,
  moveEntriesTo,
  rebalanceOrders,
  setEntryOrder,
  tagEntries,
  useEntries,
  type EntryView,
} from '../../data/entries';
import { useTemplates } from '../../data/templates';
import { resolveTemplate } from '../../lib/templates/builtins';
import { figureLabel } from '../../lib/templates/layout';
import { needsRebalance, orderBetween, orderForMove } from '../../lib/order';
import { rememberLastDocument, updatePrefs } from '../../data/session';
import { recoverPendingOcr } from '../../data/ocrJobs';
import { useEntrySyncState } from '../../hooks/useSync';
import { useFormat } from '../../hooks/useFormat';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSelectionStore } from '../../stores/selectionStore';
import { confirmDialog, promptDialog } from '../../stores/dialogStore';
import { toast } from '../../stores/toastStore';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, IconButton, Sheet, SwitchRow } from '../../components/ui';
import { OcrBadge, SyncBadge } from '../../components/feedback';
import { TagEditor, normaliseTag } from '../../components/TagEditor';
import { PagePreview } from '../../components/PagePreview';
import { EntryThumb, SortableEntryCard } from './EntryCard';
import { useDocumentActions } from '../documents/DocumentListPage';
import { templateName } from '../documents/shared';
import type { DocumentRec, Template } from '../../data/types';
import { useEntryImage } from '../../lib/images';
import { SyncPill } from '../../components/AppShell';

type View = 'gallery' | 'list' | 'pages';

function useLabels(template: Template) {
  const { t } = useTranslation();
  return (n: number) =>
    figureLabel(template.numberingScheme, n, {
      figure: t('numbering.figureWord'),
      fig: t('numbering.figWord'),
      plate: t('numbering.plateWord'),
      image: t('numbering.imageWord'),
    }) || `#${n}`;
}

export function DocumentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { docId } = useParams();
  const { spaceId } = useAuthed();
  const prefs = useSession((s) => s.prefs);
  const { data: doc, loading } = useDocumentRec(spaceId, docId);
  const { data: entries } = useEntries(spaceId, docId);
  const { templates } = useTemplates(spaceId);
  const template = useMemo(() => (doc ? resolveTemplate(doc, templates) : null), [doc, templates]);

  useEffect(() => {
    if (docId) rememberLastDocument(docId);
  }, [docId]);

  useEffect(() => {
    if (template && entries.length) recoverPendingOcr(entries, prefs.ocrLanguages, template.customFields);
    // Only on first load of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length > 0, template?.id]);

  if (loading && doc === undefined) return <main className="page" aria-busy="true" />;
  if (!doc || doc.status === 'trashed' || !template) {
    return (
      <main className="page">
        <EmptyState
          icon="doc"
          title={t('detail.notFound')}
          action={
            <Button onClick={() => navigate('/documents')}>{t('detail.backToList')}</Button>
          }
        />
      </main>
    );
  }
  return <DocumentDetail doc={doc} entries={entries} template={template} />;
}

function DocumentDetail({ doc, entries, template }: { doc: DocumentRec; entries: EntryView[]; template: Template }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const prefs = useSession((s) => s.prefs);
  const fmt = useFormat();
  const { data: allDocs } = useDocuments(doc.spaceId);
  const syncOf = useEntrySyncState();
  const labelOf = useLabels(template);
  const wide = useMediaQuery('(min-width: 1100px)');
  const actions = useDocumentActions();
  const [view, setView] = useState<View>(() => (localStorage.getItem('ls.docView') as View) || 'gallery');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [transfer, setTransfer] = useState<'move' | 'copy' | null>(null);
  const [notes, setNotes] = useState(doc.notes);
  const notesDirty = useRef(false);
  const setExportSelection = useSelectionStore((s) => s.setSelection);

  useEffect(() => {
    if (!notesDirty.current) setNotes(doc.notes);
  }, [doc.notes]);

  const sorted = entries; // Already ordered by `order`.
  const selectedEntries = sorted.filter((e) => selected.includes(e.id));
  const current = sorted.find((e) => e.id === currentId) ?? null;
  const states = sorted.map(syncOf);
  const syncedCount = states.filter((s) => s === 'synced').length;
  const uploadingCount = states.filter((s) => s === 'uploading' || s === 'local').length;
  const failedCount = states.filter((s) => s === 'failed').length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = sorted.findIndex((x) => x.id === e.active.id);
    const to = sorted.findIndex((x) => x.id === e.over!.id);
    const order = orderForMove(sorted, from, to);
    if (order == null) return;
    const rest = sorted.filter((_, i) => i !== from);
    if (needsRebalance(rest[to - 1]?.order, rest[to]?.order)) {
      const next = [...rest];
      next.splice(to, 0, sorted[from]);
      rebalanceOrders(next);
    } else setEntryOrder(sorted[from], order);
    toast(t('detail.reordered', { label: labelOf(to + 1) }));
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const activate = (entry: EntryView, ev: React.MouseEvent | React.KeyboardEvent) => {
    if (selectMode || ev.shiftKey || ev.metaKey || ev.ctrlKey) {
      if (!selectMode) setSelectMode(true);
      toggleSelect(entry.id);
      return;
    }
    if (wide) setCurrentId(entry.id);
    else navigate(`/d/${doc.id}/e/${entry.id}`);
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected([]);
  };

  const remove = async (list: EntryView[]) => {
    if (list.length > 1) {
      const ok = await confirmDialog({
        title: t('entries.deleteMany.title', { count: list.length }),
        body: t('entries.deleteMany.body'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!ok) return;
    }
    const undo = await deleteEntries(doc, list);
    exitSelect();
    if (list.some((e) => e.id === currentId)) setCurrentId(null);
    toast(t('entries.deleted', { count: list.length }), { actionLabel: t('common.undo'), onAction: () => void undo(), durationMs: 9000 });
  };

  const bulkTag = async () => {
    const tag = await promptDialog({
      title: t('entries.tagMany', { count: selectedEntries.length }),
      inputLabel: t('tags.label'),
      confirmLabel: t('common.apply'),
      cancelLabel: t('common.cancel'),
    });
    const clean = tag ? normaliseTag(tag) : '';
    if (!clean) return;
    tagEntries(selectedEntries, clean);
    toast(t('entries.tagged', { count: selectedEntries.length, tag: clean }));
  };

  const toggleLocation = async (on: boolean) => {
    if (on && !prefs.captureLocationConsent) {
      const ok = await confirmDialog({
        title: t('location.consentTitle'),
        body: t('location.consentBody'),
        confirmLabel: t('location.allow'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      updatePrefs({ captureLocationConsent: true });
    }
    updateDocument(doc.spaceId, doc.id, { captureLocation: on });
  };

  const insertAfter = (entry: EntryView) => {
    const idx = sorted.findIndex((e) => e.id === entry.id);
    const before = entry.order;
    const after = sorted[idx + 1]?.order;
    navigate(`/d/${doc.id}/capture?after=${before}${after != null ? `&before=${after}` : ''}`);
  };

  const exportSelected = () => {
    setExportSelection(doc.id, selected);
    navigate(`/d/${doc.id}/export?scope=selected`);
  };

  const otherDocs = allDocs.filter((d) => d.id !== doc.id && d.status === 'active');

  return (
    <div className="split">
      <main className="split-main">
        <div className="topbar">
          <Link to="/documents" className="icon-btn" aria-label={t('detail.back')}>
            <Icon name="back" />
          </Link>
          <span className="topbar-crumb truncate">{t('nav.documents')}</span>
          <span className="desktop-only">
            <SyncPill />
          </span>
          <Link to={`/d/${doc.id}/template`} className="btn btn-ghost btn-sm">
            {t('detail.template')}
          </Link>
          <Link to={`/d/${doc.id}/export`} className="btn btn-secondary btn-sm">
            {t('detail.export')}
          </Link>
          <Link to={`/d/${doc.id}/capture`} className="btn btn-primary btn-sm desktop-only">
            <Icon name="camera" size={16} />
            {t('detail.newCapture')}
          </Link>
          <IconButton icon="more" label={t('detail.more')} onClick={() => setMenuOpen(true)} />
        </div>

        <div className="page" style={{ paddingTop: 4 }}>
          <button
            type="button"
            className="h1"
            style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'text' }}
            onClick={() => void actions.rename(doc)}
            title={t('documents.actions.rename')}
          >
            {doc.title}
          </button>

          <dl className="props">
            <dt>{t('detail.props.tags')}</dt>
            <dd>
              <TagEditor
                hideLabel
                label={t('detail.props.tags')}
                tags={doc.tags}
                suggestions={allTags(allDocs)}
                onChange={(tags) => updateDocument(doc.spaceId, doc.id, { tags })}
              />
            </dd>
            <dt>{t('detail.props.template')}</dt>
            <dd>
              <Link to={`/d/${doc.id}/template`} style={{ textDecoration: 'underline' }}>
                {templateName(t, template)}
                {doc.templateOverrides && Object.keys(doc.templateOverrides).length ? ` ${t('detail.customised')}` : ''}
              </Link>{' '}
              <span className="meta">
                · {template.pageSize} {t(`templates.orientation.${template.orientation}`)}
              </span>
            </dd>
            <dt>{t('detail.props.entries')}</dt>
            <dd>
              {t('documents.entryCount', { count: sorted.length })}
              {sorted.length > 0 && (
                <span className="meta">
                  {' · '}
                  {t('detail.syncSummary', { synced: syncedCount, pending: uploadingCount })}
                  {failedCount ? ` · ${t('detail.failedSummary', { count: failedCount })}` : ''}
                </span>
              )}
            </dd>
            <dt>{t('detail.props.updated')}</dt>
            <dd className="meta">{fmt.relative(doc.updatedAt)}</dd>
          </dl>

          <div className="field">
            <label htmlFor="doc-notes">{t('detail.props.notes')}</label>
            <textarea
              id="doc-notes"
              className="textarea"
              rows={2}
              placeholder={t('detail.notesPlaceholder')}
              value={notes}
              onChange={(e) => {
                notesDirty.current = true;
                setNotes(e.target.value);
              }}
              onBlur={() => {
                if (notesDirty.current && notes !== doc.notes) updateDocument(doc.spaceId, doc.id, { notes });
                notesDirty.current = false;
              }}
            />
          </div>

          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <div className="tabs grow" role="tablist" aria-label={t('detail.viewsLabel')}>
              {(['gallery', 'list', 'pages'] as View[]).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setView(v);
                    localStorage.setItem('ls.docView', v);
                  }}
                >
                  {t(`detail.views.${v}`)}
                </button>
              ))}
            </div>
            {sorted.length > 0 && view !== 'pages' && (
              <Button size="sm" variant={selectMode ? 'primary' : 'ghost'} icon="select" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
                {selectMode ? t('common.done') : t('detail.select')}
              </Button>
            )}
          </div>
          {view === 'gallery' && sorted.length > 1 && (
            <p className="meta desktop-only">{t('detail.dragHint')}</p>
          )}

          {sorted.length === 0 ? (
            <EmptyState
              icon="camera"
              title={t('detail.empty.title')}
              body={t('detail.empty.body')}
              action={
                <Link to={`/d/${doc.id}/capture`} className="btn btn-primary">
                  <Icon name="camera" size={18} />
                  {t('detail.empty.action')}
                </Link>
              }
            />
          ) : view === 'gallery' ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={sorted.map((e) => e.id)} strategy={rectSortingStrategy}>
                <div className="gallery">
                  {sorted.map((e, i) => (
                    <SortableEntryCard
                      key={e.id}
                      entry={e}
                      label={labelOf(i + 1)}
                      syncState={states[i]}
                      selected={selected.includes(e.id)}
                      current={e.id === currentId}
                      selectMode={selectMode}
                      disabled={selectMode}
                      onActivate={(ev) => activate(e, ev)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : view === 'list' ? (
            <EntryList
              entries={sorted}
              labelOf={labelOf}
              states={states}
              selectMode={selectMode}
              selected={selected}
              onActivate={activate}
            />
          ) : (
            <>
              <div className="row">
                <span className="meta grow">{t('detail.previewHint')}</span>
                <Link to={`/d/${doc.id}/print`} className="btn btn-ghost btn-sm">
                  <Icon name="print" size={16} />
                  {t('detail.print')}
                </Link>
              </div>
              <PagePreview settings={template} entries={sorted} documentTitle={doc.title} />
            </>
          )}
        </div>

        {!selectMode && (
          <Link to={`/d/${doc.id}/capture`} className="fab">
            <Icon name="camera" />
            {t('detail.capture')}
          </Link>
        )}

        {selectMode && (
          <div className="bulk-bar" role="toolbar" aria-label={t('detail.bulkLabel')}>
            <span style={{ padding: '0 8px', fontSize: '0.8125rem' }}>{t('detail.selectedCount', { count: selected.length })}</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(selected.length === sorted.length ? [] : sorted.map((e) => e.id))}>
              {selected.length === sorted.length ? t('detail.selectNone') : t('detail.selectAll')}
            </Button>
            <Button size="sm" variant="ghost" icon="tag" disabled={!selected.length} onClick={() => void bulkTag()}>
              {t('entries.actions.tag')}
            </Button>
            <Button size="sm" variant="ghost" icon="move" disabled={!selected.length || !otherDocs.length} onClick={() => setTransfer('move')}>
              {t('entries.actions.move')}
            </Button>
            <Button size="sm" variant="ghost" icon="copy" disabled={!selected.length || !otherDocs.length} onClick={() => setTransfer('copy')}>
              {t('entries.actions.copy')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="duplicate"
              disabled={!selected.length}
              onClick={async () => {
                await duplicateEntries(doc, sorted, selectedEntries);
                toast(t('entries.duplicated', { count: selectedEntries.length }));
                exitSelect();
              }}
            >
              {t('entries.actions.duplicate')}
            </Button>
            <Button size="sm" variant="ghost" icon="download" disabled={!selected.length} onClick={exportSelected}>
              {t('detail.export')}
            </Button>
            <Button size="sm" variant="ghost" icon="trash" disabled={!selected.length} onClick={() => void remove(selectedEntries)}>
              {t('common.delete')}
            </Button>
            <IconButton icon="close" label={t('common.close')} onClick={exitSelect} />
          </div>
        )}
      </main>

      <aside className="side-panel" aria-label={t('detail.selectedEntry')}>
        {current ? (
          <SidePanel
            entry={current}
            label={labelOf(sorted.indexOf(current) + 1)}
            template={template}
            docId={doc.id}
            onDelete={() => void remove([current])}
            onInsertAfter={() => insertAfter(current)}
          />
        ) : (
          <p className="meta">{t('detail.panelHint')}</p>
        )}
      </aside>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={doc.title}>
        <div className="col gap-4 menu-list">
          <SwitchRow
            title={t('detail.ocrToggle')}
            hint={!prefs.ocrEnabled ? t('detail.ocrGlobalOff') : undefined}
            checked={doc.ocrEnabled}
            onChange={(v) => updateDocument(doc.spaceId, doc.id, { ocrEnabled: v })}
          />
          <SwitchRow
            title={t('detail.locationToggle')}
            hint={t('detail.locationHint')}
            checked={doc.captureLocation}
            onChange={(v) => void toggleLocation(v)}
          />
          <Button variant="ghost" icon="edit" onClick={() => { setMenuOpen(false); void actions.rename(doc); }}>
            {t('documents.actions.rename')}
          </Button>
          <Button variant="ghost" icon="duplicate" onClick={() => { setMenuOpen(false); void actions.duplicate(doc); }}>
            {t('documents.actions.duplicate')}
          </Button>
          <Button variant="ghost" icon="pin" onClick={() => { setMenuOpen(false); actions.togglePin(doc); }}>
            {doc.pinned ? t('documents.actions.unpin') : t('documents.actions.pin')}
          </Button>
          <Button variant="ghost" icon="print" onClick={() => navigate(`/d/${doc.id}/print`)}>
            {t('detail.print')}
          </Button>
          <Button
            variant="danger-ghost"
            icon="trash"
            onClick={() => {
              setMenuOpen(false);
              actions.trash(doc);
              navigate('/documents');
            }}
          >
            {t('documents.actions.trash')}
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={!!transfer}
        onClose={() => setTransfer(null)}
        title={transfer === 'move' ? t('entries.moveTo', { count: selected.length }) : t('entries.copyTo', { count: selected.length })}
      >
        <div className="col gap-4 menu-list">
          {otherDocs.map((d) => (
            <Button
              key={d.id}
              variant="ghost"
              icon="doc"
              onClick={async () => {
                const list = selectedEntries;
                setTransfer(null);
                if (transfer === 'move') await moveEntriesTo(doc, d, list);
                else await copyEntriesTo(d, list);
                exitSelect();
                toast(
                  transfer === 'move'
                    ? t('entries.moved', { count: list.length, title: d.title })
                    : t('entries.copied', { count: list.length, title: d.title }),
                  { actionLabel: t('common.open'), onAction: () => navigate(`/d/${d.id}`) },
                );
              }}
            >
              {d.title}
            </Button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function EntryList({
  entries,
  labelOf,
  states,
  selectMode,
  selected,
  onActivate,
}: {
  entries: EntryView[];
  labelOf: (n: number) => string;
  states: ReturnType<ReturnType<typeof useEntrySyncState>>[];
  selectMode: boolean;
  selected: string[];
  onActivate: (e: EntryView, ev: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: () => 76,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  return (
    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }} role="list">
      {virtualizer.getVirtualItems().map((item) => {
        const e = entries[item.index];
        return (
          <div
            key={e.id}
            role="listitem"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <button
              type="button"
              className="list-row"
              aria-pressed={selectMode ? selected.includes(e.id) : undefined}
              onClick={(ev) => onActivate(e, ev)}
              style={selected.includes(e.id) ? { background: 'var(--accent-tint)' } : undefined}
            >
              <EntryThumb entry={e} className="doc-cover" />
              <span className="grow col gap-4" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ fontWeight: 500 }}>
                  {labelOf(item.index + 1)}
                  {e.caption ? ` — ${e.caption}` : ''}
                </span>
                <span className="meta truncate">{e.footnote || e.ocrTextCache.split('\n')[0]}</span>
                <span className="row gap-4">
                  <SyncBadge state={states[item.index]} />
                  <OcrBadge state={e.ocrState} confidence={e.ocrConfidence} />
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SidePanel({
  entry,
  label,
  template,
  docId,
  onDelete,
  onInsertAfter,
}: {
  entry: EntryView;
  label: string;
  template: Template;
  docId: string;
  onDelete: () => void;
  onInsertAfter: () => void;
}) {
  const { t } = useTranslation();
  const { url } = useEntryImage(entry, 'derived');
  const thumb = useEntryImage(entry, 'thumb');
  return (
    <>
      <div className="label">{t('detail.selectedEntry')}</div>
      <Link
        to={`/d/${docId}/view/${entry.id}`}
        className="crop-result"
        style={{ height: 180 }}
        aria-label={t('viewer.open')}
      >
        {url || thumb.url ? <img src={url ?? thumb.url!} alt="" /> : <Icon name="image" size={28} />}
      </Link>
      <div className="h3">
        {label}
        {entry.caption ? ` — ${entry.caption}` : ''}
      </div>
      {entry.footnote && <p className="muted" style={{ fontSize: '0.8125rem' }}>{entry.footnote}</p>}
      <dl className="props">
        {template.customFields.map((f) => (
          <FieldRow key={f.key} label={f.label} value={entry.customFieldValues?.[f.key]} />
        ))}
        <dt>{t('detail.props.ocr')}</dt>
        <dd>
          <OcrBadge state={entry.ocrState} confidence={entry.ocrConfidence} />
        </dd>
        {entry.tags.length > 0 && (
          <>
            <dt>{t('detail.props.tags')}</dt>
            <dd className="row wrap gap-4">
              {entry.tags.map((x) => (
                <span key={x} className="chip">
                  {x}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <Link to={`/d/${docId}/e/${entry.id}`} className="btn btn-secondary btn-sm">
        {t('entries.actions.edit')}
      </Link>
      <Button size="sm" variant="ghost" icon="camera" onClick={onInsertAfter}>
        {t('entries.actions.insertAfter')}
      </Button>
      <Button size="sm" variant="danger-ghost" icon="trash" onClick={onDelete}>
        {t('common.delete')}
      </Button>
    </>
  );
}

function FieldRow({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </>
  );
}

// Exported for the capture flow: where a new capture lands when inserting between two Entries.
export function insertionOrder(after?: string | null, before?: string | null): number | null {
  const a = after != null && after !== '' ? Number(after) : null;
  const b = before != null && before !== '' ? Number(before) : null;
  if (a == null && b == null) return null;
  return orderBetween(a, b);
}
