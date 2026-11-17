import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from '../../components/Icon';
import { useSession } from '../../stores/sessionStore';
import { APP_VERSION } from '../../config';
import { toast } from '../../stores/toastStore';

export function SplashScreen() {
  const { t } = useTranslation();
  return (
    <div className="splash paper" role="status" aria-label={t('common.loading')}>
      <Logo size={56} />
      <div className="h1">LabelSnap</div>
      <div className="meta">{t('splash.version', { version: APP_VERSION })}</div>
    </div>
  );
}

/** Splash / version check, then route by auth state. */
export function Splash() {
  const { t } = useTranslation();
  const status = useSession((s) => s.status);
  const prefs = useSession((s) => s.prefs);
  const prefsLoaded = useSession((s) => s.prefsLoaded);

  useEffect(() => {
    try {
      const last = localStorage.getItem('ls.version');
      if (last && last !== APP_VERSION) toast(t('splash.updated', { version: APP_VERSION }));
      localStorage.setItem('ls.version', APP_VERSION);
    } catch {
      /* storage unavailable */
    }
  }, [t]);

  if (status === 'loading') return <SplashScreen />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (!prefsLoaded) return <SplashScreen />;
  return <Navigate to={prefs.onboardingDone ? '/home' : '/onboarding'} replace />;
}
