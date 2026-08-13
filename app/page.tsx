"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DomainResult, StreamEvent } from "@/lib/types";

const TLD_OPTIONS = ["pl", "com", "eu", "shop", "store", "online"];

type LogItem = { time: string; text: string };

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
  const [log, setLog] = useState<LogItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastHeartbeatRef = useRef<number>(0);

  const available = useMemo(() => results.filter((item) => item.state === "available").sort((a, b) => b.score - a.score), [results]);
  const registered = useMemo(() => results.filter((item) => item.state === "registered").length, [results]);
  const unknown = useMemo(() => results.filter((item) => item.state === "unknown").length, [results]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (!lastHeartbeatRef.current) return;
      if (Date.now() - lastHeartbeatRef.current > 12000) {
        abortRef.current?.abort();
        setRunning(false);
        setStage("watchdog");
        setStatus("Watchdog zatrzymał zadanie: brak heartbeat przez 12 sekund.");
        addLog("WATCHDOG: brak heartbeat — zadanie zatrzymane.");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [running]);

  function addLog(text: string) {
    const item = { time: new Date().toLocaleTimeString("pl-PL"), text };
    setLog((current) => [...current, item].slice(-40));
  }

  function toggleTld(tld: string) {
    setSelectedTlds((current) => current.includes(tld) ? current.filter((item) => item !== tld) : [...current, tld]);
  }

  function applyEvent(event: StreamEvent) {
    setHeartbeat(event.heartbeat);
    lastHeartbeatRef.current = Date.parse(event.heartbeat) || Date.now();
    if (event.type === "status") {
      setStage(event.stage);
      setStatus(event.message);
      setProgress(event.progress);
      addLog(event.message);
    } else if (event.type === "candidate") {
      setStage("availability");
      setResults((current) => [...current, event.result]);
      setChecked(event.checked);
      setTotal(event.total);
      setProgress(25 + Math.round((event.checked / Math.max(1, event.total)) * 70));
      setStatus(`Sprawdzono ${event.checked}/${event.total}: ${event.result.domain}`);
      addLog(`${event.result.domain} → ${event.result.state.toUpperCase()}`);
    } else if (event.type === "complete") {
      setResults(event.results);
      setChecked(event.checked);
      setTotal(event.total);
      setStage("complete");
      setProgress(100);
      setStatus(`Gotowe. Sprawdzono ${event.total} domen.`);
      setRunning(false);
      addLog(`ZAKOŃCZONE: ${event.total} domen.`);
    } else if (event.type === "error") {
      setStage("error");
      setStatus(event.message);
      setRunning(false);
      addLog(`BŁĄD: ${event.message}`);
    }
  }

  async function startSearch(event: FormEvent) {
    event.preventDefault();
    if (running || selectedTlds.length === 0) return;
    const abort = new AbortController();
    abortRef.current = abort;
    lastHeartbeatRef.current = Date.now();
    setResults([]);
    setLog([]);
    setChecked(0);
    setTotal(0);
    setProgress(2);
    setStage("starting");
    setStatus("Uruchamiam radar…");
    setRunning(true);
    addLog("START: uruchamiam radar.");

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
      if ((error as Error).name === "AbortError") {
        if (stage !== "watchdog") setStatus("Wyszukiwanie zatrzymane.");
      } else {
        setStatus(error instanceof Error ? error.message : "Błąd wyszukiwania");
        addLog(`BŁĄD: ${error instanceof Error ? error.message : "Błąd wyszukiwania"}`);
      }
      if (stage !== "watchdog") setStage("error");
      setRunning(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setStage("stopped");
    setStatus("Wyszukiwanie zatrzymane ręcznie.");
    addLog("STOP: zatrzymano ręcznie.");
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
        <div className="metrics four">
          <div><span>Sprawdzone</span><strong>{checked}/{total || "—"}</strong></div>
          <div><span>Dostępne</span><strong>{available.length}</strong></div>
          <div><span>Zajęte / ?</span><strong>{registered} / {unknown}</strong></div>
          <div><span>Heartbeat</span><strong>{heartbeat ? new Date(heartbeat).toLocaleTimeString("pl-PL") : "—"}</strong></div>
        </div>
        <div className="liveLog">
          <div className="liveLogHead"><strong>Dziennik LIVE</strong><span>{log.length} zdarzeń</span></div>
          <div className="liveLogBody">
            {log.length === 0 ? <div className="logEmpty">Brak zdarzeń.</div> : log.slice().reverse().map((item, index) => <div className="logRow" key={`${item.time}-${index}`}><time>{item.time}</time><span>{item.text}</span></div>)}
          </div>
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
