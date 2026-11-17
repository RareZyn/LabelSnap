import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../stores/sessionStore';
import { useAppStore, isIos, isStandalone } from '../stores/appStore';
import { useDriveStore } from '../stores/driveStore';
import { useDocuments, purgeExpiredTrash } from '../data/documents';
import { useOnline, useQueueSummary } from '../hooks/useSync';
import { connectDrive } from '../lib/drive/gis';
import { retryFailed } from '../lib/sync/uploadQueue';
import { storageUsage, QUOTA_WARNING_RATIO } from '../lib/sync/quota';
import { Icon, Logo } from './Icon';
import { Button } from './ui';
import { toastError } from '../stores/toastStore';

const TOP_LEVEL = ['/home', '/documents', '/templates', '/settings', '/account'];
const INSTALL_AFTER_ENTRIES = 3;

export function SyncPill() {
  const { t } = useTranslation();
  const online = useOnline();
  const { pending, failed } = useQueueSummary();
  if (online && pending === 0 && failed === 0) return null;
  const label = !online
    ? pending
      ? t('sync.offlinePending', { count: pending })
      : t('sync.offline')
    : failed
      ? t('sync.failedCount', { count: failed })
      : t('sync.pendingCount', { count: pending });
  return (
    <Link to="/settings#sync" className={`pill ${!online ? 'pill-muted' : failed ? 'pill-warning' : ''}`}>
      {online ? <span className="pill-dot" /> : <Icon name="cloudOff" size={14} />}
      {label}
    </Link>
  );
}

function useDriveConnect() {
  const { t } = useTranslation();
  return () => {
    connectDrive('').catch((e: Error) => {
      if (e.message !== 'popup_closed') toastError(t('drive.connectFailed'));
    });
  };
}

function Banners() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const { pending, failed } = useQueueSummary();
  const drive = useDriveStore((s) => s.status);
  const { updateReady, applyUpdate, captureBusy, installEvent, set } = useAppStore();
  const connect = useDriveConnect();
  const [quotaWarn, setQuotaWarn] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('ls.installDismissed') === '1');
  const savedCount = Number(localStorage.getItem('ls.savedCount') || '0');

  useEffect(() => {
    let alive = true;
    const check = () =>
      void storageUsage().then((u) => alive && setQuotaWarn(u.quota > 0 && u.usage / u.quota > QUOTA_WARNING_RATIO));
    check();
    const id = setInterval(check, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pending]);

  const dismissInstall = () => {
    localStorage.setItem('ls.installDismissed', '1');
    setInstallDismissed(true);
  };

  const showInstall = !installDismissed && !isStandalone() && savedCount >= INSTALL_AFTER_ENTRIES;

  return (
    <>
      {updateReady && !captureBusy && (
        <div className="banner banner-accent" role="status">
          <Icon name="sync" size={16} />
          <span className="grow">{t('banners.update')}</span>
          <Button size="sm" variant="primary" onClick={() => applyUpdate?.()}>
            {t('banners.reload')}
          </Button>
        </div>
      )}
      {failed > 0 && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" size={16} />
          <span className="grow">{t('banners.syncFailed', { count: failed })}</span>
          <Button size="sm" onClick={() => void retryFailed()}>
            {t('common.retry')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/settings#sync')}>
            {t('common.details')}
          </Button>
        </div>
      )}
      {online && pending > 0 && (drive === 'expired' || drive === 'disconnected') && (
        <div className="banner banner-accent" role="status">
          <Icon name="drive" size={16} />
          <span className="grow">
            {drive === 'expired' ? t('banners.driveExpired', { count: pending }) : t('banners.driveConnect', { count: pending })}
          </span>
          <Button size="sm" variant="primary" onClick={connect}>
            {drive === 'expired' ? t('drive.reconnect') : t('drive.connect')}
          </Button>
        </div>
      )}
      {quotaWarn && (
        <div className="banner banner-warning" role="status">
          <Icon name="alert" size={16} />
          <span className="grow">{t('banners.quota')}</span>
          <Button size="sm" onClick={() => navigate('/settings#storage')}>
            {t('banners.manageStorage')}
          </Button>
        </div>
      )}
      {showInstall && (installEvent || isIos()) && (
        <div className="banner banner-accent" role="status">
          <Icon name="download" size={16} />
          <span className="grow">{installEvent ? t('banners.install') : t('banners.installIos')}</span>
          {installEvent && (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                await installEvent.prompt();
                await installEvent.userChoice.catch(() => undefined);
                set({ installEvent: null });
                dismissInstall();
              }}
            >
              {t('banners.installAction')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={dismissInstall}>
            {t('common.notNow')}
          </Button>
        </div>
      )}
    </>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  const spaceId = useSession((s) => s.spaceId);
  const spaces = useSession((s) => s.spaces);
  const space = spaces.find((s) => s.id === spaceId);
  const { data: docs } = useDocuments(spaceId);
  const pinned = docs.filter((d) => d.pinned && d.status === 'active');
  return (
    <nav className="sidebar" aria-label={t('nav.main')}>
      <div className="row" style={{ padding: '6px 8px', marginBottom: 8 }}>
        <Logo size={28} />
        <span className="truncate" style={{ fontWeight: 600, color: 'var(--text)' }}>
          {space?.name ?? t('space.personal')}
        </span>
      </div>
      <NavLink to="/home">
        <Icon name="home" size={16} />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/documents">
        <Icon name="doc" size={16} />
        {t('nav.documents')}
      </NavLink>
      <NavLink to="/templates">
        <Icon name="templates" size={16} />
        {t('nav.templates')}
      </NavLink>
      <NavLink to="/settings">
        <Icon name="settings" size={16} />
        {t('nav.settings')}
      </NavLink>
      {pinned.length > 0 && <div className="sidebar-section">{t('nav.pinned')}</div>}
      {pinned.map((d) => (
        <NavLink key={d.id} to={`/d/${d.id}`}>
          <Icon name="doc" size={16} />
          <span className="truncate">{d.title}</span>
        </NavLink>
      ))}
      <div className="spacer" />
      <div style={{ padding: 8 }}>
        <SyncPill />
      </div>
    </nav>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav className="bottom-nav" aria-label={t('nav.main')}>
      <NavLink to="/home">
        <Icon name="home" />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/documents">
        <Icon name="doc" />
        {t('nav.documents')}
      </NavLink>
      <NavLink to="/settings">
        <Icon name="settings" />
        {t('nav.settings')}
      </NavLink>
    </nav>
  );
}

export function AppShell() {
  const location = useLocation();
  const spaceId = useSession((s) => s.spaceId);
  const { data: docs, loading } = useDocuments(spaceId);
  const purged = useRef(false);

  useEffect(() => {
    if (loading || purged.current || !docs.length) return;
    purged.current = true;
    void purgeExpiredTrash(docs);
  }, [docs, loading]);

  // Each screen starts at the top, unless the URL targets a section.
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  const isTop = TOP_LEVEL.includes(location.pathname);
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Banners />
        <Outlet />
      </div>
      {isTop && <BottomNav />}
    </div>
  );
}
