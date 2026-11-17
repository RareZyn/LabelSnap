import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { refreshUser, resendVerification, signOut, updateAccountProfile } from '../../data/session';
import { resizeJpeg } from '../../lib/imaging/canvas';
import { Icon } from '../../components/Icon';
import { Button, TextField } from '../../components/ui';
import { toast, toastError } from '../../stores/toastStore';

async function avatarDataUrl(file: File): Promise<string> {
  // Small enough to live on the profile document (no image storage needed).
  for (const [size, q] of [
    [160, 0.8],
    [128, 0.7],
    [96, 0.6],
  ] as const) {
    const { blob } = await resizeJpeg(file, size, q);
    if (blob.size < 60_000) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }
  }
  throw new Error('avatar-too-large');
}

export default function AccountPage() {
  const { t } = useTranslation();
  const { user } = useAuthed();
  const profile = useSession((s) => s.profile);
  const [name, setName] = useState(profile?.displayName || user.displayName || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isPassword = user.providerData.some((p) => p.providerId === 'password');
  const photo = profile?.photoURL || user.photoURL || '';

  const saveName = async () => {
    setBusy(true);
    try {
      await updateAccountProfile({ displayName: name.trim() });
      toast(t('account.saved'));
    } catch {
      toastError(t('errors.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      await updateAccountProfile({ photoURL: await avatarDataUrl(file) });
      toast(t('account.photoSaved'));
    } catch {
      toastError(t('account.photoFailed'));
    }
  };

  return (
    <main className="page page-narrow paper">
      <header className="row">
        <Link to="/settings" className="icon-btn" aria-label={t('common.back')}>
          <Icon name="back" />
        </Link>
        <h1 className="h1 grow">{t('account.title')}</h1>
      </header>

      <section className="card card-pad col gap-16">
        <div className="row gap-16">
          <div
            className="doc-cover"
            style={{ width: 72, height: 72, borderRadius: '50%' }}
            aria-hidden="true"
          >
            {photo ? <img src={photo} alt="" /> : <Icon name="user" size={32} />}
          </div>
          <div className="col gap-4">
            <Button size="sm" icon="camera" onClick={() => fileRef.current?.click()}>
              {t('account.changePhoto')}
            </Button>
            {photo && (
              <Button size="sm" variant="ghost" onClick={() => void updateAccountProfile({ photoURL: '' })}>
                {t('account.removePhoto')}
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </div>
        </div>
        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <div className="grow">
            <TextField label={t('account.name')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <Button type="submit" busy={busy} disabled={name.trim() === (profile?.displayName ?? user.displayName ?? '')}>
            {t('common.save')}
          </Button>
        </form>
      </section>

      <section className="card card-pad col gap-12">
        <h2 className="h2">{t('account.email')}</h2>
        <div className="row wrap">
          <span className="grow">{user.email}</span>
          {isPassword &&
            (user.emailVerified ? (
              <span className="pill" style={{ background: 'var(--success-tint)', color: 'var(--success)' }}>
                <Icon name="check" size={14} />
                {t('account.verified')}
              </span>
            ) : (
              <span className="pill pill-warning">
                <Icon name="alert" size={14} />
                {t('account.unverified')}
              </span>
            ))}
        </div>
        {isPassword && !user.emailVerified && (
          <div className="col gap-4">
            <p className="meta">{t('account.verifyHelp')}</p>
            <div className="row wrap">
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await resendVerification();
                    toast(t('account.verificationSent'));
                  } catch {
                    toastError(t('auth.errors.tooMany'));
                  }
                }}
              >
                {t('account.resend')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => toast((await refreshUser()) ? t('account.nowVerified') : t('account.stillUnverified'))}
              >
                {t('account.checkAgain')}
              </Button>
            </div>
          </div>
        )}
        <p className="meta">
          {t('account.providers', {
            list: user.providerData.map((p) => t(`account.provider.${p.providerId === 'google.com' ? 'google' : 'password'}`)).join(', '),
          })}
        </p>
      </section>

      <Button variant="danger-ghost" icon="logout" onClick={() => void signOut()}>
        {t('settings.signOut')}
      </Button>
    </main>
  );
}
