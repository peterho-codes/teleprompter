import { useState, useEffect, useRef, useCallback } from "react";

// ── Utilities ──────────────────────────────────────────────────────────────

function normalize(word) {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function tokenize(text) {
  return text.split(/\s+/).filter(Boolean).map((word, index) => ({
    word, normalized: normalize(word), index
  }));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i-1] === a[j-1]
        ? m[i-1][j-1]
        : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
    }
  }
  return m[b.length][a.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

function advanceCursor(spokenWords, tokens, cursorStart) {
  const windowStart = Math.max(0, cursorStart - 2);
  const windowEnd = Math.min(tokens.length, cursorStart + 12);
  const window = tokens.slice(windowStart, windowEnd);
  const anchor = spokenWords.slice(-3).map(normalize).filter(Boolean);
  if (!anchor.length) return cursorStart;

  let bestScore = -1, bestPos = cursorStart;
  for (let wi = 0; wi <= window.length - anchor.length; wi++) {
    let score = 0;
    for (let ai = 0; ai < anchor.length; ai++) {
      const sw = window[wi + ai]?.normalized ?? "";
      const sp = anchor[ai];
      if (sw.length < 2 && sp !== sw) continue;
      score += similarity(sp, sw);
    }
    score /= anchor.length;
    if (score > bestScore && score > 0.55) {
      bestScore = score;
      bestPos = windowStart + wi + anchor.length - 1;
    }
  }
  return bestPos;
}

// ── Waveform ───────────────────────────────────────────────────────────────

function Waveform({ active }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ cancelled: false, anim: 0, stream: null, ctx: null });

  useEffect(() => {
    const s = stateRef.current;
    s.cancelled = false;

    if (!active) {
      cancelAnimationFrame(s.anim);
      s.stream?.getTracks().forEach(t => t.stop());
      s.ctx?.close();
      s.stream = null; s.ctx = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (s.cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        s.stream = stream;
        const audioCtx = new AudioContext();
        s.ctx = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const draw = () => {
          if (s.cancelled) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          const W = canvas.width, H = canvas.height;
          analyser.getByteTimeDomainData(data);
          ctx.clearRect(0, 0, W, H);
          ctx.beginPath();
          ctx.strokeStyle = "#c084fc";
          ctx.lineWidth = 1.5;
          ctx.lineJoin = "round";
          const sliceW = W / data.length;
          data.forEach((v, i) => {
            const y = (v / 128) * H / 2;
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sliceW, y);
          });
          ctx.stroke();
          s.anim = requestAnimationFrame(draw);
        };
        draw();
      } catch {}
    })();

    return () => {
      s.cancelled = true;
      cancelAnimationFrame(s.anim);
      s.stream?.getTracks().forEach(t => t.stop());
      s.ctx?.close();
    };
  }, [active]);

  return <canvas ref={canvasRef} width={100} height={28} style={{ display: "block", opacity: 0.85 }} />;
}

// ── Main App ───────────────────────────────────────────────────────────────

const SAMPLE = `Welcome to Textream Web. This is a browser-based teleprompter that highlights your script in real time as you speak. Paste your own script in the editor below, then hit the play button when you are ready to begin. Words will light up as you say them, so you can always keep your place without looking away from the camera. You can tap any word to jump the tracker to that position. Use the pause button to take a break and resume whenever you are ready. Good luck with your presentation, stream, or recording session.`;

const LANGS = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ms-MY", label: "Bahasa Malaysia" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
];

export default function App() {
  const [scriptText, setScriptText] = useState(SAMPLE);
  const [lang, setLang] = useState("en-US");
  const [mode, setMode] = useState("edit"); // edit | present
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(2.0);
  const [tokens, setTokens] = useState([]);
  const [cursor, setCursor] = useState(-1);
  const [isComplete, setIsComplete] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("idle"); // idle | listening | paused
  const [isSupported] = useState(() =>
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );

  const recRef = useRef(null);
  const spokenBuf = useRef([]);
  const wordRefs = useRef([]);
  const tokensRef = useRef([]);
  const cursorRef = useRef(-1);

  tokensRef.current = tokens;
  cursorRef.current = cursor;

  // Auto-scroll active word
  useEffect(() => {
    if (mode !== "present") return;
    wordRefs.current[cursor]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [cursor, mode]);

  // Auto-stop on complete
  useEffect(() => {
    if (isComplete && speechStatus === "listening") stopRec();
  }, [isComplete]);

  function buildRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        (r.isFinal ? final : interim === "") && (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
      }
      // combine both
      const text = (interim || final).trim();
      if (!text) return;
      const words = text.split(/\s+/).filter(Boolean);
      spokenBuf.current = [...spokenBuf.current, ...words].slice(-20);
      setCursor(prev => {
        const next = advanceCursor(spokenBuf.current, tokensRef.current, Math.max(0, prev));
        if (next >= tokensRef.current.length - 1) setIsComplete(true);
        return next > prev ? next : prev;
      });
    };

    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setSpeechStatus("idle");
    };

    rec.onend = () => {
      if (recRef.current && speechStatus === "listening") {
        try { rec.start(); } catch {}
      }
    };

    return rec;
  }

  function startRec() {
    const toks = tokenize(scriptText);
    setTokens(toks);
    setCursor(-1);
    setIsComplete(false);
    spokenBuf.current = [];
    setMode("present");

    const rec = buildRec();
    if (!rec) return;
    recRef.current = rec;
    try { rec.start(); setSpeechStatus("listening"); } catch {}
  }

  function stopRec() {
    try { recRef.current?.abort(); } catch {}
    recRef.current = null;
    setSpeechStatus("idle");
    setMode("edit");
    setCursor(-1);
    setIsComplete(false);
  }

  function pauseRec() {
    try { recRef.current?.abort(); } catch {}
    setSpeechStatus("paused");
  }

  function resumeRec() {
    const rec = buildRec();
    if (!rec) return;
    recRef.current = rec;
    try { rec.start(); setSpeechStatus("listening"); } catch {}
  }

  const isLive = speechStatus === "listening";
  const isPaused = speechStatus === "paused";

  return (
    <div style={styles.root}>
      {/* Island */}
      <div style={styles.islandWrap}>
        <div style={{ ...styles.island, ...(mode === "present" ? styles.islandActive : {}) }}>
          <div style={styles.islandLeft}>
            <span style={{
              ...styles.dot,
              ...(isLive ? styles.dotLive : isPaused ? styles.dotPaused : {})
            }} />
            {(isLive || isPaused) && <Waveform active={isLive} />}
            {mode === "edit" && <span style={styles.brand}>TEXTREAM WEB</span>}
          </div>
          <div style={styles.islandRight}>
            {mode === "edit" && (
              <>
                <button style={styles.btnGhost} onClick={() => setShowSettings(s => !s)}>⚙</button>
                {isSupported
                  ? <button style={styles.btnPlay} onClick={startRec}>▶ Present</button>
                  : <span style={styles.unsupported}>Chrome/Edge required</span>
                }
              </>
            )}
            {mode === "present" && (
              <>
                <button style={styles.btnGhost} onClick={isPaused ? resumeRec : pauseRec}>
                  {isPaused ? "▶" : "⏸"}
                </button>
                <button style={styles.btnStop} onClick={stopRec}>■ Stop</button>
              </>
            )}
          </div>
        </div>

        {showSettings && mode === "edit" && (
          <div style={styles.settings}>
            <label style={styles.settingRow}>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>Language</span>
              <select style={styles.select} value={lang} onChange={e => setLang(e.target.value)}>
                {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <label style={styles.settingRow}>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>Size: {fontSize.toFixed(1)}rem</span>
              <input type="range" min={1} max={4} step={0.1} value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                style={{ width: 120, accentColor: "#a855f7" }} />
            </label>
          </div>
        )}
      </div>

      {/* Main */}
      <main style={styles.main}>
        {mode === "edit" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={styles.label}>Your script</span>
            <textarea
              style={styles.textarea}
              value={scriptText}
              onChange={e => setScriptText(e.target.value)}
              placeholder="Paste your script here…"
              spellCheck={false}
            />
            <span style={styles.hint}>
              {scriptText.trim().split(/\s+/).filter(Boolean).length} words
            </span>
          </div>
        ) : (
          <div style={styles.presentView}>
            {isComplete ? (
              <div style={styles.completeBox}>
                <span style={styles.check}>✓</span>
                <p style={{ color: "#64748b", letterSpacing: "0.05em" }}>Script complete</p>
                <button style={styles.btnGhost} onClick={stopRec}>Back to editor</button>
              </div>
            ) : (
              <p style={{ ...styles.scriptDisplay, fontSize: `${fontSize}rem` }}>
                {tokens.map((tok, i) => (
                  <span
                    key={i}
                    ref={el => wordRefs.current[i] = el}
                    onClick={() => { setCursor(i); spokenBuf.current = []; setIsComplete(false); }}
                    style={{
                      ...styles.word,
                      ...(i === cursor ? styles.wordActive
                        : i < cursor ? styles.wordDone
                        : styles.wordComing)
                    }}
                  >
                    {tok.word}{" "}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Pulse keyframe via injected style */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes dotpulse { 0%,100%{box-shadow:0 0 6px rgba(168,85,247,.8)} 50%{box-shadow:0 0 14px rgba(168,85,247,1)} }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    minHeight: "100vh",
    background: "#08080f",
    color: "#e2e8f0",
    fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 16,
    gap: 28,
  },
  islandWrap: {
    position: "sticky",
    top: 16,
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  island: {
    background: "#0c0c14",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 40,
    padding: "10px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    minWidth: 320,
    boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
    transition: "box-shadow 0.4s, border-color 0.4s",
  },
  islandActive: {
    borderColor: "rgba(168,85,247,0.3)",
    boxShadow: "0 0 0 1px rgba(168,85,247,0.12), 0 0 40px rgba(168,85,247,0.08), 0 8px 32px rgba(0,0,0,0.7)",
  },
  islandLeft: { display: "flex", alignItems: "center", gap: 10 },
  islandRight: { display: "flex", alignItems: "center", gap: 8 },
  brand: { fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: "#6366f1", opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#1e293b", flexShrink: 0, transition: "all 0.3s" },
  dotLive: { background: "#a855f7", animation: "pulse 1.5s infinite, dotpulse 1.5s infinite" },
  dotPaused: { background: "#f59e0b" },
  btnPlay: {
    border: "none", borderRadius: 20, padding: "7px 16px",
    background: "linear-gradient(135deg,#7c3aed,#a855f7)",
    color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
    boxShadow: "0 2px 12px rgba(124,58,237,.45)", letterSpacing: "0.02em",
  },
  btnStop: {
    border: "1px solid rgba(239,68,68,.25)", borderRadius: 20, padding: "6px 14px",
    background: "rgba(239,68,68,.12)", color: "#f87171",
    fontWeight: 600, fontSize: 13, cursor: "pointer",
  },
  btnGhost: {
    border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: "6px 11px",
    background: "rgba(255,255,255,.04)", color: "#94a3b8",
    fontWeight: 600, fontSize: 13, cursor: "pointer",
  },
  unsupported: { fontSize: 12, color: "#f59e0b", fontStyle: "italic" },
  settings: {
    background: "#0c0c14",
    border: "1px solid rgba(255,255,255,.07)",
    borderRadius: 16, padding: "14px 18px",
    display: "flex", flexDirection: "column", gap: 12,
    minWidth: 300, boxShadow: "0 8px 24px rgba(0,0,0,.5)",
  },
  settingRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 },
  select: {
    background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 8, color: "#e2e8f0", padding: "4px 8px", fontSize: 12, outline: "none",
  },
  main: { width: "100%", maxWidth: 860, padding: "0 24px 60px" },
  label: { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#334155" },
  textarea: {
    width: "100%", minHeight: "58vh",
    background: "rgba(255,255,255,.02)",
    border: "1px solid rgba(255,255,255,.06)",
    borderRadius: 14, padding: 22,
    color: "#94a3b8", fontSize: "1.05rem", lineHeight: 1.85,
    resize: "vertical", outline: "none",
    fontFamily: "-apple-system, sans-serif",
  },
  hint: { fontSize: 12, color: "#1e293b", textAlign: "right" },
  presentView: { minHeight: "58vh", display: "flex", alignItems: "flex-start", paddingTop: 20 },
  scriptDisplay: { lineHeight: 2, userSelect: "none" },
  word: { display: "inline", cursor: "pointer", borderRadius: 4, padding: "1px 2px", transition: "all .15s" },
  wordComing: { color: "#334155" },
  wordDone: { color: "#1e293b" },
  wordActive: {
    color: "#f3e8ff", background: "rgba(168,85,247,.22)",
    borderRadius: 5, fontWeight: 600, padding: "1px 5px",
    boxShadow: "0 0 18px rgba(168,85,247,.35)",
  },
  completeBox: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "58vh", gap: 14,
  },
  check: { fontSize: "3rem", color: "#a855f7", lineHeight: 1 },
};
