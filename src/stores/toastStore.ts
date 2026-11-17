import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  durationMs: number;
}

interface ToastState {
  toasts: Toast[];
  show: (t: Omit<Toast, 'id' | 'kind' | 'durationMs'> & Partial<Pick<Toast, 'kind' | 'durationMs'>>) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (t) => {
    const id = nextId++;
    const toast: Toast = { kind: 'info', durationMs: t.actionLabel ? 7000 : 4000, ...t, id };
    set({ toasts: [...get().toasts.slice(-2), toast] });
    setTimeout(() => get().dismiss(id), toast.durationMs);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) =>
  useToastStore.getState().show({ message, ...opts });

export const toastError = (message: string) => useToastStore.getState().show({ message, kind: 'error', durationMs: 6000 });
