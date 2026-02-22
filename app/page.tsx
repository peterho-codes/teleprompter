"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useScriptTracker } from "../hooks/useScriptTracker";
import { Waveform } from "../components/Waveform";

const SAMPLE_SCRIPT = `Welcome to Textream Web. This is a browser-based teleprompter that highlights your script in real time as you speak.

Paste your own script in the editor below, then hit the play button when you are ready to begin. Words will light up as you say them, so you can always keep your place without looking away from the camera.

You can tap any word to jump the tracker to that position. Use the pause button to take a break and resume whenever you are ready. Good luck with your presentation, stream, or recording session.`;

const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ms-MY", label: "Bahasa Malaysia" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "ar-SA", label: "Arabic" },
];

export default function TeleprompterPage() {
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [lang, setLang] = useState("en-US");
  const [mode, setMode] = useState<"edit" | "present">("edit");
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(2.2);
  const [overlayWidth, setOverlayWidth] = useState(85);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [debugTranscript, setDebugTranscript] = useState("");

  const tracker = useScriptTracker();
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // ── FIX: depend on processSpeech, not the whole tracker object ──
  // tracker is a new object reference every render (cursorIndex changes, etc.)
  // but tracker.processSpeech is a stable useCallback that only changes when
  // tokens change. This prevents unnecessary callback churn.
  const { processSpeech } = tracker;

  const handleInterim = useCallback(
    (t: string) => processSpeech(t, false),
    [processSpeech]
  );

  const handleFinal = useCallback(
    (t: string) => processSpeech(t, true),
    [processSpeech]
  );

  const speech = useSpeechRecognition({
    lang,
    onInterimResult: (t) => {
      setDebugTranscript(`interim: ${t}`);
      handleInterim(t);
    },
    onFinalResult: (t) => {
      setDebugTranscript(`final: ${t}`);
      handleFinal(t);
    },
    onError: (e) => {
      setSpeechError(e);
    },
  });

  // Re-tokenize if script text changes while in present mode (edge case)
  useEffect(() => {
    if (mode === "present") {
      tracker.setScript(scriptText);
    }
  }, [scriptText]); // intentionally omit `mode` — handlePlay already calls setScript

  // Auto-scroll to keep current word in view
  useEffect(() => {
    if (mode !== "present") return;
    const el = wordRefs.current[tracker.cursorIndex];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [tracker.cursorIndex, mode]);

  // Auto-stop when script complete
  useEffect(() => {
    if (tracker.isComplete && speech.status === "listening") {
      speech.stop();
    }
  }, [tracker.isComplete]);

  function handlePlay() {
    setSpeechError(null);
    setDebugTranscript("");
    // FIX: set tokens synchronously BEFORE starting speech recognition.
    // Previously setScript was called inside a useEffect triggered by the mode change,
    // which runs after the browser paint. On mobile (mic already permitted), recognition
    // can fire in that gap — processSpeech would run with empty tokens and advance nothing.
    tracker.setScript(scriptText);
    setMode("present");
    speech.start();
  }

  function handleStop() {
    speech.stop();
    setMode("edit");
    tracker.reset();
  }

  function handlePauseResume() {
    if (speech.status === "listening") {
      speech.pause();
    } else if (speech.status === "paused") {
      speech.resume();
    }
  }

  const isLive = speech.status === "listening";
  const isPaused = speech.status === "paused";

  return (
    <div className="app-root">
      {/* ── Dynamic Island Pill ── */}
      <div className="island-wrapper">
        <div className={`island ${mode === "present" ? "island--active" : ""}`}>
          <div className="island-left">
            <span
              className={`mic-dot ${isLive ? "mic-dot--live" : isPaused ? "mic-dot--paused" : ""}`}
            />
            {(isLive || isPaused) && <Waveform active={isLive} color="#c084fc" />}
            {mode === "edit" && <span className="island-brand">TEXTREAM</span>}
          </div>

          <div className="island-right">
            {mode === "edit" && (
              <>
                <button
                  className="btn btn--ghost"
                  onClick={() => setShowSettings(!showSettings)}
                  title="Settings"
                >
                  ⚙
                </button>
                {speech.isSupported ? (
                  <button className="btn btn--play" onClick={handlePlay}>
                    ▶ Present
                  </button>
                ) : (
                  <span className="unsupported-msg">Chrome/Edge required</span>
                )}
              </>
            )}

            {mode === "present" && (
              <>
                <button className="btn btn--ghost" onClick={handlePauseResume}>
                  {isPaused ? "▶" : "⏸"}
                </button>
                <button className="btn btn--stop" onClick={handleStop}>
                  ■ Stop
                </button>
              </>
            )}
          </div>
        </div>

        {showSettings && mode === "edit" && (
          <div className="settings-panel">
            <label className="setting-row">
              <span>Language</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span>Font size: {fontSize.toFixed(1)}rem</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
            </label>
            <label className="setting-row">
              <span>Width: {overlayWidth}%</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={overlayWidth}
                onChange={(e) => setOverlayWidth(Number(e.target.value))}
              />
            </label>
          </div>
        )}
      </div>


      {(speechError || mode === "present") && (
        <div style={{ width: `${overlayWidth}%`, maxWidth: 900 }}>
          {speechError && (
            <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8 }}>
              Mic/Speech error: {speechError}
            </div>
          )}
          <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 6 }}>
            status: {speech.status} | supported: {String(speech.isSupported)} | secure:{" "}
            {String(typeof window !== "undefined" ? window.isSecureContext : false)}
            {debugTranscript ? ` | ${debugTranscript}` : ""}
          </div>
        </div>
      )}

      {/* ── Main Area ── */}
      <main className="main" style={{ width: `${overlayWidth}%` }}>
        {mode === "edit" ? (
          <div className="editor-area">
            <p className="editor-label">Paste your script</p>
            <textarea
              className="script-editor"
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Paste your script here…"
              spellCheck={false}
            />
            <p className="editor-hint">
              {scriptText.trim().split(/\s+/).filter(Boolean).length} words
            </p>
          </div>
        ) : (
          <div className="teleprompter-view">
            {tracker.isComplete ? (
              <div className="complete-msg">
                <span className="complete-check">✓</span>
                <p>Script complete</p>
                <button className="btn btn--ghost" onClick={handleStop}>
                  Back to editor
                </button>
              </div>
            ) : (
              <p className="script-display" style={{ fontSize: `${fontSize}rem` }}>
                {tracker.tokens.map((token, i) => {
                  const isActive = i === tracker.cursorIndex;
                  const isDone = i < tracker.cursorIndex;
                  const isComing = i > tracker.cursorIndex;
                  return (
                    <span
                      key={i}
                      ref={(el) => {
                        wordRefs.current[i] = el;
                      }}
                      className={`word ${isActive ? "word--active" : ""} ${isDone ? "word--done" : ""} ${isComing ? "word--coming" : ""}`}
                      onClick={() => tracker.jumpTo(i)}
                    >
                      {token.word}{" "}
                    </span>
                  );
                })}
              </p>
            )}
          </div>
        )}
      </main>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .app-root {
          min-height: 100vh; min-height: 100dvh;
          background: #080810; color: #e2e8f0;
          font-family: 'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif;
          display: flex; flex-direction: column; align-items: center;
          padding-top: 12px; gap: 32px;
        }
        .island-wrapper {
          position: sticky; top: 12px; z-index: 100;
          display: flex; flex-direction: column; align-items: center; gap: 8px;
        }
        .island {
          background: #0d0d14;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 40px; padding: 10px 18px;
          display: flex; align-items: center; gap: 16px;
          justify-content: space-between;
          min-width: 320px; max-width: 640px; width: auto;
          box-shadow: 0 0 0 1px rgba(124, 58, 237, 0), 0 8px 32px rgba(0,0,0,0.6);
          transition: box-shadow 0.4s ease, border-color 0.4s ease;
        }
        .island--active {
          border-color: rgba(168, 85, 247, 0.3);
          box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.15), 0 0 40px rgba(168, 85, 247, 0.08), 0 8px 32px rgba(0,0,0,0.6);
        }
        .island-left { display: flex; align-items: center; gap: 10px; }
        .island-right { display: flex; align-items: center; gap: 8px; }
        .island-brand { font-size: 11px; font-weight: 700; letter-spacing: 0.15em; color: #6366f1; opacity: 0.7; }
        .mic-dot { width: 8px; height: 8px; border-radius: 50%; background: #374151; flex-shrink: 0; transition: background 0.3s; }
        .mic-dot--live { background: #a855f7; box-shadow: 0 0 8px rgba(168,85,247,0.7); animation: pulse 1.5s infinite; }
        .mic-dot--paused { background: #f59e0b; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .btn { border: none; border-radius: 20px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; }
        .btn--play { background: linear-gradient(135deg, #7c3aed, #a855f7); color: #fff; box-shadow: 0 2px 12px rgba(124,58,237,0.4); }
        .btn--play:hover { box-shadow: 0 4px 20px rgba(124,58,237,0.6); transform: translateY(-1px); }
        .btn--stop { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
        .btn--stop:hover { background: rgba(239,68,68,0.25); }
        .btn--ghost { background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.08); font-size: 14px; padding: 6px 10px; }
        .btn--ghost:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }
        .unsupported-msg { font-size: 12px; color: #f59e0b; font-style: italic; }
        .settings-panel { background: #0d0d14; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; min-width: 320px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
        .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 13px; color: #94a3b8; cursor: pointer; }
        .setting-row select, .setting-row input[type="range"] { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #e2e8f0; padding: 4px 8px; font-size: 12px; outline: none; }
        .setting-row input[type="range"] { width: 120px; cursor: pointer; padding: 0; accent-color: #a855f7; }
        .main { max-width: 900px; padding: 0 24px 60px; flex: 1; }
        .editor-area { display: flex; flex-direction: column; gap: 8px; }
        .editor-label { font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #475569; }
        .script-editor { width: 100%; min-height: 60vh; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 24px; color: #cbd5e1; font-size: 1.1rem; line-height: 1.8; resize: vertical; outline: none; font-family: inherit; transition: border-color 0.2s; }
        .script-editor:focus { border-color: rgba(168, 85, 247, 0.3); }
        .editor-hint { font-size: 12px; color: #334155; text-align: right; }
        .teleprompter-view { min-height: 60vh; display: flex; align-items: flex-start; padding-top: 24px; }
        .script-display { line-height: 1.9; color: #1e293b; user-select: none; }
        .word { display: inline; cursor: pointer; padding: 1px 2px; border-radius: 4px; transition: color 0.15s, background 0.15s; color: #475569; }
        .word--coming { color: #475569; }
        .word--done { color: #94a3b8; }
        .word--active { color: #f3e8ff; background: rgba(168, 85, 247, 0.25); border-radius: 5px; font-weight: 600; box-shadow: 0 0 16px rgba(168,85,247,0.3); padding: 1px 4px; }
        .word:hover { background: rgba(255,255,255,0.05); color: #94a3b8; }
        .complete-msg { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 16px; color: #64748b; }
        .complete-check { font-size: 3rem; color: #a855f7; line-height: 1; }
        .complete-msg p { font-size: 1.1rem; letter-spacing: 0.05em; }
      `}</style>
    </div>
  );
}
