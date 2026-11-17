import { create } from 'zustand';

export type DriveStatus = 'unconfigured' | 'disconnected' | 'connected' | 'expired';

interface DriveState {
  status: DriveStatus;
  email?: string;
  setStatus: (status: DriveStatus) => void;
  setEmail: (email: string | undefined) => void;
}

export const useDriveStore = create<DriveState>((set) => ({
  status: 'disconnected',
  email: (() => {
    try {
      return localStorage.getItem('ls.driveEmail') ?? undefined;
    } catch {
      return undefined;
    }
  })(),
  setStatus: (status) => set({ status }),
  setEmail: (email) => set({ email }),
}));
