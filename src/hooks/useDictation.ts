// Voice dictation via the Web Speech API, where available. The text field always works without it.

import { useCallback, useEffect, useRef, useState } from 'react';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dictationSupported = () => !!ctor();

export function useDictation(lang: string) {
  const [listening, setListening] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  const stop = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setListening(null);
  }, []);

  const start = useCallback(
    (field: string, onText: (text: string) => void) => {
      const C = ctor();
      if (!C) return;
      stop();
      const r = new C();
      r.lang = lang;
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => {
        const text = Array.from(e.results)
          .map((res) => res[0]?.transcript ?? '')
          .join(' ')
          .trim();
        if (text) onText(text);
      };
      r.onend = () => setListening(null);
      r.onerror = () => setListening(null);
      rec.current = r;
      setListening(field);
      try {
        r.start();
      } catch {
        setListening(null);
      }
    },
    [lang, stop],
  );

  useEffect(() => stop, [stop]);
  return { supported: dictationSupported(), listening, start, stop };
}
