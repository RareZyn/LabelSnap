// Print-optimised view: the same pages as the PDF, rendered in HTML at print resolution.

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed } from '../../stores/sessionStore';
import { useDocumentRec } from '../../data/documents';
import { useEntries } from '../../data/entries';
import { useTemplates } from '../../data/templates';
import { resolveTemplate } from '../../lib/templates/builtins';
import { pageDimensions } from '../../lib/templates/layout';
import { PagePreview } from '../../components/PagePreview';
import { Icon } from '../../components/Icon';
import { Button, Spinner } from '../../components/ui';

export default function PrintPage() {
  const { t } = useTranslation();
  const { docId } = useParams();
  const { spaceId } = useAuthed();
  const { data: doc } = useDocumentRec(spaceId, docId);
  const { data: entries } = useEntries(spaceId, docId);
  const { templates } = useTemplates(spaceId);
  const template = useMemo(() => (doc ? resolveTemplate(doc, templates) : null), [doc, templates]);
  if (!doc || !template) return <Spinner label={t('common.loading')} />;
  const dims = pageDimensions(template.pageSize, template.orientation);

  return (
    <div style={{ background: 'var(--surface-muted)', minHeight: '100dvh' }}>
      <style>{`@media print { @page { size: ${dims.w}pt ${dims.h}pt; margin: 0; } }`}</style>
      <div className="topbar no-print">
        <Link to={`/d/${doc.id}`} className="icon-btn" aria-label={t('common.back')}>
          <Icon name="back" />
        </Link>
        <span className="topbar-title truncate">{t('print.title', { title: doc.title })}</span>
        <Button variant="primary" size="sm" icon="print" onClick={() => window.print()}>
          {t('print.print')}
        </Button>
      </div>
      <p className="meta no-print" style={{ padding: '0 16px 12px' }}>
        {t('print.hint')}
      </p>
      <PagePreview settings={template} entries={entries} documentTitle={doc.title} variant="derived" print />
    </div>
  );
}
