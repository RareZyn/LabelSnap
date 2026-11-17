import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed } from '../../stores/sessionStore';
import {
  allTags,
  daysUntilPurge,
  duplicateDocument,
  purgeDocument,
  restoreDocument,
  trashDocument,
  updateDocument,
  useDocuments,
} from '../../data/documents';
import type { DocumentRec } from '../../data/types';
import { useFormat } from '../../hooks/useFormat';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, IconButton, SelectField, Sheet } from '../../components/ui';
import { SyncPill } from '../../components/AppShell';
import { DocCover, NewDocumentSheet } from './shared';
import { confirmDialog, promptDialog } from '../../stores/dialogStore';
import { toast } from '../../stores/toastStore';

type Tab = 'all' | 'pinned' | 'trash';
type Sort = 'updated' | 'title' | 'created';

const millis = (d: DocumentRec, key: 'updatedAt' | 'createdAt') => d[key]?.toMillis?.() ?? Date.now();

export function useDocumentActions() {
  const { t } = useTranslation();
  const { uid } = useAuthed();
  const navigate = useNavigate();
  return {
    rename: async (doc: DocumentRec) => {
      const title = await promptDialog({
        title: t('documents.actions.rename'),
        inputLabel: t('documents.new.name'),
        initialValue: doc.title,
        confirmLabel: t('common.save'),
        cancelLabel: t('common.cancel'),
      });
      if (title) updateDocument(doc.spaceId, doc.id, { title });
    },
    duplicate: async (doc: DocumentRec) => {
      const id = await duplicateDocument(doc, uid, t('documents.copyOf', { title: doc.title }));
      toast(t('documents.duplicated'), { actionLabel: t('common.open'), onAction: () => navigate(`/d/${id}`) });
    },
    togglePin: (doc: DocumentRec) => updateDocument(doc.spaceId, doc.id, { pinned: !doc.pinned }),
    trash: (doc: DocumentRec) => {
      trashDocument(doc);
      toast(t('documents.trashed', { title: doc.title }), {
        actionLabel: t('common.undo'),
        onAction: () => restoreDocument(doc),
      });
    },
    restore: (doc: DocumentRec) => {
      restoreDocument(doc);
      toast(t('documents.restored', { title: doc.title }));
    },
    purge: async (doc: DocumentRec) => {
      const ok = await confirmDialog({
        title: t('documents.purge.title'),
        body: t('documents.purge.body', { title: doc.title, count: doc.entryCount }),
        confirmLabel: t('documents.purge.confirm'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!ok) return;
      await purgeDocument(doc);
      toast(t('documents.purged'));
    },
  };
}

export function DocumentListPage() {
  const { t } = useTranslation();
  const { spaceId } = useAuthed();
  const { data: docs, loading } = useDocuments(spaceId);
  const fmt = useFormat();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'all';
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('ls.docSort') as Sort) || 'updated');
  const [tag, setTag] = useState('');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [menuDoc, setMenuDoc] = useState<DocumentRec | null>(null);
  const actions = useDocumentActions();

  const trashed = docs.filter((d) => d.status === 'trashed');
  const tags = allTags(docs.filter((d) => d.status === 'active'));

  const list = useMemo(() => {
    let out = tab === 'trash' ? trashed : docs.filter((d) => d.status === 'active');
    if (tab === 'pinned') out = out.filter((d) => d.pinned);
    if (tag) out = out.filter((d) => d.tags.includes(tag));
    const q = filter.trim().toLowerCase();
    if (q) out = out.filter((d) => d.title.toLowerCase().includes(q) || d.tags.some((x) => x.includes(q)));
    const cmp = (a: DocumentRec, b: DocumentRec) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'created'
          ? millis(b, 'createdAt') - millis(a, 'createdAt')
          : millis(b, 'updatedAt') - millis(a, 'updatedAt');
    return [...out].sort((a, b) => (tab === 'all' && a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : cmp(a, b)));
  }, [docs, trashed, tab, tag, filter, sort]);

  const setTab = (next: Tab) => setParams(next === 'all' ? {} : { tab: next }, { replace: true });

  return (
    <main className="page paper">
      <header className="row">
        <h1 className="h1 grow">{t('documents.title')}</h1>
        <SyncPill />
        <Button variant="primary" size="sm" icon="plus" onClick={() => setCreating(true)}>
          {t('documents.new.short')}
        </Button>
      </header>

      <div className="tabs" role="tablist" aria-label={t('documents.tabsLabel')}>
        {(['all', 'pinned', 'trash'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === 'trash' && trashed.length ? t('documents.tabs.trashCount', { count: trashed.length }) : t(`documents.tabs.${k}`)}
          </button>
        ))}
      </div>

      <div className="row wrap">
        <div className="grow" style={{ minWidth: 180 }}>
          <label className="sr-only" htmlFor="doc-filter">
            {t('documents.filter')}
          </label>
          <input
            id="doc-filter"
            className="input"
            type="search"
            placeholder={t('documents.filter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <SelectField
            label={t('documents.sort.label')}
            value={sort}
            onChange={(v) => {
              setSort(v as Sort);
              localStorage.setItem('ls.docSort', v);
            }}
            options={[
              { value: 'updated', label: t('documents.sort.updated') },
              { value: 'title', label: t('documents.sort.title') },
              { value: 'created', label: t('documents.sort.created') },
            ]}
          />
        </div>
        {tags.length > 0 && (
          <div style={{ minWidth: 130 }}>
            <SelectField
              label={t('documents.tagFilter')}
              value={tag}
              onChange={setTag}
              options={[{ value: '', label: t('documents.anyTag') }, ...tags.map((x) => ({ value: x, label: x }))]}
            />
          </div>
        )}
      </div>

      {tab === 'trash' && trashed.length > 0 && (
        <div className="notice">
          <Icon name="info" size={16} />
          <span>{t('documents.trashNotice')}</span>
        </div>
      )}

      <section aria-live="polite">
        {!loading && !list.length ? (
          tab === 'trash' ? (
            <EmptyState icon="trash" title={t('documents.emptyTrash')} />
          ) : filter || tag ? (
            <EmptyState
              icon="search"
              title={t('documents.noMatches')}
              action={
                <Button
                  onClick={() => {
                    setFilter('');
                    setTag('');
                  }}
                >
                  {t('documents.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="doc"
              title={tab === 'pinned' ? t('documents.noPinned') : t('documents.empty.title')}
              body={tab === 'pinned' ? t('documents.noPinnedBody') : t('documents.empty.body')}
              action={
                tab === 'all' ? (
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                    {t('documents.new.title')}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          list.map((d) => (
            <div key={d.id} className="doc-row">
              <DocCover doc={d} />
              {tab === 'trash' ? (
                <div className="grow">
                  <div className="truncate" style={{ fontWeight: 500 }}>
                    {d.title}
                  </div>
                  <div className="meta">{t('documents.purgeIn', { count: daysUntilPurge(d) })}</div>
                </div>
              ) : (
                <Link to={`/d/${d.id}`} className="grow col gap-4" style={{ minWidth: 0 }}>
                  <div className="row gap-4" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 500 }}>
                      {d.title}
                    </span>
                    {d.pinned && (
                      <span className="meta" style={{ color: 'var(--accent)' }}>
                        <Icon name="pin" size={12} label={t('documents.pinned')} />
                      </span>
                    )}
                  </div>
                  <div className="row wrap gap-4 meta">
                    {d.tags.map((x) => (
                      <span key={x} className="chip">
                        {x}
                      </span>
                    ))}
                    <span>
                      {t('documents.entryCount', { count: d.entryCount })} · {fmt.relative(d.updatedAt)}
                    </span>
                  </div>
                </Link>
              )}
              <IconButton icon="more" label={t('documents.actions.menu', { title: d.title })} onClick={() => setMenuDoc(d)} />
            </div>
          ))
        )}
      </section>

      <Sheet open={!!menuDoc} onClose={() => setMenuDoc(null)} title={menuDoc?.title}>
        {menuDoc && (
          <div className="col gap-4">
            {menuDoc.status === 'trashed' ? (
              <>
                <Button
                  variant="ghost"
                  icon="restore"
                  onClick={() => {
                    actions.restore(menuDoc);
                    setMenuDoc(null);
                  }}
                >
                  {t('documents.actions.restore')}
                </Button>
                <Button
                  variant="danger-ghost"
                  icon="trash"
                  onClick={() => {
                    void actions.purge(menuDoc);
                    setMenuDoc(null);
                  }}
                >
                  {t('documents.actions.purge')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  icon="edit"
                  onClick={() => {
                    void actions.rename(menuDoc);
                    setMenuDoc(null);
                  }}
                >
                  {t('documents.actions.rename')}
                </Button>
                <Button
                  variant="ghost"
                  icon="duplicate"
                  onClick={() => {
                    void actions.duplicate(menuDoc);
                    setMenuDoc(null);
                  }}
                >
                  {t('documents.actions.duplicate')}
                </Button>
                <Button
                  variant="ghost"
                  icon="pin"
                  onClick={() => {
                    actions.togglePin(menuDoc);
                    setMenuDoc(null);
                  }}
                >
                  {menuDoc.pinned ? t('documents.actions.unpin') : t('documents.actions.pin')}
                </Button>
                <Button
                  variant="danger-ghost"
                  icon="trash"
                  onClick={() => {
                    actions.trash(menuDoc);
                    setMenuDoc(null);
                  }}
                >
                  {t('documents.actions.trash')}
                </Button>
              </>
            )}
          </div>
        )}
      </Sheet>
      <NewDocumentSheet open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
