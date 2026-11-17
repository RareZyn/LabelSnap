import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { useDriveStore } from '../../stores/driveStore';
import { updatePrefs, signOut } from '../../data/session';
import { useTemplates } from '../../data/templates';
import { connectDrive, disconnectDrive, isDriveConfigured, rememberDriveEmail } from '../../lib/drive/gis';
import { getDriveEmail } from '../../lib/drive/driveApi';
import { clearOcrData, OCR_LANGUAGES, languageName, languageDownloadSize, isMeteredConnection } from '../../lib/ocr/ocrService';
import { evictUploadedImages, formatBytes, storageUsage, type StorageUsage } from '../../lib/sync/quota';
import { discardFailed, drainQueue, retryFailed } from '../../lib/sync/uploadQueue';
import { useOnline, useQueueSummary } from '../../hooks/useSync';
import { APP_VERSION, REPORT_PROBLEM_URL } from '../../config';
import type { CaptureQuality, DateFormat, ThemeName } from '../../data/types';
import { Icon } from '../../components/Icon';
import { Button, Progress, Segmented, SelectField, SwitchRow } from '../../components/ui';
import { templateName } from '../documents/shared';
import { confirmDialog } from '../../stores/dialogStore';
import { toast, toastError } from '../../stores/toastStore';
import { formatDate } from '../../hooks/useFormat';

type PermState = PermissionState | 'unsupported';

async function permission(name: string): Promise<PermState> {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return 'unsupported';
  }
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card card-pad col gap-12" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { spaceId } = useAuthed();
  const prefs = useSession((s) => s.prefs);
  const { templates } = useTemplates(spaceId);
  const drive = useDriveStore();
  const queue = useQueueSummary();
  const online = useOnline();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [perms, setPerms] = useState<Record<string, PermState>>({});
  const [langToAdd, setLangToAdd] = useState('');
  const [addSize, setAddSize] = useState<number | null>(null);

  const refreshUsage = () => void storageUsage().then(setUsage);
  useEffect(refreshUsage, [queue.pending]);
  useEffect(() => {
    void Promise.all(['camera', 'microphone', 'geolocation'].map(async (n) => [n, await permission(n)] as const)).then((r) =>
      setPerms(Object.fromEntries(r)),
    );
  }, []);
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  useEffect(() => {
    setAddSize(null);
    if (langToAdd) void languageDownloadSize(langToAdd).then(setAddSize);
  }, [langToAdd]);

  const connect = () => {
    connectDrive('consent')
      .then(async () => rememberDriveEmail(await getDriveEmail().catch(() => undefined)))
      .then(() => {
        toast(t('drive.connected'));
        void drainQueue();
      })
      .catch((e: Error) => {
        if (e.message !== 'popup_closed') toastError(t('drive.connectFailed'));
      });
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: t('drive.disconnectTitle'),
      body: t('drive.disconnectBody'),
      confirmLabel: t('drive.disconnect'),
      cancelLabel: t('common.cancel'),
    });
    if (ok) disconnectDrive();
  };

  const addLanguage = async () => {
    if (!langToAdd || prefs.ocrLanguages.includes(langToAdd)) return;
    if (isMeteredConnection()) {
      const ok = await confirmDialog({
        title: t('ocr.meteredTitle'),
        body: t('ocr.meteredBody', { name: languageName(langToAdd), size: addSize ? formatBytes(addSize) : t('ocr.unknownSize') }),
        confirmLabel: t('common.add'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    updatePrefs({ ocrLanguages: [...prefs.ocrLanguages, langToAdd] });
    setLangToAdd('');
  };

  const sample = new Date(2026, 10, 17);
  const permLabel = (s: PermState | undefined) => t(`settings.perm.${s ?? 'unsupported'}`);

  return (
    <main className="page page-narrow paper">
      <h1 className="h1">{t('settings.title')}</h1>

      <Section id="account" title={t('settings.account')}>
        <Link to="/account" className="list-row">
          <Icon name="user" />
          <span className="grow">{t('settings.profile')}</span>
          <Icon name="chevronRight" size={18} />
        </Link>
        <Link to="/templates" className="list-row">
          <Icon name="templates" />
          <span className="grow">{t('nav.templates')}</span>
          <Icon name="chevronRight" size={18} />
        </Link>
      </Section>

      <Section id="drive" title={t('drive.title')}>
        <p className="muted">{t('drive.explain')}</p>
        {drive.status === 'unconfigured' ? (
          <div className="notice notice-warning">
            <Icon name="alert" size={16} />
            <span>{t('drive.unconfigured')}</span>
          </div>
        ) : (
          <div className="row wrap">
            <span className={`pill ${drive.status === 'connected' ? '' : 'pill-muted'}`}>
              <Icon name="drive" size={14} />
              {t(`drive.status.${drive.status}`)}
              {drive.email ? ` · ${drive.email}` : ''}
            </span>
            <span className="spacer" />
            {drive.status === 'connected' ? (
              <Button size="sm" onClick={() => void disconnect()}>
                {t('drive.disconnect')}
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={!online || !isDriveConfigured()} onClick={connect}>
                {drive.status === 'expired' ? t('drive.reconnect') : t('drive.connect')}
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section id="sync" title={t('settings.sync')}>
        <p className="muted">
          {!online ? t('sync.offline') : queue.pending ? t('sync.pendingCount', { count: queue.pending }) : t('settings.allSynced')}
        </p>
        {queue.failed > 0 && (
          <div className="notice notice-danger" role="alert">
            <Icon name="alert" size={16} />
            <div className="grow col gap-4">
              <span>{t('banners.syncFailed', { count: queue.failed })}</span>
              {queue.failedErrors[0] && <span className="meta mono">{queue.failedErrors[0]}</span>}
              <div className="row">
                <Button size="sm" onClick={() => void retryFailed()}>
                  {t('common.retry')}
                </Button>
                <Button
                  size="sm"
                  variant="danger-ghost"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t('settings.discardFailedTitle'),
                      body: t('settings.discardFailedBody'),
                      confirmLabel: t('settings.discard'),
                      cancelLabel: t('common.cancel'),
                      destructive: true,
                    });
                    if (ok) await discardFailed();
                  }}
                >
                  {t('settings.discard')}
                </Button>
              </div>
            </div>
          </div>
        )}
        <Button size="sm" icon="sync" onClick={() => void drainQueue()} disabled={!online}>
          {t('settings.syncNow')}
        </Button>
      </Section>

      <Section id="storage" title={t('settings.storage')}>
        {usage ? (
          <>
            {usage.quota > 0 && (
              <>
                <Progress value={usage.usage / usage.quota} label={t('settings.storageUsed')} />
                <span className="meta">
                  {t('settings.storageOf', { used: formatBytes(usage.usage), quota: formatBytes(usage.quota) })}
                </span>
              </>
            )}
            <dl className="props">
              <dt>{t('settings.images')}</dt>
              <dd>
                {formatBytes(usage.images)}
                {usage.imagesUnsynced > 0 && <span className="meta"> · {t('settings.unsynced', { size: formatBytes(usage.imagesUnsynced) })}</span>}
              </dd>
              <dt>{t('settings.ocrData')}</dt>
              <dd>{formatBytes(usage.ocrData)}</dd>
            </dl>
            <div className="row wrap">
              <Button
                size="sm"
                disabled={!usage.imagesEvictable}
                onClick={async () => {
                  const freed = await evictUploadedImages();
                  toast(t('settings.freed', { size: formatBytes(freed) }));
                  refreshUsage();
                }}
              >
                {t('settings.freeImages', { size: formatBytes(usage.imagesEvictable) })}
              </Button>
              <Button
                size="sm"
                variant="danger-ghost"
                disabled={!usage.ocrData}
                onClick={async () => {
                  await clearOcrData();
                  toast(t('settings.ocrCleared'));
                  refreshUsage();
                }}
              >
                {t('settings.clearOcr')}
              </Button>
            </div>
            <p className="meta">{t('settings.storageNote')}</p>
          </>
        ) : (
          <span className="meta">{t('common.loading')}</span>
        )}
      </Section>

      <Section id="capture" title={t('settings.capture')}>
        <div className="field">
          <span className="field-label">{t('settings.captureQuality')}</span>
          <Segmented<CaptureQuality>
            block
            label={t('settings.captureQuality')}
            value={prefs.captureQuality}
            onChange={(v) => updatePrefs({ captureQuality: v })}
            options={(['low', 'medium', 'high'] as CaptureQuality[]).map((q) => ({ value: q, label: t(`settings.quality.${q}`) }))}
          />
        </div>
        <div className="field">
          <label htmlFor="compression" className="field-label">
            {t('settings.compression')} <span className="meta">{Math.round(prefs.compressionTarget * 100)}%</span>
          </label>
          <input
            id="compression"
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={prefs.compressionTarget}
            onChange={(e) => updatePrefs({ compressionTarget: Number(e.target.value) })}
            style={{ accentColor: 'var(--accent)', minHeight: 32 }}
          />
          <span className="field-hint">{t('settings.compressionHint')}</span>
        </div>
        <SwitchRow title={t('settings.autoDetect')} checked={prefs.autoDetect} onChange={(v) => updatePrefs({ autoDetect: v })} />
        <SwitchRow title={t('settings.grid')} checked={prefs.showGrid} onChange={(v) => updatePrefs({ showGrid: v })} />
        <SelectField
          label={t('settings.defaultTemplate')}
          value={prefs.defaultTemplateId}
          onChange={(v) => updatePrefs({ defaultTemplateId: v })}
          options={templates.map((x) => ({ value: x.id, label: templateName(t, x) }))}
        />
      </Section>

      <Section id="ocr" title={t('settings.ocr')}>
        <SwitchRow
          title={t('settings.ocrEnabled')}
          hint={t('settings.ocrEnabledHint')}
          checked={prefs.ocrEnabled}
          onChange={(v) => updatePrefs({ ocrEnabled: v })}
        />
        <div className="field">
          <span className="field-label">{t('settings.ocrLanguages')}</span>
          <div className="row wrap gap-4">
            {prefs.ocrLanguages.map((l) => (
              <span key={l} className="chip">
                {languageName(l, prefs.locale)}
                {prefs.ocrLanguages.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('settings.removeLanguage', { name: languageName(l, prefs.locale) })}
                    onClick={() => updatePrefs({ ocrLanguages: prefs.ocrLanguages.filter((x) => x !== l) })}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="grow">
            <SelectField
              label={t('settings.addLanguage')}
              value={langToAdd}
              onChange={setLangToAdd}
              options={[
                { value: '', label: t('settings.chooseLanguage') },
                ...OCR_LANGUAGES.filter((l) => !prefs.ocrLanguages.includes(l.code)).map((l) => ({
                  value: l.code,
                  label: languageName(l.code, prefs.locale),
                })),
              ]}
            />
          </div>
          <Button disabled={!langToAdd} onClick={() => void addLanguage()}>
            {t('common.add')}
          </Button>
        </div>
        {langToAdd && (
          <span className="field-hint">
            {t('settings.languageSize', { size: addSize ? formatBytes(addSize) : t('ocr.unknownSize') })}
          </span>
        )}
        <p className="meta">{t('settings.ocrNote')}</p>
      </Section>

      <Section id="display" title={t('settings.display')}>
        <div className="field">
          <span className="field-label">{t('settings.theme')}</span>
          <Segmented<ThemeName>
            label={t('settings.theme')}
            value={prefs.theme}
            onChange={(v) => updatePrefs({ theme: v })}
            options={[
              { value: 'light', label: t('settings.themes.light') },
              { value: 'highContrast', label: t('settings.themes.highContrast') },
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="text-scale" className="field-label">
            {t('settings.textSize')} <span className="meta">{Math.round(prefs.textScale * 100)}%</span>
          </label>
          <input
            id="text-scale"
            type="range"
            min={1}
            max={1.5}
            step={0.05}
            value={prefs.textScale}
            onChange={(e) => updatePrefs({ textScale: Number(e.target.value) })}
            style={{ accentColor: 'var(--accent)', minHeight: 32 }}
          />
        </div>
        <SelectField
          label={t('settings.dateFormat')}
          value={prefs.dateFormat}
          onChange={(v) => updatePrefs({ dateFormat: v as DateFormat })}
          options={(['iso', 'dmy', 'mdy', 'long'] as DateFormat[]).map((f) => ({
            value: f,
            label: formatDate(sample, f, prefs.locale || navigator.language),
          }))}
        />
        <SwitchRow title={t('settings.time24')} checked={prefs.timeFormat24h} onChange={(v) => updatePrefs({ timeFormat24h: v })} />
        <p className="meta">{t('settings.reducedMotion')}</p>
      </Section>

      <Section id="permissions" title={t('settings.permissions')}>
        <dl className="props" style={{ gridTemplateColumns: '120px 1fr' }}>
          <dt>{t('settings.permCamera')}</dt>
          <dd>{permLabel(perms.camera)}</dd>
          <dt>{t('settings.permMic')}</dt>
          <dd>{permLabel(perms.microphone)}</dd>
          <dt>{t('settings.permLocation')}</dt>
          <dd>{permLabel(perms.geolocation)}</dd>
        </dl>
        {Object.values(perms).includes('denied') && (
          <div className="notice">
            <Icon name="info" size={16} />
            <span>{t('settings.permDeniedHelp')}</span>
          </div>
        )}
        <SwitchRow
          title={t('settings.locationConsent')}
          hint={t('settings.locationConsentHint')}
          checked={prefs.captureLocationConsent}
          onChange={(v) => updatePrefs({ captureLocationConsent: v })}
        />
      </Section>

      <Section id="privacy" title={t('settings.privacy')}>
        <SwitchRow
          title={t('settings.analytics')}
          hint={t('settings.analyticsHint')}
          checked={!prefs.analyticsOptOut}
          onChange={(v) => updatePrefs({ analyticsOptOut: !v })}
        />
      </Section>

      <Section id="help" title={t('settings.help')}>
        <Button variant="ghost" icon="info" onClick={() => navigate('/onboarding?replay=1')} className="menu-item">
          {t('settings.replayIntro')}
        </Button>
        <a className="btn btn-ghost" href={REPORT_PROBLEM_URL}>
          <Icon name="bug" size={18} />
          {t('settings.report')}
        </a>
        <p className="meta">{t('settings.version', { version: APP_VERSION })}</p>
      </Section>

      <Button variant="danger-ghost" icon="logout" onClick={() => void signOut()}>
        {t('settings.signOut')}
      </Button>
    </main>
  );
}
