import { useEffect, useState } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

interface SnapState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  fromCache: boolean;
}

/**
 * One shared, ref-counted Firestore listener per key. Components that watch the same query share it, and
 * teardown is delayed briefly so remounts (StrictMode, route changes) re-use the listener instead of
 * rapidly unlistening and relistening, which can trip Firestore's internal watch-state assertions.
 */
interface Shared<T> {
  value: SnapState<T> | null;
  subscribers: Set<(s: SnapState<T>) => void>;
  stop: () => void;
  teardown?: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, Shared<unknown>>();
const TEARDOWN_DELAY_MS = 2000;

/** Retries a rejected listener a few times: on first sign-in the Space bootstrap may still be in flight. */
function withRetry(subscribe: (onError: (e: Error) => void) => () => void, setError: (e: Error) => void) {
  let attempt = 0;
  let unsub: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const start = () => {
    unsub = subscribe((e) => {
      if (stopped) return;
      const code = (e as { code?: string }).code;
      if (code === 'permission-denied' && attempt < 5) {
        attempt++;
        timer = setTimeout(start, 1200 * attempt);
      } else setError(e);
    });
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsub?.();
  };
}

function useShared<T>(
  key: string | null,
  empty: T,
  start: (emit: (s: SnapState<T>) => void) => () => void,
): SnapState<T> {
  const [state, setState] = useState<SnapState<T>>(() => {
    const existing = key ? (registry.get(key) as Shared<T> | undefined) : undefined;
    return existing?.value ?? { data: empty, loading: !!key, error: null, fromCache: true };
  });

  useEffect(() => {
    if (!key) {
      setState({ data: empty, loading: false, error: null, fromCache: true });
      return;
    }
    let shared = registry.get(key) as Shared<T> | undefined;
    if (!shared) {
      const created: Shared<T> = { value: null, subscribers: new Set(), stop: () => undefined };
      created.stop = start((s) => {
        created.value = s;
        created.subscribers.forEach((fn) => fn(s));
      });
      registry.set(key, created as Shared<unknown>);
      shared = created;
    }
    clearTimeout(shared.teardown);
    const sub = (s: SnapState<T>) => setState(s);
    shared.subscribers.add(sub);
    if (shared.value) setState(shared.value);
    else setState((s) => ({ ...s, loading: true }));
    const current = shared;
    return () => {
      current.subscribers.delete(sub);
      if (current.subscribers.size === 0) {
        current.teardown = setTimeout(() => {
          if (current.subscribers.size === 0 && registry.get(key) === current) {
            current.stop();
            registry.delete(key);
          }
        }, TEARDOWN_DELAY_MS);
      }
    };
    // The key identifies the query; `start` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

export function useDocSnapshot<T>(
  ref: DocumentReference | null,
  key: string | null,
  map: (snap: DocumentSnapshot) => T | null,
): SnapState<T | null | undefined> {
  return useShared<T | null | undefined>(key, undefined, (emit) => {
    let last: SnapState<T | null | undefined> = { data: undefined, loading: true, error: null, fromCache: true };
    return withRetry(
      (onError) =>
        onSnapshot(
          ref!,
          (snap) => emit((last = { data: map(snap), loading: false, error: null, fromCache: snap.metadata.fromCache })),
          onError,
        ),
      (error) => emit((last = { ...last, loading: false, error })),
    );
  });
}

export function useQuerySnapshot<T>(
  query: Query | null,
  key: string | null,
  map: (snap: QueryDocumentSnapshot) => T,
  includeMetadataChanges = false,
): SnapState<T[]> {
  return useShared<T[]>(key, [], (emit) => {
    let last: SnapState<T[]> = { data: [], loading: true, error: null, fromCache: true };
    return withRetry(
      (onError) =>
        onSnapshot(
          query!,
          { includeMetadataChanges },
          (snap) =>
            emit((last = { data: snap.docs.map(map), loading: false, error: null, fromCache: snap.metadata.fromCache })),
          onError,
        ),
      (error) => emit((last = { ...last, loading: false, error })),
    );
  });
}
