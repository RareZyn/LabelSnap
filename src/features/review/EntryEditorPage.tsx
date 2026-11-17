// Edit a saved Entry: caption, footnote, fields, tags, OCR text; re-run OCR; re-crop or replace the image.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { useDocumentRec } from '../../data/documents';
import {
  deleteEntries,
  duplicateEntries,
  saveOcrEdit,
  setOcrState,
  updateEntry,
  useEntries,
  useOcrResult,
  writeOcrResult,
} from '../../data/entries';
import { useTemplates } from '../../data/templates';
import { resolveTemplate } from '../../lib/templates/builtins';
import { figureLabel } from '../../lib/templates/layout';
import { getEntryBlob, useEntryImage } from '../../lib/images';
import { OCR_LANGUAGES, languageName } from '../../lib/ocr/ocrService';
import { isOcrRunning } from '../../data/ocrJobs';
import { useFormat } from '../../hooks/useFormat';
import { useEntrySyncState } from '../../hooks/useSync';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, IconButton, SelectField, Spinner } from '../../components/ui';
import { SyncBadge } from '../../components/feedback';
import { TagEditor } from '../../components/TagEditor';
import { CaptionFields, CustomFieldsForm, OcrPanel, RegionSelector, useOcrRun, validateFields, type OcrStatus } from './reviewParts';
import { toast } from '../../stores/toastStore';
import type { Quad } from '../../data/types';

export default function EntryEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { docId, entryId } = useParams();
  const { spaceId, uid } = useAuthed();
  const prefs = useSession((s) => s.prefs);
  const fmt = useFormat();
  const { data: doc } = useDocumentRec(spaceId, docId);
  const { data: entries, loading } = useEntries(spaceId, docId);
  const { templates } = useTemplates(spaceId);
  const template = useMemo(() => (doc ? resolveTemplate(doc, templates) : null), [doc, templates]);
  const index = entries.findIndex((e) => e.id === entryId);
  const entry = index >= 0 ? entries[index] : undefined;
  const { data: ocrDoc } = useOcrResult(spaceId, docId!, entryId);
  const syncOf = useEntrySyncState();
  const { url: imageUrl } = useEntryImage(entry, 'derived');
  const thumb = useEntryImage(entry, 'thumb');

  const [caption, setCaption] = useState('');
  const [footnote, setFootnote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editedText, setEditedText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [ocrDirty, setOcrDirty] = useState(false);
  const [lang, setLang] = useState(prefs.ocrLanguages[0] ?? 'eng');
  const [regionMode, setRegionMode] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!entry || loadedFor.current === entry.id) return;
    loadedFor.current = entry.id;
    setCaption(entry.caption);
    setFootnote(entry.footnote);
    setTags(entry.tags);
    setFields(entry.customFieldValues ?? {});
    setDirty(false);
  }, [entry]);

  useEffect(() => {
    if (!ocrDirty) setEditedText(ocrDoc?.editedText ?? null);
  }, [ocrDoc, ocrDirty]);

  useEffect(() => {
    if (entry) void getEntryBlob(entry, 'derived').then(setBlob);
    // Reload when the derived image is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, entry?.imagePath, entry?.updatedAt?.toMillis?.()]);

  const ocr = useOcrRun(blob, true, [lang], false);
  const lastWritten = useRef<unknown>(null);

  // Persist a re-run as soon as it completes.
  useEffect(() => {
    if (!entry || !ocr.output || lastWritten.current === ocr.output) return;
    lastWritten.current = ocr.output;
    setOcrDirty(false);
    setEditedText(null);
    writeOcrResult({ spaceId: entry.spaceId, documentId: entry.documentId, entryId: entry.id }, ocr.output, { fields: template?.customFields ?? [], currentValues: fields, region: ocr.region });
    toast(t('ocr.updated'));
  }, [ocr.output, ocr.region, entry, template, fields, t]);

  useEffect(() => {
    if (ocr.status === 'failed' && entry) setOcrState(entry, 'failed');
  }, [ocr.status, entry]);

  // After a re-crop, offer to read the new image.
  useEffect(() => {
    if (params.get('rerunOcr') && blob && entry) {
      setParams({}, { replace: true });
      toast(t('ocr.recropPrompt'), { actionLabel: t('ocr.run'), onAction: () => ocr.run({ languages: [lang] }) });
    }
  }, [params, blob, entry, setParams, t, ocr, lang]);

  if (!entry || !doc || !template) {
    return (
      <main className="page">
        {loading || !doc ? <Spinner label={t('common.loading')} /> : <EmptyState icon="image" title={t('entries.notFound')} />}
      </main>
    );
  }

  const label =
    figureLabel(template.numberingScheme, index + 1, {
      figure: t('numbering.figureWord'),
      fig: t('numbering.figWord'),
      plate: t('numbering.plateWord'),
      image: t('numbering.imageWord'),
    }) || `#${index + 1}`;

  const ocrStatus: OcrStatus =
    ocr.status === 'running' || ocr.status === 'confirm'
      ? ocr.status
      : entry.ocrState === 'pending' || isOcrRunning(entry.id)
        ? 'running'
        : entry.ocrState === 'failed'
          ? 'failed'
          : ocrDoc
            ? 'done'
            : 'idle';

  const save = () => {
    const errs = validateFields(template.customFields, fields);
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`field-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    updateEntry(entry, { caption: caption.trim(), footnote: footnote.trim(), tags, customFieldValues: fields });
    if (ocrDirty && editedText != null) saveOcrEdit(entry, editedText);
    setDirty(false);
    setOcrDirty(false);
    toast(t('entries.saved'));
  };

  const remove = async () => {
    const undo = await deleteEntries(doc, [entry]);
    toast(t('entries.deleted', { count: 1 }), { actionLabel: t('common.undo'), onAction: () => void undo(), durationMs: 9000 });
    navigate(`/d/${doc.id}`, { replace: true });
  };

  const next = entries[index + 1];
  const prev = entries[index - 1];
  const insertHref = `/d/${doc.id}/capture?after=${entry.order}${next ? `&before=${next.order}` : ''}`;

  return (
    <main>
      <div className="topbar">
        <Link to={`/d/${doc.id}`} className="icon-btn" aria-label={t('common.back')}>
          <Icon name="back" />
        </Link>
        <h1 className="topbar-title truncate">
          {label}
          <span className="meta"> · {doc.title}</span>
        </h1>
        <IconButton icon="back" label={t('entries.previous')} disabled={!prev} onClick={() => prev && navigate(`/d/${doc.id}/e/${prev.id}`, { replace: true })} />
        <IconButton icon="chevronRight" label={t('entries.next')} disabled={!next} onClick={() => next && navigate(`/d/${doc.id}/e/${next.id}`, { replace: true })} />
      </div>
      <div className="step-layout two-col" style={{ paddingBottom: 24 }}>
        <div className="step-visual">
          <div className="crop-stage" style={{ minHeight: 200, flex: 'none', padding: 8 }}>
            {regionMode && imageUrl ? (
              <RegionSelector
                imageUrl={imageUrl}
                naturalWidth={entry.width}
                naturalHeight={entry.height}
                alt={t('review.imageAlt')}
                onSelect={(rect, quad: Quad) => {
                  setRegionMode(false);
                  ocr.run({ rect, region: quad, languages: [lang] });
                }}
              />
            ) : imageUrl || thumb.url ? (
              <Link to={`/d/${doc.id}/view/${entry.id}`} aria-label={t('viewer.open')}>
                <img src={imageUrl ?? thumb.url!} alt={t('review.imageAlt')} style={{ maxHeight: 'min(46dvh, 520px)' }} />
              </Link>
            ) : (
              <EmptyState icon="cloudOff" title={t('entries.imageUnavailable')} body={t('entries.imageUnavailableBody')} />
            )}
          </div>
          {regionMode && <p className="meta">{t('ocr.regionHint')}</p>}
          <div className="row wrap">
            <Link to={`/d/${doc.id}/e/${entry.id}/crop`} className="btn btn-secondary btn-sm">
              <Icon name="crop" size={16} />
              {t('entries.actions.recrop')}
            </Link>
            <Link to={`/d/${doc.id}/capture?replace=${entry.id}`} className="btn btn-secondary btn-sm">
              <Icon name="camera" size={16} />
              {t('entries.actions.replace')}
            </Link>
            <Link to={`/d/${doc.id}/view/${entry.id}`} className="btn btn-ghost btn-sm">
              <Icon name="zoomIn" size={16} />
              {t('viewer.open')}
            </Link>
          </div>
          <dl className="props">
            <dt>{t('entries.meta.captured')}</dt>
            <dd>
              {fmt.date(entry.capturedAt)} {fmt.time(entry.capturedAt)}
            </dd>
            <dt>{t('entries.meta.by')}</dt>
            <dd>{entry.capturedBy === uid ? t('entries.meta.you') : entry.capturedBy}</dd>
            <dt>{t('entries.meta.device')}</dt>
            <dd>{entry.deviceInfo || '—'}</dd>
            <dt>{t('entries.meta.source')}</dt>
            <dd>{t(`entries.meta.sources.${entry.source}`)}</dd>
            {entry.geo && (
              <>
                <dt>{t('entries.meta.location')}</dt>
                <dd>
                  {entry.geo.latitude.toFixed(5)}, {entry.geo.longitude.toFixed(5)}
                </dd>
              </>
            )}
            <dt>{t('entries.meta.size')}</dt>
            <dd>
              {entry.width} × {entry.height}
            </dd>
            <dt>{t('entries.meta.sync')}</dt>
            <dd>
              <SyncBadge state={syncOf(entry)} />
            </dd>
            {entry.qualityFlags.length > 0 && (
              <>
                <dt>{t('entries.meta.quality')}</dt>
                <dd>{entry.qualityFlags.map((f) => t(`quality.short.${f}`)).join(', ')}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="col gap-12">
          {!doc.ocrEnabled || !prefs.ocrEnabled ? (
            <div className="ocr-box">
              <span className="meta">{t('ocr.disabledHere')}</span>
            </div>
          ) : (
            <>
              <OcrPanel
                status={ocrStatus}
                progress={ocr.progress}
                text={ocrDoc?.rawText ?? entry.ocrTextCache}
                rawText={ocrDoc?.rawText ?? ''}
                words={ocrDoc?.words ?? []}
                confidence={ocrDoc?.confidence ?? entry.ocrConfidence ?? null}
                downloadNote={ocr.downloadNote}
                editedText={editedText}
                onEdit={(v) => {
                  setEditedText(v);
                  setOcrDirty(true);
                  setDirty(true);
                }}
                onConfirmDownload={ocr.confirmDownload}
                onRun={() => ocr.run({ languages: [lang], force: true })}
                onSelectRegion={() => setRegionMode((v) => !v)}
                regionActive={regionMode}
                languages={ocrDoc?.languages ?? entry.ocrLanguages ?? [lang]}
              />
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="grow">
                  <SelectField
                    label={t('ocr.rerunLanguage')}
                    value={lang}
                    onChange={setLang}
                    options={OCR_LANGUAGES.map((l) => ({ value: l.code, label: languageName(l.code, prefs.locale) }))}
                  />
                </div>
                <Button icon="sync" disabled={!blob || ocr.status === 'running'} onClick={() => ocr.run({ languages: [lang] })}>
                  {t('ocr.rerun')}
                </Button>
              </div>
            </>
          )}
          <CaptionFields
            caption={caption}
            footnote={footnote}
            onCaption={(v) => {
              setCaption(v);
              setDirty(true);
            }}
            onFootnote={(v) => {
              setFootnote(v);
              setDirty(true);
            }}
            suggestions={Array.from(new Set(entries.map((e) => e.caption).filter(Boolean)))}
          />
          <CustomFieldsForm
            fields={template.customFields}
            values={fields}
            errors={errors}
            fromOcr={new Set()}
            onChange={(k, v) => {
              setFields((f) => ({ ...f, [k]: v }));
              setDirty(true);
            }}
          />
          <TagEditor
            tags={tags}
            onChange={(v) => {
              setTags(v);
              setDirty(true);
            }}
            suggestions={Array.from(new Set(entries.flatMap((e) => e.tags)))}
          />
          <div className="row wrap">
            <Button size="sm" variant="ghost" icon="camera" onClick={() => navigate(insertHref)}>
              {t('entries.actions.insertAfter')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="duplicate"
              onClick={async () => {
                await duplicateEntries(doc, entries, [entry]);
                toast(t('entries.duplicated', { count: 1 }));
              }}
            >
              {t('entries.actions.duplicate')}
            </Button>
            <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </div>
      <div className="step-footer" style={{ position: 'sticky', bottom: 0, zIndex: 25 }}>
        <span className="meta grow" style={{ alignSelf: 'center' }} role="status">
          {dirty ? t('entries.unsaved') : t('entries.allSaved')}
        </span>
        <Button variant="primary" onClick={save} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </div>
    </main>
  );
}
