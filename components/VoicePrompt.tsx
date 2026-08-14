"use client";

import { useEffect, useRef, useState } from "react";

type RecognitionResult = { 0: { transcript: string }; isFinal: boolean };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error?: string };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => RecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  }
}

export function VoicePrompt({ onTranscript, disabled = false }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "pl-PL";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) text += `${event.results[i][0].transcript} `;
      if (text.trim()) onTranscript(text.trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, [onTranscript]);

  if (!supported) return <span className="voiceUnsupported">Głos niedostępny w tej przeglądarce</span>;

  return (
    <button
      type="button"
      className={listening ? "voiceButton listening" : "voiceButton"}
      disabled={disabled}
      aria-pressed={listening}
      onClick={() => {
        const recognition = recognitionRef.current;
        if (!recognition) return;
        if (listening) {
          recognition.stop();
          setListening(false);
          return;
        }
        setListening(true);
        try { recognition.start(); } catch { setListening(false); }
      }}
    >
      <span aria-hidden="true">🎙️</span>
      {listening ? "Mów…" : "Powiedz czego szukasz"}
    </button>
  );
}
