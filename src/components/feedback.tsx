import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToastStore } from '../stores/toastStore';
import { useDialogStore } from '../stores/dialogStore';
import { Button, Sheet, TextField } from './ui';
import { Icon } from './Icon';
import type { OcrState, SyncState } from '../data/types';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const { t: tr } = useTranslation();
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label={tr('common.notifications')}>
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="grow">{t.message}</span>
          {t.actionLabel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                t.onAction?.();
                dismiss(t.id);
              }}
            >
              {t.actionLabel}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const set = useDialogStore((s) => s.set);
  const [value, setValue] = useState('');
  useEffect(() => setValue(current?.initialValue ?? ''), [current]);
  if (!current) return null;
  const close = (result: string | boolean | null) => {
    current.resolve(result);
    set(null);
  };
  const submit = () => close(current.kind === 'prompt' ? value.trim() || null : true);
  return (
    <Sheet
      open
      onClose={() => close(current.kind === 'prompt' ? null : false)}
      title={current.title}
      actions={
        <>
          <Button onClick={() => close(current.kind === 'prompt' ? null : false)}>{current.cancelLabel}</Button>
          <Button
            variant={current.destructive ? 'danger' : 'primary'}
            onClick={submit}
            disabled={current.kind === 'prompt' && !value.trim()}
          >
            {current.confirmLabel}
          </Button>
        </>
      }
    >
      {current.body && <p className="muted">{current.body}</p>}
      {current.kind === 'prompt' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) submit();
          }}
        >
          <TextField label={current.inputLabel ?? ''} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </form>
      )}
    </Sheet>
  );
}

export function SyncBadge({ state }: { state: SyncState }) {
  const { t } = useTranslation();
  const icon = state === 'synced' ? 'check' : state === 'failed' ? 'alert' : state === 'uploading' ? 'sync' : 'cloudOff';
  return (
    <span className={`status status-${state}`}>
      <Icon name={icon} size={12} strokeWidth={2} />
      {t(`sync.${state}`)}
    </span>
  );
}

export function OcrBadge({ state, confidence }: { state: OcrState; confidence?: number | null }) {
  const { t } = useTranslation();
  if (state === 'disabled') return null;
  return (
    <span className={`status ${state === 'failed' ? 'status-failed' : state === 'pending' ? 'status-local' : ''}`}>
      <Icon name="text" size={12} strokeWidth={2} />
      {state === 'done' && confidence != null ? t('ocr.badgeDone', { confidence }) : t(`ocr.state.${state}`)}
    </span>
  );
}
