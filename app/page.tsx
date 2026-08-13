"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import type { DomainResult, StreamEvent } from "@/lib/types";

const TLD_OPTIONS = ["pl", "com", "eu", "shop", "store", "online"];

export default function Home() {
  const [prompt, setPrompt] = useState("Sklep internetowy z odzieżą premium i streetwear");
  const [selectedTlds, setSelectedTlds] = useState(["pl", "com", "eu"]);
  const [status, setStatus] = useState("Gotowy");
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [heartbeat, setHeartbeat] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const available = useMemo(() => results.filter((item) => item.state === "available").sort((a, b) => b.score - a.score), [results]);

  function toggleTld(tld: string) {
    setSelectedTlds((current) => current.includes(tld) ? current.filter((item) => item !== tld) : [...current, tld]);
  }

  function applyEvent(event: StreamEvent) {
    setHeartbeat(event.heartbeat);
    if (event.type === "status") {
      setStage(event.stage);
      setStatus(event.message);
      setProgress(event.progress);
    } else if (event.type === "candidate") {
      setStage("availability");
      setResults((current) => [...current, event.result]);
      setChecked(event.checked);
      setTotal(event.total);
      setProgress(25 + Math.round((event.checked / Math.max(1, event.total)) * 70));
      setStatus(`Sprawdzono ${event.checked}/${event.total}: ${event.result.domain}`);
    } else if (event.type === "complete") {
      setResults(event.results);
      setChecked(event.checked);
      setTotal(event.total);
      setStage("complete");
      setProgress(100);
      setStatus(`Gotowe. Sprawdzono ${event.total} domen.`);
      setRunning(false);
    } else if (event.type === "error") {
      setStage("error");
      setStatus(event.message);
      setRunning(false);
    }
  }

  async function startSearch(event: FormEvent) {
    event.preventDefault();
    if (running || selectedTlds.length === 0) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setResults([]);
    setChecked(0);
    setTotal(0);
    setProgress(2);
    setStage("starting");
    setStatus("Uruchamiam radar…");
    setRunning(true);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tlds: selectedTlds, limit: 12 }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Błąd API: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          applyEvent(JSON.parse(line) as StreamEvent);
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") setStatus("Wyszukiwanie zatrzymane.");
      else setStatus(error instanceof Error ? error.message : "Błąd wyszukiwania");
      setStage("error");
      setRunning(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">DOMAIN / BRAND INTELLIGENCE</div>
        <h1>Domain Radar AI</h1>
        <p>Opisz biznes jednym zdaniem. Radar tworzy brandowe nazwy, sprawdza domeny i pokazuje pracę na żywo.</p>
      </section>

      <section className="card searchCard">
        <form onSubmit={startSearch}>
          <label htmlFor="prompt">Co chcesz uruchomić?</label>
          <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} />
          <div className="tlds">
            {TLD_OPTIONS.map((tld) => (
              <button key={tld} type="button" className={selectedTlds.includes(tld) ? "chip active" : "chip"} onClick={() => toggleTld(tld)}>.{tld}</button>
            ))}
          </div>
          <div className="actions">
            <button className="primary" type="submit" disabled={running || prompt.trim().length < 3 || selectedTlds.length === 0}>{running ? "Radar pracuje…" : "Uruchom radar"}</button>
            {running && <button className="secondary" type="button" onClick={stop}>Stop</button>}
          </div>
        </form>
      </section>

      <section className="card monitor">
        <div className="monitorHead"><strong>Status: {stage}</strong><span className={running ? "pulse live" : "pulse"}>{running ? "LIVE" : "IDLE"}</span></div>
        <div className="progress"><div style={{ width: `${progress}%` }} /></div>
        <div className="statusLine"><span>{status}</span><span>{progress}%</span></div>
        <div className="metrics">
          <div><span>Sprawdzone</span><strong>{checked}/{total || "—"}</strong></div>
          <div><span>Dostępne</span><strong>{available.length}</strong></div>
          <div><span>Heartbeat</span><strong>{heartbeat ? new Date(heartbeat).toLocaleTimeString("pl-PL") : "—"}</strong></div>
        </div>
      </section>

      <section className="results">
        <div className="resultsHead"><h2>Najmocniejsze dostępne domeny</h2><span>{available.length} wyników</span></div>
        {available.length === 0 ? <div className="empty">Dostępne domeny pojawiają się tutaj w trakcie skanowania.</div> : (
          <div className="grid">
            {available.map((item, index) => (
              <article className="domainCard" key={item.domain}>
                <span className="rank">#{index + 1}</span>
                <h3>{item.domain}</h3>
                <div className="score">Score <strong>{item.score}/100</strong></div>
                <span className="available">DOSTĘPNA</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
