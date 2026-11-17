/// <reference lib="webworker" />
import { detectQuad } from './detect';
import { detectInBlob, processImage, type ProcessParams } from './pipeline';

type Msg =
  | { id: number; type: 'detect'; gray: Uint8ClampedArray; width: number; height: number }
  | { id: number; type: 'detectBlob'; blob: Blob }
  | { id: number; type: 'process'; params: ProcessParams };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'detect') {
      self.postMessage({ id: msg.id, result: detectQuad(msg.gray, msg.width, msg.height) });
    } else if (msg.type === 'detectBlob') {
      self.postMessage({ id: msg.id, result: await detectInBlob(msg.blob) });
    } else {
      self.postMessage({ id: msg.id, result: await processImage(msg.params) });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
