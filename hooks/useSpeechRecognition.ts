import { useEffect, useRef, useState, useCallback } from "react";

export type SpeechStatus = "idle" | "listening" | "paused" | "unsupported";

export interface SpeechRecognitionOptions {
  lang?: string;
  onInterimResult?: (transcript: string) => void;
  onFinalResult?: (transcript: string) => void;
  onError?: (error: string) => void;
}

// Inline Web Speech API types (not in default TS lib)
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: ISpeechRecognitionResultList;
}
interface ISpeechRecognitionResultList {
  length: number;
  [index: number]: ISpeechRecognitionResult;
}
interface ISpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: ISpeechRecognitionAlternative;
}
interface ISpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface ISpeechRecognitionErrorEvent {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

export function useSpeechRecognition(options: SpeechRecognitionOptions = {}) {
  const { lang = "en-US", onInterimResult, onFinalResult, onError } = options;

  const [status, setStatus] = useState<SpeechStatus>("idle");

  // Ref mirrors state so onend callbacks always read current value.
  const statusRef = useRef<SpeechStatus>("idle");
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── THE FIX: Store callbacks in refs ──────────────────────────────────
  // The rec.onresult handler is set once when createAndStart() runs.
  // If the parent re-renders and passes new callback references (e.g.
  // because tracker.processSpeech was recreated after tokens changed),
  // the old rec.onresult closure still points to the stale callbacks.
  //
  // By reading through refs, rec.onresult always invokes the LATEST
  // versions of onInterimResult / onFinalResult / onError — no matter
  // when the recognition fires.
  const onInterimRef = useRef(onInterimResult);
  const onFinalRef = useRef(onFinalResult);
  const onErrorRef = useRef(onError);

  // Keep refs in sync every render (cheap — just pointer assignments)
  useEffect(() => {
    onInterimRef.current = onInterimResult;
    onFinalRef.current = onFinalResult;
    onErrorRef.current = onError;
  });

  const updateStatus = useCallback((s: SpeechStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const createAndStart = useCallback(() => {
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const rec = new API();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.maxAlternatives = 1;

    rec.onresult = (event: ISpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript);
      }
      // Call through refs → always the latest callback
      if (interim) onInterimRef.current?.(interim);
      if (final) onFinalRef.current?.(final);
    };

    rec.onerror = (event: ISpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed") {
        onErrorRef.current?.(
          "Microphone permission denied. Please allow mic access in your browser settings."
        );
        updateStatus("idle");
        return;
      }
      console.warn("Speech recognition error:", event.error);
    };

    rec.onend = () => {
      if (statusRef.current === "listening") {
        restartTimerRef.current = setTimeout(() => {
          if (statusRef.current === "listening") createAndStart();
        }, 150);
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch (e) { console.warn("Recognition start error:", e); }
  }, [lang, updateStatus]); // ← callbacks removed from deps — accessed via refs

  const start = useCallback(() => {
    if (!isSupported) {
      updateStatus("unsupported");
      return;
    }
    updateStatus("listening");
    createAndStart();
  }, [isSupported, createAndStart, updateStatus]);

  const stop = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    updateStatus("idle");
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
  }, [updateStatus]);

  const pause = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    updateStatus("paused");
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
  }, [updateStatus]);

  const resume = useCallback(() => {
    updateStatus("listening");
    createAndStart();
  }, [createAndStart, updateStatus]);

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  return { status, isSupported: isSupported ?? false, start, stop, pause, resume };
}
