// Runs detection and image processing in Web Workers so the shutter and the UI stay responsive.
// Falls back to the main thread where OffscreenCanvas or module workers are unavailable.

import type { Quad } from '../../data/types';
import { hasOffscreen } from './canvas';
import { detectQuad } from './detect';
import { detectInBlob, processImage, type ProcessParams, type ProcessResult } from './pipeline';

class WorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private broken = false;

  private get(): Worker | null {
    if (this.broken || !hasOffscreen) return null;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./imaging.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
          const p = this.pending.get(e.data.id);
          if (!p) return;
          this.pending.delete(e.data.id);
          if (e.data.error) p.reject(new Error(e.data.error));
          else p.resolve(e.data.result);
        };
        this.worker.onerror = () => {
          this.broken = true;
          for (const p of this.pending.values()) p.reject(new Error('worker-failed'));
          this.pending.clear();
          this.worker?.terminate();
          this.worker = null;
        };
      } catch {
        this.broken = true;
        return null;
      }
    }
    return this.worker;
  }

  call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> | null {
    const w = this.get();
    if (!w) return null;
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }
}

const detector = new WorkerClient();
const processor = new WorkerClient();

export function detectorBusy(): boolean {
  return detector.busy;
}

export async function detectFrame(gray: Uint8ClampedArray, width: number, height: number): Promise<Quad | null> {
  const p = detector.call<Quad | null>({ type: 'detect', gray, width, height }, [gray.buffer]);
  if (p) {
    try {
      return await p;
    } catch {
      /* fall through */
    }
  }
  return detectQuad(gray, width, height);
}

export async function detectStill(blob: Blob): Promise<Quad | null> {
  const p = processor.call<Quad | null>({ type: 'detectBlob', blob });
  if (p) {
    try {
      return await p;
    } catch {
      /* fall through */
    }
  }
  return detectInBlob(blob);
}

export async function processInWorker(params: ProcessParams): Promise<ProcessResult> {
  const p = processor.call<ProcessResult>({ type: 'process', params });
  if (p) {
    try {
      return await p;
    } catch {
      /* fall through to the main thread */
    }
  }
  return processImage(params);
}
