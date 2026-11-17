import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../lib/db/dexie';
import type { SyncState } from '../data/types';
import type { EntryView } from '../data/entries';
import { useDriveStore } from '../stores/driveStore';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export interface QueueSummary {
  pending: number;
  failed: number;
  /** Entries with queued uploads: 'failed' wins over 'pending'. */
  byEntry: Map<string, 'pending' | 'failed'>;
  failedErrors: string[];
}

const EMPTY: QueueSummary = { pending: 0, failed: 0, byEntry: new Map(), failedErrors: [] };

export function useQueueSummary(): QueueSummary {
  return (
    useLiveQuery(async () => {
      const ops = await localDb.pending_ops.toArray();
      const byEntry = new Map<string, 'pending' | 'failed'>();
      let pending = 0;
      let failed = 0;
      const failedErrors: string[] = [];
      for (const op of ops) {
        const isImage = op.type === 'upload' || op.type === 'copy';
        if (op.status === 'failed') {
          failed++;
          if (op.lastError) failedErrors.push(op.lastError);
        } else if (isImage) pending++;
        if (op.entryId && isImage) {
          if (op.status === 'failed') byEntry.set(op.entryId, 'failed');
          else if (!byEntry.has(op.entryId)) byEntry.set(op.entryId, 'pending');
        }
      }
      return { pending, failed, byEntry, failedErrors };
    }, []) ?? EMPTY
  );
}

/** What to show for an Entry: combines the local queue with the stored state. */
export function useEntrySyncState(): (entry: EntryView) => SyncState {
  const summary = useQueueSummary();
  const online = useOnline();
  const drive = useDriveStore((s) => s.status);
  return (entry: EntryView) => {
    const q = summary.byEntry.get(entry.id);
    if (q === 'failed') return 'failed';
    if (q === 'pending') return online && drive === 'connected' ? 'uploading' : 'local';
    // Nothing queued on this device: the Drive ids tell whether another device has uploaded it yet.
    return entry.imagePath && entry.thumbPath ? 'synced' : 'local';
  };
}
