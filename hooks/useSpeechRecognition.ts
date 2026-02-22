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
  stop(): void;
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

  const statusRef = useRef<SpeechStatus>("idle");
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStartingRef = useRef(false);

  // Latest callback refs (avoid stale closures)
  const onInterimRef = useRef(onInterimResult);
  const onFinalRef = useRef(onFinalResult);
  const onErrorRef = useRef(onError);

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

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const ensureMicPermission = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release immediately — just warming permission/device
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      onErrorRef.current?.(
        "Microphone access failed. On Android Chrome, use HTTPS (or localhost) and allow mic permission."
      );
      throw new Error("mic-permission-failed");
    }
  }, []);

  const createAndStart = useCallback(() => {
    if (typeof window === "undefined") return;

    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) return;

    // Prevent start/stop thrash on mobile
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    const rec = new API();

    const isAndroid =
      typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

    rec.continuous = true;
    // Android Chrome is often more stable without interim results
    rec.interimResults = !isAndroid;
    rec.lang = lang;
    rec.maxAlternatives = 1;

    rec.onresult = (event: ISpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }

      if (interim) onInterimRef.current?.(interim);
      if (final) onFinalRef.current?.(final);
    };

    rec.onerror = (event: ISpeechRecognitionErrorEvent) => {
      // Common mobile noise; ignore unless persistent
      if (event.error === "no-speech" || event.error === "aborted") return;

      if (event.error === "not-allowed") {
        onErrorRef.current?.(
          "Microphone permission denied. Please allow mic access in Chrome settings."
        );
        updateStatus("idle");
        return;
      }

      if (event.error === "service-not-allowed") {
        onErrorRef.current?.(
          "Speech recognition service not allowed on this device/browser."
        );
        updateStatus("idle");
        return;
      }

      if (event.error === "network") {
        onErrorRef.current?.(
          "Speech recognition network error. Android Chrome may require a stable connection."
        );
      } else {
        onErrorRef.current?.(`Speech recognition error: ${event.error}`);
      }

      console.warn("Speech recognition error:", event.error);
    };

    rec.onend = () => {
      isStartingRef.current = false;

      // Only auto-restart if user still expects listening mode
      if (statusRef.current === "listening") {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          if (statusRef.current === "listening") {
            createAndStart();
          }
        }, 700); // mobile-friendly restart delay (was too aggressive at 150ms)
      }
    };

    recognitionRef.current = rec;

    try {
      rec.start();
    } catch (e) {
      isStartingRef.current = false;
      console.warn("Recognition start error:", e);
      onErrorRef.current?.(
        "Could not start speech recognition. Try reloading the page and allowing microphone access."
      );
    }
  }, [lang, updateStatus, clearRestartTimer]);

  const start = useCallback(async () => {
    if (!isSupported) {
      updateStatus("unsupported");
      onErrorRef.current?.(
        "SpeechRecognition is not supported in this browser. Try Chrome or Edge."
      );
      return;
    }

    // Android Chrome often needs secure context (HTTPS / localhost)
    if (typeof window !== "undefined" && !window.isSecureContext) {
      onErrorRef.current?.(
        "This page is not in a secure context. On Android Chrome, speech/mic usually requires HTTPS (or localhost)."
      );
      // Continue anyway; some setups may still work
    }

    try {
      await ensureMicPermission();
    } catch {
      updateStatus("idle");
      return;
    }

    clearRestartTimer();
    updateStatus("listening");
    createAndStart();
  }, [isSupported, updateStatus, createAndStart, ensureMicPermission, clearRestartTimer]);

  const stop = useCallback(() => {
    clearRestartTimer();
    updateStatus("idle");

    if (recognitionRef.current) {
      try {
        // stop() is nicer on mobile than abort() (lets engine finalize cleanly)
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    isStartingRef.current = false;
  }, [updateStatus, clearRestartTimer]);

  const pause = useCallback(() => {
    clearRestartTimer();
    updateStatus("paused");

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    isStartingRef.current = false;
  }, [updateStatus, clearRestartTimer]);

  const resume = useCallback(async () => {
    if (!isSupported) {
      updateStatus("unsupported");
      return;
    }

    if (typeof window !== "undefined" && !window.isSecureContext) {
      onErrorRef.current?.(
        "This page is not in a secure context. On Android Chrome, speech/mic usually requires HTTPS (or localhost)."
      );
    }

    try {
      await ensureMicPermission();
    } catch {
      updateStatus("paused");
      return;
    }

    clearRestartTimer();
    updateStatus("listening");
    createAndStart();
  }, [isSupported, updateStatus, createAndStart, ensureMicPermission, clearRestartTimer]);

  useEffect(() => {
    return () => {
      clearRestartTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      isStartingRef.current = false;
    };
  }, [clearRestartTimer]);

  return {
    status,
    isSupported: Boolean(isSupported),
    start,
    stop,
    pause,
    resume,
  };
}
