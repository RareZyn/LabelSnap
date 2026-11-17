import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { useDocuments } from '../../data/documents';
import { useFormat } from '../../hooks/useFormat';
import { Icon } from '../../components/Icon';
import { Button, EmptyState } from '../../components/ui';
import { SyncPill, spaceInitial } from '../../components/AppShell';
import { DocCover, NewDocumentSheet } from '../documents/shared';

function greetingKey(hour: number): string {
  if (hour < 5) return 'home.greeting.evening';
  if (hour < 12) return 'home.greeting.morning';
  if (hour < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

export function HomePage() {
  const { t } = useTranslation();
  const { spaceId, user } = useAuthed();
  const profile = useSession((s) => s.profile);
  const spaces = useSession((s) => s.spaces);
  const space = spaces.find((s) => s.id === spaceId);
  const { data: docs, loading } = useDocuments(spaceId);
  const fmt = useFormat();
  const [creating, setCreating] = useState(false);

  const active = useMemo(
    () =>
      docs
        .filter((d) => d.status === 'active')
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? Date.now()) - (a.updatedAt?.toMillis?.() ?? Date.now())),
    [docs],
  );
  const last = active.find((d) => d.id === profile?.lastDocumentId) ?? active[0];
  const recent = active.filter((d) => d.id !== last?.id).slice(0, 5);
  const name = (profile?.displayName || user.displayName || '').split(' ')[0];

  return (
    <main className="page paper">
      <header className="row">
        <span className="space-badge">{spaceInitial(space?.name)}</span>
        <span className="h3 truncate">{space?.name ?? t('space.personal')}</span>
        <span className="spacer" />
        <SyncPill />
        <Link to="/account" className="icon-btn mobile-only" aria-label={t('nav.account')}>
          <Icon name="user" />
        </Link>
      </header>

      <h1 className="h1">{name ? t(greetingKey(new Date().getHours()), { name }) : t('home.greeting.plain')}</h1>

      {!loading && !active.length ? (
        <EmptyState
          icon="doc"
          title={t('documents.empty.title')}
          body={t('documents.empty.body')}
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              {t('documents.new.title')}
            </Button>
          }
        />
      ) : (
        <>
          {last && (
            <section className="col">
              <h2 className="label">{t('home.continue')}</h2>
              <div className="card continue-card">
                <Link to={`/d/${last.id}`} aria-label={t('home.openDocument', { title: last.title })}>
                  <DocCover doc={last} className="cover" iconSize={28} />
                </Link>
                <div className="row card-pad">
                  <div className="grow">
                    <Link to={`/d/${last.id}`} className="h3 truncate" style={{ display: 'block' }}>
                      {last.title}
                    </Link>
                    <div className="meta">
                      {t('documents.entryCount', { count: last.entryCount })} · {t('home.edited', { when: fmt.relative(last.updatedAt) })}
                    </div>
                  </div>
                  <Link to={`/d/${last.id}/capture`} className="icon-btn" aria-label={t('capture.open')}>
                    <Icon name="camera" />
                  </Link>
                  <Link to={`/d/${last.id}`} className="btn btn-primary btn-sm">
                    {t('home.resume')}
                  </Link>
                </div>
              </div>
            </section>
          )}

          <section className="col" style={{ gap: 0 }}>
            <div className="row" style={{ paddingBottom: 6 }}>
              <h2 className="label grow">{t('home.recent')}</h2>
              <Link to="/documents" className="btn btn-ghost btn-sm">
                {t('home.seeAll')}
              </Link>
            </div>
            {recent.map((d) => (
              <Link key={d.id} to={`/d/${d.id}`} className="doc-row">
                <DocCover doc={d} />
                <div className="grow">
                  <div className="truncate" style={{ fontWeight: 500 }}>
                    {d.title}
                  </div>
                  <div className="meta">
                    {t('documents.entryCount', { count: d.entryCount })} · {fmt.relative(d.updatedAt)}
                  </div>
                </div>
              </Link>
            ))}
            {!recent.length && <p className="meta">{t('home.noRecent')}</p>}
            <div style={{ paddingTop: 12 }}>
              <Button icon="plus" onClick={() => setCreating(true)}>
                {t('documents.new.title')}
              </Button>
            </div>
          </section>
        </>
      )}
      <NewDocumentSheet open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
