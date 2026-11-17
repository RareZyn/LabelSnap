// Promise-based confirm and prompt dialogs, rendered by <DialogHost/> (never window.confirm).

import { create } from 'zustand';

export interface DialogRequest {
  kind: 'confirm' | 'prompt';
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  inputLabel?: string;
  initialValue?: string;
  resolve: (value: string | boolean | null) => void;
}

interface DialogState {
  current: DialogRequest | null;
  set: (d: DialogRequest | null) => void;
}

export const useDialogStore = create<DialogState>((set) => ({ current: null, set: (current) => set({ current }) }));

export function confirmDialog(opts: Omit<DialogRequest, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogStore.getState().set({ ...opts, kind: 'confirm', resolve: (v) => resolve(v === true) }),
  );
}

export function promptDialog(opts: Omit<DialogRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogStore.getState().set({ ...opts, kind: 'prompt', resolve: (v) => resolve(typeof v === 'string' ? v : null) }),
  );
}
