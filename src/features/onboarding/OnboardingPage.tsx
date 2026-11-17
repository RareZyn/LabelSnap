// First-run walkthrough of the capture-to-document flow. Skippable, and replayable from Settings.

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { updatePrefs } from '../../data/session';
import { connectDrive, isDriveConfigured, rememberDriveEmail } from '../../lib/drive/gis';
import { getDriveEmail } from '../../lib/drive/driveApi';
import { useDriveStore } from '../../stores/driveStore';
import { Icon, type IconName } from '../../components/Icon';
import { Button } from '../../components/ui';
import { toastError } from '../../stores/toastStore';

const STEPS: Array<{ key: string; icon: IconName }> = [
  { key: 'document', icon: 'doc' },
  { key: 'capture', icon: 'scan' },
  { key: 'review', icon: 'text' },
  { key: 'export', icon: 'download' },
];

export default function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.has('replay');
  const [i, setI] = useState(0);
  const drive = useDriveStore((s) => s.status);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = () => {
    if (!replay) updatePrefs({ onboardingDone: true });
    navigate(replay ? '/settings' : '/home', { replace: true });
  };

  return (
    <main className="onboard paper">
      <div className="row">
        <span className="meta grow">{t('onboarding.counter', { n: i + 1, total: STEPS.length })}</span>
        <Button variant="ghost" size="sm" onClick={finish}>
          {t('onboarding.skip')}
        </Button>
      </div>
      <div className="onboard-art" aria-hidden="true">
        <Icon name={step.icon} size={88} strokeWidth={1.1} />
      </div>
      <div className="col gap-12" aria-live="polite">
        <h1 className="h1">{t(`onboarding.${step.key}.title`)}</h1>
        <p className="muted">{t(`onboarding.${step.key}.body`)}</p>
        {last && isDriveConfigured() && drive !== 'connected' && (
          <div className="notice notice-accent">
            <Icon name="drive" size={18} />
            <div className="col gap-4 grow">
              <span>{t('onboarding.drive')}</span>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  connectDrive('consent')
                    .then(async () => rememberDriveEmail(await getDriveEmail().catch(() => undefined)))
                    .catch((e: Error) => e.message !== 'popup_closed' && toastError(t('drive.connectFailed')))
                }
              >
                {t('drive.connect')}
              </Button>
            </div>
          </div>
        )}
        {last && drive === 'connected' && (
          <div className="notice">
            <Icon name="check" size={18} />
            <span>{t('drive.connected')}</span>
          </div>
        )}
      </div>
      <div className="dots" role="presentation">
        {STEPS.map((s, k) => (
          <span key={s.key} aria-current={k === i} />
        ))}
      </div>
      <div className="row">
        {i > 0 && (
          <Button onClick={() => setI(i - 1)} className="grow">
            {t('common.back')}
          </Button>
        )}
        <Button variant="primary" className="grow" onClick={() => (last ? finish() : setI(i + 1))}>
          {last ? t('onboarding.start') : t('common.next')}
        </Button>
      </div>
    </main>
  );
}
