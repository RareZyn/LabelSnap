import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../../components/Icon';
import { Button, Segmented, TextField } from '../../components/ui';
import { requestPasswordReset, signInWithEmail, signInWithGoogle, signUpWithEmail } from '../../data/session';
import { useOnline } from '../../hooks/useSync';

type Mode = 'login' | 'signup' | 'reset';

function authErrorKey(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'auth.errors.invalidCredentials';
    case 'auth/email-already-in-use':
      return 'auth.errors.emailInUse';
    case 'auth/weak-password':
      return 'auth.errors.weakPassword';
    case 'auth/invalid-email':
      return 'auth.errors.invalidEmail';
    case 'auth/too-many-requests':
      return 'auth.errors.tooMany';
    case 'auth/network-request-failed':
      return 'auth.errors.network';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/operation-not-allowed':
      return 'auth.errors.providerDisabled';
    case 'auth/popup-blocked':
      return 'auth.errors.popupBlocked';
    case 'auth/unauthorized-domain':
      return 'auth.errors.unauthorizedDomain';
    default:
      return 'auth.errors.generic';
  }
}

export function AuthPage() {
  const { t } = useTranslation();
  const online = useOnline();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const fail = (e: unknown) => {
    const key = authErrorKey((e as { code?: string }).code ?? '');
    setError(key ? t(key) : '');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') await signInWithEmail(email, password);
      else if (mode === 'signup') await signUpWithEmail(email, password, name);
      else {
        await requestPasswordReset(email);
        setInfo(t('auth.resetSent', { email }));
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError('');
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth paper">
      <div className="auth-panel">
        <Logo size={34} />
        <div>
          <h1 className="h1">{t(`auth.title.${mode}`)}</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {t(`auth.subtitle.${mode}`)}
          </p>
        </div>
        <Segmented<Mode>
          block
          label={t('auth.modeLabel')}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError('');
            setInfo('');
          }}
          options={[
            { value: 'login', label: t('auth.tabs.login') },
            { value: 'signup', label: t('auth.tabs.signup') },
            { value: 'reset', label: t('auth.tabs.reset') },
          ]}
        />
        {!online && (
          <div className="notice notice-warning" role="status">
            {t('auth.offline')}
          </div>
        )}
        {mode !== 'reset' && (
          <>
            <Button block onClick={google} disabled={busy || !online}>
              <GoogleMark />
              {t('auth.google')}
            </Button>
            <div className="divider">{t('auth.or')}</div>
          </>
        )}
        <form className="col gap-12" onSubmit={submit} noValidate>
          {mode === 'signup' && (
            <TextField
              label={t('auth.name')}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <TextField
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode !== 'reset' && (
            <TextField
              label={t('auth.password')}
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={mode === 'signup' ? t('auth.passwordHint') : undefined}
            />
          )}
          {error && (
            <div className="notice notice-danger" role="alert">
              {error}
            </div>
          )}
          {info && (
            <div className="notice notice-accent" role="status">
              {info}
            </div>
          )}
          <Button type="submit" variant="primary" block busy={busy} disabled={!online || !email || (mode !== 'reset' && !password)}>
            {t(`auth.submit.${mode}`)}
          </Button>
        </form>
        {mode === 'login' && (
          <button type="button" className="link-btn meta" style={{ alignSelf: 'center' }} onClick={() => setMode('reset')}>
            {t('auth.forgot')}
          </button>
        )}
        <p className="meta" style={{ textAlign: 'center', marginTop: 'auto' }}>
          {mode === 'signup' ? t('auth.verifyNote') : t('auth.privacyNote')}
        </p>
      </div>
      <aside className="auth-aside">
        <h2 className="h1">{t('auth.aside.title')}</h2>
        <ol className="col gap-12" style={{ paddingLeft: 18, margin: 0 }}>
          <li>{t('auth.aside.step1')}</li>
          <li>{t('auth.aside.step2')}</li>
          <li>{t('auth.aside.step3')}</li>
        </ol>
      </aside>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
