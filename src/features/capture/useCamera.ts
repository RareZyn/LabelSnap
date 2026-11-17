// Camera access. Torch, zoom and focus are capability-detected and hidden where the browser does not
// expose them (iOS Safari). Frames are grabbed from the <video> element: the universal capture path.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureQuality } from '../../data/types';
import { encodeJpeg, makeCanvas, ctx2d } from '../../lib/imaging/canvas';

export type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable' | 'error';

export interface CameraCaps {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
  focus: boolean;
}

const RESOLUTION: Record<CaptureQuality, { width: number; height: number }> = {
  low: { width: 1280, height: 720 },
  medium: { width: 1920, height: 1080 },
  high: { width: 3840, height: 2160 },
};

type ExtendedCaps = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
  focusMode?: string[];
};

export function hasCameraApi(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

export async function cameraPermission(): Promise<PermissionState | 'unknown'> {
  try {
    const s = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return s.state;
  } catch {
    return 'unknown';
  }
}

export function useCamera(quality: CaptureQuality) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [caps, setCaps] = useState<CameraCaps>({ torch: false, zoom: null, focus: false });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [torch, setTorchState] = useState(false);
  const [zoom, setZoomState] = useState(1);
  const [label, setLabel] = useState('');

  const track = () => streamRef.current?.getVideoTracks()[0] ?? null;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchState(false);
    setState((s) => (s === 'live' || s === 'starting' ? 'idle' : s));
  }, []);

  const start = useCallback(
    async (wantedDeviceId?: string) => {
      if (!hasCameraApi()) {
        setState('unavailable');
        return false;
      }
      stop();
      setState('starting');
      const res = RESOLUTION[quality];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(wantedDeviceId ? { deviceId: { exact: wantedDeviceId } } : { facingMode: { ideal: 'environment' } }),
            width: { ideal: res.width },
            height: { ideal: res.height },
          },
        });
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = true;
          v.setAttribute('playsinline', 'true');
          await v.play().catch(() => undefined);
        }
        const t = stream.getVideoTracks()[0];
        const c = (t.getCapabilities?.() ?? {}) as ExtendedCaps;
        setCaps({
          torch: !!c.torch,
          zoom: c.zoom && c.zoom.max > c.zoom.min ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1 } : null,
          focus: !!c.focusMode?.some((m) => m === 'single-shot' || m === 'manual' || m === 'continuous'),
        });
        const settings = t.getSettings() as MediaTrackSettings & { zoom?: number };
        setZoomState(settings.zoom ?? 1);
        setDeviceId(settings.deviceId);
        setLabel(t.label);
        const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setDevices(all.filter((d) => d.kind === 'videoinput'));
        setState('live');
        return true;
      } catch (e) {
        const name = (e as DOMException).name;
        setState(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'unavailable'
              : 'error',
        );
        return false;
      }
    },
    [quality, stop],
  );

  const switchCamera = useCallback(async () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    await start(next.deviceId);
  }, [devices, deviceId, start]);

  const setTorch = useCallback(async (on: boolean) => {
    const t = track();
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorchState(on);
    } catch {
      setCaps((c) => ({ ...c, torch: false }));
    }
  }, []);

  const setZoom = useCallback(
    async (z: number) => {
      const t = track();
      if (!t || !caps.zoom) return;
      const v = Math.min(caps.zoom.max, Math.max(caps.zoom.min, z));
      setZoomState(v);
      try {
        await t.applyConstraints({ advanced: [{ zoom: v } as MediaTrackConstraintSet] });
      } catch {
        /* ignore transient constraint errors while pinching */
      }
    },
    [caps.zoom],
  );

  const focusAt = useCallback(
    async (x: number, y: number) => {
      const t = track();
      if (!t || !caps.focus) return;
      try {
        await t.applyConstraints({
          advanced: [{ focusMode: 'single-shot', pointsOfInterest: [{ x, y }] } as MediaTrackConstraintSet],
        });
      } catch {
        try {
          await t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
        } catch {
          /* focus not adjustable */
        }
      }
    },
    [caps.focus],
  );

  /** Grabs the current frame as a JPEG. */
  const grab = useCallback(async (jpegQuality: number): Promise<{ blob: Blob; width: number; height: number } | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = makeCanvas(v.videoWidth, v.videoHeight);
    ctx2d(c).drawImage(v, 0, 0);
    const blob = await encodeJpeg(c, jpegQuality);
    return { blob, width: v.videoWidth, height: v.videoHeight };
  }, []);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    state,
    caps,
    devices,
    torch,
    zoom,
    label,
    start,
    stop,
    switchCamera,
    setTorch,
    setZoom,
    focusAt,
    grab,
    isLive: () => !!streamRef.current?.active,
  };
}
