import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/ui';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="splash paper">
      <EmptyState
        icon="doc"
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <Link to="/" className="btn btn-primary">
            {t('notFound.home')}
          </Link>
        }
      />
    </main>
  );
}
