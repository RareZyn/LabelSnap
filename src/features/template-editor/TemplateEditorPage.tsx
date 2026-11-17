// Two modes: a Document's format (/d/:docId/template) or a saved Template (/templates/:templateId).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed } from '../../stores/sessionStore';
import { updateDocument, useDocumentRec, useDocuments } from '../../data/documents';
import { useEntries } from '../../data/entries';
import { createTemplate, deleteTemplate, saveTemplate, useTemplates } from '../../data/templates';
import { findTemplate, resolveTemplate, settingsOf } from '../../lib/templates/builtins';
import type { DocumentRec, Template, TemplateSettings } from '../../data/types';
import { TemplateForm } from './TemplateForm';
import { PagePreview } from '../../components/PagePreview';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, SelectField, Spinner } from '../../components/ui';
import { templateName } from '../documents/shared';
import { confirmDialog, promptDialog } from '../../stores/dialogStore';
import { toast } from '../../stores/toastStore';

function overridesFrom(base: TemplateSettings, edited: TemplateSettings): Partial<TemplateSettings> {
  const out: Partial<TemplateSettings> = {};
  for (const k of Object.keys(edited) as Array<keyof TemplateSettings>) {
    if (JSON.stringify(base[k]) !== JSON.stringify(edited[k])) (out as Record<string, unknown>)[k] = edited[k];
  }
  return out;
}

export default function TemplateEditorPage() {
  const { docId, templateId } = useParams();
  const { spaceId } = useAuthed();
  const { data: doc } = useDocumentRec(spaceId, docId);
  const { templates, loading } = useTemplates(spaceId);
  const { t } = useTranslation();

  if (docId) {
    if (!doc) return <main className="page">{doc === null ? <EmptyState icon="doc" title={t('detail.notFound')} /> : <Spinner label={t('common.loading')} />}</main>;
    return <Editor key={doc.id} doc={doc} templates={templates} />;
  }
  if (templateId === 'new') return <Editor key="new" templates={templates} />;
  const tpl = templates.find((x) => x.id === templateId);
  if (!tpl) {
    return <main className="page">{loading ? <Spinner label={t('common.loading')} /> : <EmptyState icon="templates" title={t('templates.notFound')} />}</main>;
  }
  return <Editor key={tpl.id} template={tpl} templates={templates} />;
}

function Editor({ doc, template, templates }: { doc?: DocumentRec; template?: Template; templates: Template[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { spaceId } = useAuthed();
  const { data: entries } = useEntries(doc ? spaceId : null, doc?.id);
  const { data: docs } = useDocuments(spaceId);
  const [baseId, setBaseId] = useState(doc?.templateId ?? template?.id ?? 'builtin-two-up');
  const base = findTemplate(templates, baseId);
  const initial = useMemo<TemplateSettings>(
    () => settingsOf(doc ? resolveTemplate(doc, templates) : (template ?? base)),
    // Initialise once per editor instance; later changes come from the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [settings, setSettings] = useState<TemplateSettings>(initial);
  const [name, setName] = useState(template?.name ?? '');
  const [dirty, setDirty] = useState(false);
  const seeded = useRef(false);

  // User Templates arrive asynchronously: re-seed once if the Document uses one.
  useEffect(() => {
    if (seeded.current || dirty || !doc) return;
    if (templates.some((x) => x.id === doc.templateId)) {
      seeded.current = true;
      setSettings(settingsOf(resolveTemplate(doc, templates)));
    }
  }, [templates, doc, dirty]);

  const readOnly = !!template?.isBuiltIn;
  const usage = template ? docs.filter((d) => d.templateId === template.id && d.status !== 'trashed').length : 0;
  const change = (patch: Partial<TemplateSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const applyBase = (id: string) => {
    setBaseId(id);
    setSettings(settingsOf(findTemplate(templates, id)));
    setDirty(true);
  };

  const saveForDocument = () => {
    if (!doc) return;
    updateDocument(doc.spaceId, doc.id, { templateId: baseId, templateOverrides: overridesFrom(settingsOf(base), settings) });
    setDirty(false);
    toast(t('templates.savedForDoc'));
    navigate(`/d/${doc.id}`);
  };

  const saveAsNew = async () => {
    const n = await promptDialog({
      title: t('templates.saveAsNew'),
      inputLabel: t('templates.name'),
      initialValue: name || (doc ? t('templates.defaultName', { title: doc.title }) : ''),
      confirmLabel: t('common.save'),
      cancelLabel: t('common.cancel'),
    });
    if (!n) return;
    const id = createTemplate(spaceId, n, settings);
    if (doc) {
      updateDocument(doc.spaceId, doc.id, { templateId: id, templateOverrides: {} });
      toast(t('templates.createdAndApplied', { name: n }));
      navigate(`/d/${doc.id}`);
    } else {
      toast(t('templates.created', { name: n }));
      navigate(`/templates/${id}`, { replace: true });
    }
    setDirty(false);
  };

  const saveExisting = () => {
    if (!template || template.isBuiltIn) return;
    saveTemplate(spaceId, template.id, name || template.name, settings);
    setDirty(false);
    toast(t('templates.saved'));
  };

  const remove = async () => {
    if (!template) return;
    const ok = await confirmDialog({
      title: t('templates.delete.title', { name: template.name }),
      body: usage ? t('templates.delete.inUse', { count: usage }) : t('templates.delete.body'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    // Documents using it keep their look: their current settings become their own overrides.
    for (const d of docs.filter((x) => x.templateId === template.id)) {
      updateDocument(d.spaceId, d.id, { templateId: 'builtin-two-up', templateOverrides: settingsOf(resolveTemplate(d, templates)) });
    }
    deleteTemplate(spaceId, template.id);
    navigate('/templates', { replace: true });
  };

  const backHref = doc ? `/d/${doc.id}` : '/templates';
  const title = doc ? t('templates.docFormat') : template ? templateName(t, template) : t('templates.newTitle');

  return (
    <main>
      <div className="topbar">
        <Link to={backHref} className="icon-btn" aria-label={t('common.back')}>
          <Icon name="back" />
        </Link>
        <span className="topbar-crumb truncate">{doc ? doc.title : t('nav.templates')}</span>
        {doc && (
          <Button variant="primary" size="sm" onClick={saveForDocument} disabled={!dirty}>
            {t('common.save')}
          </Button>
        )}
        {template && !template.isBuiltIn && (
          <Button variant="primary" size="sm" onClick={saveExisting} disabled={!dirty}>
            {t('common.save')}
          </Button>
        )}
      </div>
      <div className="step-layout two-col" style={{ paddingTop: 4 }}>
        <div className="col gap-16" style={{ order: 2 }}>
          <h1 className="h1">{title}</h1>
          {doc && (
            <SelectField
              label={t('templates.basedOn')}
              value={baseId}
              onChange={applyBase}
              options={templates.map((x) => ({ value: x.id, label: templateName(t, x) }))}
            />
          )}
          {template && !template.isBuiltIn && (
            <div className="field">
              <label htmlFor="tpl-name">{t('templates.name')}</label>
              <input
                id="tpl-name"
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
              {usage > 0 && <span className="field-hint">{t('templates.usedBy', { count: usage })}</span>}
            </div>
          )}
          {readOnly && (
            <div className="notice">
              <Icon name="lock" size={16} />
              <span>{t('templates.builtinReadOnly')}</span>
            </div>
          )}
          <TemplateForm value={settings} onChange={change} readOnly={readOnly} />
          <div className="row wrap">
            <Button icon="plus" onClick={() => void saveAsNew()}>
              {readOnly ? t('templates.duplicateBuiltin') : t('templates.saveAsNew')}
            </Button>
            {template && !template.isBuiltIn && (
              <Button variant="danger-ghost" icon="trash" onClick={() => void remove()}>
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
        <div className="step-visual" style={{ order: 1 }}>
          <div className="row">
            <span className="label grow" style={{ color: 'var(--accent)' }}>
              ● {t('templates.livePreview')}
            </span>
          </div>
          <PagePreview
            settings={settings}
            entries={doc ? entries : []}
            documentTitle={doc?.title ?? t('templates.sampleDocument')}
            sample={!doc || entries.length === 0}
            maxPages={2}
          />
        </div>
      </div>
    </main>
  );
}
