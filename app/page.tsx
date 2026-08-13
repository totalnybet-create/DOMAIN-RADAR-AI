"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DomainResult, StreamEvent } from "@/lib/types";

const TLD_OPTIONS = ["pl", "com", "eu", "shop", "store", "online"];
const BATCH_SIZE = 100;
const MAX_BATCHES = 5;

type LogItem = { time: string; text: string };
type SearchMemory = { batch: number; results: DomainResult[] };

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 120);
}

function memoryKey(prompt: string, tld: string) {
  return `domain-radar:v2:${normalizeKey(prompt)}:${tld}`;
}

export default function Home() {
  const [prompt, setPrompt] = useState("Labuco");
  const [selectedTld, setSelectedTld] = useState("pl");
  const [status, setStatus] = useState("Gotowy");
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [heartbeat, setHeartbeat] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);
  const [batch, setBatch] = useState(0);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const watchdogTriggeredRef = useRef(false);
  const resultsRef = useRef<DomainResult[]>([]);

  const available = useMemo(() => results.filter((item) => item.state === "available").sort((a, b) => b.score - a.score), [results]);
  const registered = useMemo(() => results.filter((item) => item.state === "registered").length, [results]);
  const unknown = useMemo(() => results.filter((item) => item.state === "unknown").length, [results]);
  const allSorted = useMemo(() => [...results].sort((a, b) => {
    const rank = { available: 0, unknown: 1, registered: 2 } as const;
    return rank[a.state] - rank[b.state] || b.score - a.score || a.domain.localeCompare(b.domain);
  }), [results]);

  useEffect(() => {
    if (running) return;
    const key = memoryKey(prompt, selectedTld);
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        resultsRef.current = [];
        setResults([]);
        setBatch(0);
        setStatus("Gotowy — nowa pula do 500 nazw.");
        setStage("idle");
        setProgress(0);
        return;
      }
      const saved = JSON.parse(raw) as SearchMemory;
      const restored = Array.isArray(saved.results) ? saved.results.slice(0, 500) : [];
      resultsRef.current = restored;
      setResults(restored);
      setBatch(Math.max(0, Math.min(saved.batch || 0, MAX_BATCHES)));
      setStatus(`Przywrócono ${restored.length} wcześniejszych wyników dla .${selectedTld}.`);
      setStage("memory");
      setProgress(saved.batch >= MAX_BATCHES ? 100 : 0);
    } catch {
      resultsRef.current = [];
      setResults([]);
      setBatch(0);
    }
  }, [prompt, selectedTld, running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (!lastHeartbeatRef.current) return;
      if (Date.now() - lastHeartbeatRef.current > 12000) {
        watchdogTriggeredRef.current = true;
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
    setLog((current) => [...current, item].slice(-80));
  }

  function persist(key: string, nextBatch: number, nextResults: DomainResult[]) {
    try {
      window.localStorage.setItem(key, JSON.stringify({ batch: nextBatch, results: nextResults.slice(0, 500) } satisfies SearchMemory));
    } catch {
      addLog("Pamięć lokalna jest niedostępna — wyniki pozostają na ekranie.");
    }
  }

  function appendResult(result: DomainResult) {
    if (resultsRef.current.some((item) => item.domain === result.domain)) return;
    resultsRef.current = [...resultsRef.current, result].slice(0, 500);
    setResults(resultsRef.current);
  }

  async function startSearch(event?: FormEvent) {
    event?.preventDefault();
    if (running || batch >= MAX_BATCHES || prompt.trim().length < 2) return;

    const targetBatch = batch + 1;
    const key = memoryKey(prompt, selectedTld);
    const exclude = Array.from(new Set(resultsRef.current.map((item) => item.label)));
    const abort = new AbortController();
    abortRef.current = abort;
    watchdogTriggeredRef.current = false;
    lastHeartbeatRef.current = Date.now();
    setChecked(0);
    setTotal(BATCH_SIZE);
    setProgress(2);
    setStage("starting");
    setStatus(`Uruchamiam partię ${targetBatch}/${MAX_BATCHES}…`);
    setRunning(true);
    addLog(`START partii ${targetBatch}: pomijam ${exclude.length} wcześniejszych nazw.`);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tld: selectedTld, limit: BATCH_SIZE, exclude, batch: targetBatch }),
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
          const streamEvent = JSON.parse(line) as StreamEvent;
          setHeartbeat(streamEvent.heartbeat);
          lastHeartbeatRef.current = Date.parse(streamEvent.heartbeat) || Date.now();

          if (streamEvent.type === "status") {
            setStage(streamEvent.stage);
            setStatus(streamEvent.message);
            setProgress(streamEvent.progress);
            addLog(streamEvent.message);
          } else if (streamEvent.type === "candidate") {
            appendResult(streamEvent.result);
            setStage("availability");
            setChecked(streamEvent.checked);
            setTotal(streamEvent.total);
            setProgress(20 + Math.round((streamEvent.checked / Math.max(1, streamEvent.total)) * 75));
            setStatus(`Partia ${targetBatch}: ${streamEvent.checked}/${streamEvent.total} — ${streamEvent.result.domain}`);
            if (streamEvent.checked % 10 === 0 || streamEvent.result.state === "available") addLog(`${streamEvent.result.domain} → ${streamEvent.result.state.toUpperCase()}`);
          } else if (streamEvent.type === "complete") {
            for (const result of streamEvent.results) appendResult(result);
            const nextBatch = targetBatch;
            setBatch(nextBatch);
            setChecked(streamEvent.checked);
            setTotal(streamEvent.total);
            setStage("complete");
            setProgress(100);
            setStatus(nextBatch >= MAX_BATCHES ? `Gotowe — osiągnięto limit ${resultsRef.current.length}/500 nazw dla .${selectedTld}.` : `Partia ${nextBatch}/5 gotowa. Możesz wyszukać kolejne 100 nowych nazw.`);
            setRunning(false);
            persist(key, nextBatch, resultsRef.current);
            addLog(`ZAKOŃCZONE: partia ${nextBatch}/5. Łącznie ${resultsRef.current.length} nazw.`);
          } else if (streamEvent.type === "error") {
            setStage("error");
            setStatus(streamEvent.message);
            setRunning(false);
            addLog(`BŁĄD: ${streamEvent.message}`);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        if (!watchdogTriggeredRef.current) {
          setStatus("Wyszukiwanie zatrzymane.");
          setStage("stopped");
        }
      } else {
        const message = error instanceof Error ? error.message : "Błąd wyszukiwania";
        setStatus(message);
        setStage("error");
        addLog(`BŁĄD: ${message}`);
      }
      setRunning(false);
    }
  }

  function stop() {
    watchdogTriggeredRef.current = false;
    abortRef.current?.abort();
    setRunning(false);
    setStage("stopped");
    setStatus("Wyszukiwanie zatrzymane ręcznie.");
    addLog("STOP: zatrzymano ręcznie.");
  }

  function resetCurrent() {
    if (running) return;
    const key = memoryKey(prompt, selectedTld);
    window.localStorage.removeItem(key);
    resultsRef.current = [];
    setResults([]);
    setBatch(0);
    setChecked(0);
    setTotal(0);
    setProgress(0);
    setStage("idle");
    setStatus("Wyczyszczono tę pulę. Możesz zacząć nowe 5 × 100.");
    setLog([]);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">DOMAIN / BRAND INTELLIGENCE</div>
        <h1>Domain Radar AI</h1>
        <p>Wpisz słowo, nazwę albo opis biznesu. Radar tworzy bliskie warianty, sprawdza domeny po 100 i pamięta do 500 różnych propozycji.</p>
      </section>

      <section className="card searchCard">
        <form onSubmit={startSearch}>
          <label htmlFor="prompt">Nazwa, słowo albo opis biznesu</label>
          <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} disabled={running} placeholder="np. Labuco, telewizory premium, sklep z odzieżą…" />
          <div className="tldLabel">Wybierz końcówkę — każda TLD ma własną pulę do 500 nazw:</div>
          <div className="tlds">
            {TLD_OPTIONS.map((tld) => (
              <button key={tld} type="button" disabled={running} className={selectedTld === tld ? "chip active" : "chip"} onClick={() => setSelectedTld(tld)}>.{tld}</button>
            ))}
          </div>
          <div className="batchBar">
            <div><span>Partia</span><strong>{batch}/5</strong></div>
            <div><span>Zapamiętane nazwy</span><strong>{results.length}/500</strong></div>
            <div><span>Aktualna TLD</span><strong>.{selectedTld}</strong></div>
          </div>
          <div className="actions">
            <button className="primary" type="submit" disabled={running || prompt.trim().length < 2 || batch >= MAX_BATCHES}>
              {running ? `Szukam partii ${batch + 1}/5…` : batch === 0 ? "Wyszukaj pierwsze 100" : batch < MAX_BATCHES ? "Wyszukaj kolejne 100" : "Limit 500 osiągnięty"}
            </button>
            {running && <button className="secondary" type="button" onClick={stop}>Stop</button>}
            {!running && batch > 0 && <button className="ghost" type="button" onClick={resetCurrent}>Wyczyść tę pulę</button>}
          </div>
        </form>
      </section>

      <section className="card monitor">
        <div className="monitorHead"><strong>Status: {stage}</strong><span className={running ? "pulse live" : "pulse"}>{running ? "LIVE" : "IDLE"}</span></div>
        <div className="progress"><div style={{ width: `${progress}%` }} /></div>
        <div className="statusLine"><span>{status}</span><span>{progress}%</span></div>
        <div className="metrics four">
          <div><span>Partia</span><strong>{batch + (running ? 1 : 0)}/5</strong></div>
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
        <div className="resultsHead"><h2>Najmocniejsze dostępne domeny</h2><span>{available.length} dostępnych</span></div>
        {available.length === 0 ? <div className="empty">Dostępne domeny pojawią się tutaj podczas skanowania.</div> : (
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

      <section className="results allResults">
        <div className="resultsHead"><h2>Wszystkie sprawdzone nazwy</h2><span>{results.length}/500</span></div>
        {allSorted.length === 0 ? <div className="empty">Pierwsza partia zawiera do 100 nowych nazw.</div> : (
          <div className="compactGrid">
            {allSorted.map((item) => (
              <article className="miniDomain" key={`all-${item.domain}`}>
                <strong>{item.domain}</strong>
                <span className={`stateBadge ${item.state}`}>{item.state === "available" ? "wolna" : item.state === "registered" ? "zajęta" : "?"}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
