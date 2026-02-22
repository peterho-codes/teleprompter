"use client";

import { useEffect, useRef } from "react";

interface WaveformProps {
  active: boolean;
  color?: string;
}

export function Waveform({ active, color = "#a78bfa" }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(animRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
      }
      // Clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    let cancelled = false;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const audioCtx = new AudioContext();
        ctxRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyserRef.current = analyser;
        audioCtx.createMediaStreamSource(stream).connect(analyser);

        const draw = () => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const W = canvas.width;
          const H = canvas.height;
          const bufLen = analyser.frequencyBinCount;
          const dataArr = new Uint8Array(bufLen);
          analyser.getByteTimeDomainData(dataArr);

          ctx.clearRect(0, 0, W, H);
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";

          const sliceW = W / bufLen;
          let x = 0;
          for (let i = 0; i < bufLen; i++) {
            const v = dataArr[i] / 128.0;
            const y = (v * H) / 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            x += sliceW;
          }
          ctx.stroke();
          animRef.current = requestAnimationFrame(draw);
        };

        draw();
      } catch {
        // mic permission denied — silently skip waveform
      }
    }

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close();
    };
  }, [active, color]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={32}
      style={{ display: "block", opacity: 0.8 }}
    />
  );
}
