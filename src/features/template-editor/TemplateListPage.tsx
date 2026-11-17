import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed } from '../../stores/sessionStore';
import { useTemplates } from '../../data/templates';
import { useDocuments } from '../../data/documents';
import { Icon } from '../../components/Icon';
import { templateName } from '../documents/shared';

export default function TemplateListPage() {
  const { t } = useTranslation();
  const { spaceId } = useAuthed();
  const { templates } = useTemplates(spaceId);
  const { data: docs } = useDocuments(spaceId);
  const builtIn = templates.filter((x) => x.isBuiltIn);
  const mine = templates.filter((x) => !x.isBuiltIn);

  const row = (tpl: (typeof templates)[number]) => {
    const used = docs.filter((d) => d.templateId === tpl.id && d.status !== 'trashed').length;
    return (
      <Link key={tpl.id} to={`/templates/${tpl.id}`} className="doc-row">
        <div className="doc-cover">
          <Icon name={tpl.imagesPerPage > 1 ? 'templates' : 'doc'} />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 500 }}>{templateName(t, tpl)}</div>
          <div className="meta">
            {t('templates.summary', {
              size: tpl.pageSize,
              orientation: t(`templates.orientation.${tpl.orientation}`),
              count: tpl.imagesPerPage,
            })}
            {used > 0 && ` · ${t('templates.usedBy', { count: used })}`}
          </div>
        </div>
        <Icon name="chevronRight" size={18} />
      </Link>
    );
  };

  return (
    <main className="page paper">
      <header className="row">
        <h1 className="h1 grow">{t('nav.templates')}</h1>
        <Link to="/templates/new" className="btn btn-primary btn-sm">
          <Icon name="plus" size={16} />
          {t('templates.new')}
        </Link>
      </header>
      <section>
        <h2 className="label">{t('templates.builtinHeading')}</h2>
        {builtIn.map(row)}
      </section>
      <section>
        <h2 className="label">{t('templates.mineHeading')}</h2>
        {mine.length ? mine.map(row) : <p className="meta">{t('templates.noneSaved')}</p>}
      </section>
    </main>
  );
}
