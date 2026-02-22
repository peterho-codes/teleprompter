import { useCallback, useRef, useState } from "react";

// A token is one word in the script, with its position info
export interface ScriptToken {
  word: string;          // original word (with punctuation)
  normalized: string;    // lowercased, punctuation stripped
  index: number;         // position in token array
}

// Sliding window size for matching spoken words against script
const LOOKAHEAD = 16;   // increased from 12 → helps on mobile where restarts create bigger gaps
const LOOKBEHIND = 2;   // allow small backtracking
const MIN_MATCH_LEN = 2; // skip very short words (a, I, etc.) for anchoring

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function tokenize(text: string): ScriptToken[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      word,
      normalized: normalize(word),
      index,
    }));
}

/**
 * Levenshtein distance between two short strings.
 * We use this to handle misrecognitions like "their" vs "there".
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
    }
  }
  return matrix[b.length][a.length];
}

function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

/**
 * Given the last N spoken words and a window of script tokens starting
 * at `cursorStart`, find the best new cursor position.
 *
 * Strategy:
 * 1. Take up to 3 of the most recently spoken words
 * 2. Try to match them against script tokens in the lookahead window
 * 3. Return the index of the last matched token (advance cursor there)
 */
function advanceCursor(
  spokenWords: string[],
  tokens: ScriptToken[],
  cursorStart: number
): number {
  const windowStart = Math.max(0, cursorStart - LOOKBEHIND);
  const windowEnd = Math.min(tokens.length, cursorStart + LOOKAHEAD);
  const windowTokens = tokens.slice(windowStart, windowEnd);

  // Use last 3 spoken words for anchoring
  const anchor = spokenWords.slice(-3).map(normalize).filter(Boolean);
  if (anchor.length === 0) return cursorStart;

  let bestScore = -1;
  let bestPos = cursorStart;

  // Slide anchor over the window
  for (let wi = 0; wi <= windowTokens.length - anchor.length; wi++) {
    let score = 0;
    for (let ai = 0; ai < anchor.length; ai++) {
      const scriptWord = windowTokens[wi + ai]?.normalized ?? "";
      const spoken = anchor[ai];
      // Skip very short function words from scoring unless they match exactly
      if (scriptWord.length < MIN_MATCH_LEN && spoken !== scriptWord) continue;
      score += wordSimilarity(spoken, scriptWord);
    }
    score /= anchor.length;

    // FIX: lowered threshold 0.55 → 0.45 for better mobile tolerance
    if (score > bestScore && score > 0.45) {
      bestScore = score;
      // Advance cursor to end of matched phrase
      bestPos = windowStart + wi + anchor.length - 1;
    }
  }

  return bestPos;
}

export interface UseScriptTrackerReturn {
  tokens: ScriptToken[];
  cursorIndex: number;         // current highlighted word index
  setScript: (text: string) => void;
  processSpeech: (transcript: string, isFinal: boolean) => void;
  jumpTo: (index: number) => void;
  reset: () => void;
  isComplete: boolean;
}

export function useScriptTracker(): UseScriptTrackerReturn {
  const [tokens, setTokens] = useState<ScriptToken[]>([]);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [isComplete, setIsComplete] = useState(false);

  // FIX: tokensRef mirrors token state so processSpeech always reads fresh tokens.
  // Previously processSpeech closed over `tokens` state, causing a race condition
  // on mobile: recognition could fire before the useEffect calling setScript had run,
  // leaving processSpeech with an empty token array and the cursor never advancing.
  const tokensRef = useRef<ScriptToken[]>([]);

  // Rolling buffer of spoken words (keeps last ~20) — only populated from FINAL results
  const spokenBufferRef = useRef<string[]>([]);

  // Interim transcript words held separately — used for optimistic cursor preview only
  const interimWordsRef = useRef<string[]>([]);

  const setScript = useCallback((text: string) => {
    const toks = tokenize(text);
    tokensRef.current = toks;  // FIX: update ref immediately and synchronously
    setTokens(toks);
    setCursorIndex(-1);
    setIsComplete(false);
    spokenBufferRef.current = [];
    interimWordsRef.current = [];
  }, []);

  // FIX: processSpeech no longer closes over `tokens` state — reads tokensRef.current
  // which is always current. This makes processSpeech a stable reference with no deps,
  // preventing unnecessary re-creation and callback churn on every cursor update.
  const processSpeech = useCallback(
    (transcript: string, isFinal: boolean) => {
      const currentTokens = tokensRef.current;
      if (currentTokens.length === 0) return; // guard: no script loaded yet

      const words = transcript.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return;

      if (isFinal) {
        // ── FINAL result ────────────────────────────────────────────────────
        interimWordsRef.current = [];

        spokenBufferRef.current = [
          ...spokenBufferRef.current,
          ...words,
        ].slice(-20);

        setCursorIndex((prev) => {
          const newCursor = advanceCursor(
            spokenBufferRef.current,
            currentTokens,
            Math.max(0, prev)
          );

          if (newCursor >= currentTokens.length - 1) {
            setIsComplete(true);
          }

          return newCursor > prev ? newCursor : prev;
        });
      } else {
        // ── INTERIM result ──────────────────────────────────────────────────
        interimWordsRef.current = words;

        const combined = [...spokenBufferRef.current, ...interimWordsRef.current].slice(-20);

        setCursorIndex((prev) => {
          const newCursor = advanceCursor(
            combined,
            currentTokens,
            Math.max(0, prev)
          );

          return newCursor > prev ? newCursor : prev;
        });
      }
    },
    [] // FIX: empty deps — reads everything through refs, never goes stale
  );

  const jumpTo = useCallback((index: number) => {
    setCursorIndex(index);
    setIsComplete(false);
    // Clear both buffers when user manually jumps
    spokenBufferRef.current = [];
    interimWordsRef.current = [];
  }, []);

  const reset = useCallback(() => {
    setCursorIndex(-1);
    setIsComplete(false);
    spokenBufferRef.current = [];
    interimWordsRef.current = [];
  }, []);

  return { tokens, cursorIndex, setScript, processSpeech, jumpTo, reset, isComplete };
}
