"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./session-speech-reader.module.css";

type Playback = "idle" | "playing" | "paused";

function readableText(markdown: string, title: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/^\s*\.\s*/, "")
    .trim()
    .replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.!?]?\\s*`, "i"), "");
}

function chunks(text: string, maxLength = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const result: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (const word of words) {
      if (current.length + word.length + 1 > maxLength && current) {
        result.push(current.trim());
        current = "";
      }
      current += `${current ? " " : ""}${word}`;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export function SessionSpeechReader({ source, title }: { source: string; title: string }) {
  const [supported, setSupported] = useState(false);
  const [playback, setPlayback] = useState<Playback>("idle");
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const queue = useRef<string[]>([]);
  const index = useRef(0);
  const active = useRef(false);
  const generation = useRef(0);
  const speedRef = useRef(speed);
  const sourceText = readableText(source, title);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      generation.current++;
      active.current = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function stop() {
    generation.current++;
    active.current = false;
    window.speechSynthesis.cancel();
    setPlayback("idle");
  }

  function speakNext(token: number) {
    if (!active.current || token !== generation.current) return;
    if (index.current >= queue.current.length) {
      active.current = false;
      setPlayback("idle");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(queue.current[index.current]);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => voice.lang.toLowerCase() === "pt-br")
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("pt"));
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred?.lang ?? "pt-BR";
    utterance.rate = speedRef.current;
    utterance.onend = () => {
      if (token !== generation.current) return;
      index.current++;
      speakNext(token);
    };
    utterance.onerror = (event) => {
      if (token !== generation.current || event.error === "canceled" || event.error === "interrupted") return;
      active.current = false;
      setPlayback("idle");
      setError("A narração foi interrompida pelo navegador. Tente reproduzir novamente.");
    };
    window.speechSynthesis.speak(utterance);
  }

  function play() {
    if (!supported) return;
    if (playback === "paused") {
      window.speechSynthesis.resume();
      setPlayback("playing");
      return;
    }
    stop();
    setError("");
    queue.current = chunks(sourceText);
    index.current = 0;
    if (!queue.current.length) return;
    const token = ++generation.current;
    active.current = true;
    setPlayback("playing");
    speakNext(token);
  }

  if (!supported) return null;

  return (
    <section className={styles.reader} aria-label="Ouvir resumo da sessão">
      <div className={styles.heading}>Ouvir resumo da sessão</div>
      <div className={styles.controls}>
        {playback === "playing" ? (
          <button type="button" onClick={() => { window.speechSynthesis.pause(); setPlayback("paused"); }}>Pausar</button>
        ) : (
          <button type="button" onClick={play}>{playback === "paused" ? "Continuar" : "Ouvir resumo"}</button>
        )}
        <button type="button" onClick={stop} disabled={playback === "idle"}>Parar</button>
        <label htmlFor="session-speech-rate">Velocidade</label>
        <select id="session-speech-rate" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          <option value={0.75}>0,75×</option>
          <option value={1}>1×</option>
          <option value={1.25}>1,25×</option>
          <option value={1.5}>1,5×</option>
          <option value={2}>2×</option>
        </select>
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
  );
}
