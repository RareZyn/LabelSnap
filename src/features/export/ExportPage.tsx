import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getDoc } from 'firebase/firestore';
import { useAuthed } from '../../stores/sessionStore';
import { useDocumentRec, updateDocument } from '../../data/documents';
import { useEntries } from '../../data/entries';
import { useTemplates } from '../../data/templates';
import { ocrRef } from '../../data/refs';
import { resolveTemplate } from '../../lib/templates/builtins';
import { buildFilename, DEFAULT_FILENAME_PATTERN } from '../../lib/export/filename';
import { estimateBytes, fetchMissing, missingImages, runExport } from '../../lib/export/runExport';
import { ExportCancelled } from '../../lib/export/types';
import { formatBytes } from '../../lib/sync/quota';
import { countEvent } from '../../lib/firebase/analytics';
import { useSelectionStore } from '../../stores/selectionStore';
import { useDriveStore } from '../../stores/driveStore';
import { useFormat } from '../../hooks/useFormat';
import { useOnline } from '../../hooks/useSync';
import type { ExportFormat, ExportResolution, LastExport, OcrResult } from '../../data/types';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, Progress, Segmented, Spinner, SwitchRow, TextField } from '../../components/ui';
import { toastError } from '../../stores/toastStore';

export default function ExportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { docId } = useParams();
  const { spaceId } = useAuthed();
  const fmt = useFormat();
  const online = useOnline();
  const drive = useDriveStore((s) => s.status);
  const { data: doc } = useDocumentRec(spaceId, docId);
  const { data: entries, loading } = useEntries(spaceId, docId);
  const { templates } = useTemplates(spaceId);
  const selection = useSelectionStore();
  const selectedIds = useMemo(
    () => (selection.documentId === docId ? selection.ids : []),
    [selection.documentId, selection.ids, docId],
  );
  const last = doc?.lastExport;

  const [format, setFormat] = useState<ExportFormat>(last?.format ?? 'pdf');
  const [scope, setScope] = useState<'all' | 'selected'>(
    params.get('scope') === 'selected' && selectedIds.length ? 'selected' : 'all',
  );
  const [resolution, setResolution] = useState<ExportResolution>(last?.resolution ?? 'medium');
  const [appendix, setAppendix] = useState(last?.includeOcrAppendix ?? false);
  const [pattern, setPattern] = useState(last?.filenamePattern ?? DEFAULT_FILENAME_PATTERN);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; text: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const seeded = useRef(false);

  // Reuse the last export's settings once the Document has loaded.
  useEffect(() => {
    if (seeded.current || !doc) return;
    seeded.current = true;
    if (doc.lastExport) {
      setFormat(doc.lastExport.format);
      setResolution(doc.lastExport.resolution);
      setAppendix(doc.lastExport.includeOcrAppendix);
      setPattern(doc.lastExport.filenamePattern);
    }
  }, [doc]);

  const template = useMemo(() => (doc ? resolveTemplate(doc, templates) : null), [doc, templates]);
  const scoped = useMemo(
    () => (scope === 'selected' ? entries.filter((e) => selectedIds.includes(e.id)) : entries),
    [scope, entries, selectedIds],
  );

  useEffect(() => {
    let alive = true;
    setMissing(null);
    void missingImages(scoped).then((m) => alive && setMissing(m.map((e) => e.id)));
    return () => {
      alive = false;
    };
  }, [scoped]);

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  if (!doc || !template) {
    return (
      <main className="page">
        {doc === null ? <EmptyState icon="doc" title={t('detail.notFound')} /> : <Spinner label={t('common.loading')} />}
      </main>
    );
  }

  const filename = buildFilename(pattern, { title: doc.title, date: new Date(), count: scoped.length, format });
  const labelOf = (id: string) => {
    const i = entries.findIndex((e) => e.id === id);
    return t('export.figureN', { n: i + 1 });
  };

  const fetchFromDrive = async () => {
    setFetching(true);
    const still = await fetchMissing(scoped.filter((e) => missing?.includes(e.id)));
    setMissing(still.map((e) => e.id));
    setFetching(false);
  };

  const start = async () => {
    if (!scoped.length || missing?.length) return;
    const lastExport: LastExport = { format, scope, resolution, includeOcrAppendix: appendix, filenamePattern: pattern };
    updateDocument(doc.spaceId, doc.id, { lastExport });
    const controller = new AbortController();
    abort.current = controller;
    setResult(null);
    setProgress({ fraction: 0, text: t('export.preparing', { done: 0, total: scoped.length }) });
    try {
      const ocrTexts = new Map<string, string>();
      if (appendix) {
        for (const e of scoped) {
          try {
            const r = (await getDoc(ocrRef(doc.spaceId, doc.id, e.id))).data() as OcrResult | undefined;
            if (r) ocrTexts.set(e.id, r.editedText ?? r.rawText);
          } catch {
            /* fall back to the cached text */
          }
        }
      }
      const blob = await runExport({
        format,
        resolution,
        includeOcrAppendix: appendix,
        template,
        documentTitle: doc.title,
        dateText: fmt.date(new Date()),
        entries: scoped,
        ocrTexts,
        labels: {
          figureWords: {
            figure: t('numbering.figureWord'),
            fig: t('numbering.figWord'),
            plate: t('numbering.plateWord'),
            image: t('numbering.imageWord'),
          },
          appendixTitle: t('export.appendixTitle'),
          noText: t('export.noText'),
        },
        signal: controller.signal,
        onProgress: (fraction, p) =>
          setProgress({
            fraction,
            text:
              p.phase === 'prepare'
                ? t('export.preparing', { done: p.done, total: p.total })
                : p.phase === 'render'
                  ? t('export.rendering', { done: p.done, total: p.total })
                  : t('export.appendix', { done: p.done, total: p.total }),
          }),
      });
      setResult({ blob, name: filename, url: URL.createObjectURL(blob) });
      countEvent('export', { format, count: scoped.length });
    } catch (e) {
      if (!(e instanceof ExportCancelled)) {
        console.error(e);
        toastError(t('export.failed'));
      }
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const file = result ? new File([result.blob], result.name, { type: result.blob.type }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <main className="page page-narrow">
      <header className="row">
        <div className="grow">
          <h1 className="h1">{t('export.title')}</h1>
          <p className="muted truncate">{doc.title}</p>
        </div>
        <Link to={`/d/${doc.id}`} className="icon-btn" aria-label={t('common.close')}>
          <Icon name="close" />
        </Link>
      </header>

      {!loading && !entries.length ? (
        <EmptyState
          icon="doc"
          title={t('export.emptyTitle')}
          body={t('export.emptyBody')}
          action={
            <Link to={`/d/${doc.id}/capture`} className="btn btn-primary">
              {t('detail.empty.action')}
            </Link>
          }
        />
      ) : (
        <>
          <div className="field">
            <span className="field-label">{t('export.format')}</span>
            <Segmented<ExportFormat>
              block
              label={t('export.format')}
              value={format}
              onChange={setFormat}
              options={[
                { value: 'pdf', label: t('export.formats.pdf') },
                { value: 'docx', label: t('export.formats.docx') },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">{t('export.scope')}</span>
            <Segmented<'all' | 'selected'>
              block
              label={t('export.scope')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('export.scopeAll', { count: entries.length }) },
                {
                  value: 'selected',
                  label: t('export.scopeSelected', { count: selectedIds.length }),
                  disabled: !selectedIds.length,
                },
              ]}
            />
            {!selectedIds.length && <span className="field-hint">{t('export.selectHint')}</span>}
          </div>
          <div className="field">
            <span className="field-label">{t('export.quality')}</span>
            <Segmented<ExportResolution>
              block
              label={t('export.quality')}
              value={resolution}
              onChange={setResolution}
              options={(['low', 'medium', 'high'] as ExportResolution[]).map((r) => ({
                value: r,
                label: t(`export.res.${r}`, { size: formatBytes(estimateBytes(scoped, r)) }),
              }))}
            />
          </div>
          <SwitchRow
            title={t('export.ocrAppendix')}
            hint={t('export.ocrAppendixHint')}
            checked={appendix}
            onChange={setAppendix}
          />
          <TextField
            label={t('export.filename')}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            hint={t('export.filenameHint', { name: filename })}
            className="input mono"
          />

          {missing === null ? (
            <span className="meta">{t('export.checking')}</span>
          ) : missing.length > 0 ? (
            <div className="notice notice-warning" role="alert">
              <Icon name="cloudOff" size={18} />
              <div className="grow col gap-4">
                <span>{t('export.missing', { count: missing.length, list: missing.slice(0, 6).map(labelOf).join(', ') })}</span>
                {online && drive === 'connected' ? (
                  <Button size="sm" busy={fetching} onClick={() => void fetchFromDrive()}>
                    {t('export.fetchMissing')}
                  </Button>
                ) : (
                  <span className="meta">{t('export.missingHelp')}</span>
                )}
              </div>
            </div>
          ) : null}

          {progress && (
            <div className="ocr-box" role="status">
              <div className="row" style={{ fontSize: '0.8125rem' }}>
                <span className="grow">{progress.text}</span>
                <span className="meta">{Math.round(progress.fraction * 100)}%</span>
              </div>
              <Progress value={progress.fraction} label={t('export.progressLabel')} />
            </div>
          )}

          {result && (
            <div className="card card-pad col" role="status">
              <div className="row">
                <Icon name="check" />
                <div className="grow">
                  <div className="h3 truncate">{result.name}</div>
                  <div className="meta">{formatBytes(result.blob.size)}</div>
                </div>
              </div>
              <div className="row wrap">
                {canShare && (
                  <Button
                    variant="primary"
                    icon="share"
                    onClick={() => void navigator.share({ files: [file!], title: doc.title }).catch(() => undefined)}
                  >
                    {t('export.share')}
                  </Button>
                )}
                <a className={`btn ${canShare ? 'btn-secondary' : 'btn-primary'}`} href={result.url} download={result.name}>
                  <Icon name="download" size={18} />
                  {t('export.download')}
                </a>
                <Button variant="ghost" icon="print" onClick={() => navigate(`/d/${doc.id}/print`)}>
                  {t('detail.print')}
                </Button>
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            {progress ? (
              <Button block onClick={() => abort.current?.abort()}>
                {t('common.cancel')}
              </Button>
            ) : (
              <>
                <Link to={`/d/${doc.id}`} className="btn btn-secondary grow">
                  {t('common.cancel')}
                </Link>
                <Button
                  variant="primary"
                  className="grow"
                  disabled={!scoped.length || missing === null || missing.length > 0}
                  onClick={() => void start()}
                >
                  {t(format === 'pdf' ? 'export.exportPdf' : 'export.exportDocx')}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
