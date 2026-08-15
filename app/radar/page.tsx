"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_RADAR_SETTINGS, type ModelChoice, type RadarSettings, type SearchLanguage, type SearchMode } from "@/lib/settings";
import type { DomainResult, StreamEvent } from "@/lib/types";

const TLD_OPTIONS = ["pl", "com", "eu", "io", "ai", "net", "org", "co", "de", "cz", "shop", "store", "online"];
const BATCH_SIZE = 100;
const MAX_BATCHES = 5;
const MODEL_OPTIONS: Array<{ value: ModelChoice; short: string; label: string }> = [
  { value: "auto", short: "AUTO", label: "AUTO — dobiera model do cyklu" },
  { value: "gpt-5.4", short: "5.4", label: "GPT-5.4" },
  { value: "gpt-5.5", short: "5.5", label: "GPT-5.5" },
  { value: "gpt-5.6-luna", short: "5.6 L", label: "GPT-5.6 Luna — szybka / ekonomiczna" },
  { value: "gpt-5.6-terra", short: "5.6 T", label: "GPT-5.6 Terra — balans" },
  { value: "gpt-5.6-sol", short: "5.6 S", label: "GPT-5.6 Sol — najmocniejsza" },
];

type LogItem = { time: string; text: string };
type SearchMemory = { batch: number; results: DomainResult[] };

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 120);
}

function memoryKey(prompt: string, tld: string) {
  return `domain-radar:v3:${normalizeKey(prompt)}:${tld}`;
}

function parseExpected(value: string) {
  return Array.from(new Set(value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 30);
}

function money(value: number | undefined, currency = "PLN") {
  if (value === undefined) return "Cena do sprawdzenia";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function Home() {
  const [prompt, setPrompt] = useState("Labuco");
  const [selectedTld, setSelectedTld] = useState("pl");
  const [settings, setSettings] = useState<RadarSettings>(DEFAULT_RADAR_SETTINGS);
  const [expectedText, setExpectedText] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [buyingDomain, setBuyingDomain] = useState<string | null>(null);
  const [buyError, setBuyError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const watchdogTriggeredRef = useRef(false);
  const resultsRef = useRef<DomainResult[]>([]);

  const selectedModelIndex = Math.max(0, MODEL_OPTIONS.findIndex((item) => item.value === settings.model));
  const selectedModel = MODEL_OPTIONS[selectedModelIndex] ?? MODEL_OPTIONS[0];
  const available = useMemo(() => results.filter((item) => item.state === "available").sort((a, b) => b.score - a.score), [results]);
  const registered = useMemo(() => results.filter((item) => item.state === "registered").length, [results]);
  const unknown = useMemo(() => results.filter((item) => item.state === "unknown").length, [results]);
  const allSorted = useMemo(() => {
    const source = settings.onlyAvailable ? results.filter((item) => item.state === "available") : results;
    const rank = { available: 0, unknown: 1, registered: 2 } as const;
    return [...source].sort((a, b) => rank[a.state] - rank[b.state] || b.score - a.score || a.label.length - b.label.length || b.similarity - a.similarity);
  }, [results, settings.onlyAvailable]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("domain-radar:advanced:v1");
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<RadarSettings> & { expectedText?: string };
      setSettings({ ...DEFAULT_RADAR_SETTINGS, ...saved, expected: Array.isArray(saved.expected) ? saved.expected : [] });
      setExpectedText(saved.expectedText ?? (Array.isArray(saved.expected) ? saved.expected.join("\n") : ""));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("domain-radar:advanced:v1", JSON.stringify({ ...settings, expectedText }));
    } catch {}
  }, [settings, expectedText]);

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
      setStatus(`Przywrócono ${restored.length} wyników dla .${selectedTld}.`);
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
    setLog((current) => [...current, { time: new Date().toLocaleTimeString("pl-PL"), text }].slice(-80));
  }

  function persist(key: string, nextBatch: number, nextResults: DomainResult[]) {
    try {
      window.localStorage.setItem(key, JSON.stringify({ batch: nextBatch, results: nextResults.slice(0, 500) } satisfies SearchMemory));
    } catch {
      addLog("Pamięć lokalna niedostępna — wyniki pozostają na ekranie.");
    }
  }

  function appendResult(result: DomainResult) {
    const existingIndex = resultsRef.current.findIndex((item) => item.domain === result.domain);
    if (existingIndex >= 0) {
      const next = [...resultsRef.current];
      next[existingIndex] = result;
      resultsRef.current = next;
    } else {
      resultsRef.current = [...resultsRef.current, result].slice(0, 500);
    }
    setResults(resultsRef.current);
  }

  function updateSettings(patch: Partial<RadarSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function buyDomain(item: DomainResult) {
    if (item.state !== "available" || buyingDomain) return;
    setBuyingDomain(item.domain);
    setBuyError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: item.domain }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) throw new Error(payload.error || "Nie udało się rozpocząć płatności.");
      window.location.assign(payload.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nie udało się rozpocząć płatności.";
      setBuyError(`${item.domain}: ${message}`);
      setBuyingDomain(null);
    }
  }

  async function startSearch(event?: FormEvent) {
    event?.preventDefault();
    if (running || batch >= MAX_BATCHES || prompt.trim().length < 1) return;
    const targetBatch = batch + 1;
    const key = memoryKey(prompt, selectedTld);
    const exclude = Array.from(new Set(resultsRef.current.map((item) => item.label)));
    const requestSettings: RadarSettings = { ...settings, expected: parseExpected(expectedText) };
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
    addLog(`START ${targetBatch}/5 · model ${selectedModel.short} · pomijam ${exclude.length} nazw.`);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tld: selectedTld, limit: BATCH_SIZE, exclude, batch: targetBatch, settings: requestSettings }),
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
            setBatch(targetBatch);
            setChecked(streamEvent.checked);
            setTotal(streamEvent.total);
            setStage("complete");
            setProgress(100);
            setStatus(targetBatch >= MAX_BATCHES ? `Gotowe — ${resultsRef.current.length}/500 nazw dla .${selectedTld}.` : `Partia ${targetBatch}/5 gotowa. Wyszukaj kolejne 100 — bez powtórek.`);
            setRunning(false);
            persist(key, targetBatch, resultsRef.current);
            addLog(`ZAKOŃCZONE: ${targetBatch}/5 · łącznie ${resultsRef.current.length} nazw.`);
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
    window.localStorage.removeItem(memoryKey(prompt, selectedTld));
    resultsRef.current = [];
    setResults([]);
    setBatch(0);
    setChecked(0);
    setTotal(0);
    setProgress(0);
    setStage("idle");
    setStatus("RESET — możesz zacząć od pierwszej setki.");
    setLog([]);
    setBuyError("");
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">DOMAIN / BRAND INTELLIGENCE · LIVE PRICING</div>
        <h1>Domain Radar AI</h1>
        <p>Wpisz nawet jedną literę. Radar generuje do 500 nowych nazw, sprawdza dostępność i pokazuje cenę zakupu. Dostępną domenę możesz od razu opłacić i zarejestrować.</p>
      </section>

      <section className="card searchCard">
        <form onSubmit={startSearch}>
          <label htmlFor="prompt">QUERY — litera, słowo, fragment, marka albo opis</label>
          <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} disabled={running} placeholder="np. x, labu, Labuco, sklep z telewizorami…" />
          <div className="tldLabel">TLD</div>
          <div className="tlds">
            {TLD_OPTIONS.map((tld) => <button key={tld} type="button" disabled={running} className={selectedTld === tld ? "chip active" : "chip"} onClick={() => setSelectedTld(tld)}>.{tld}</button>)}
          </div>

          <button className="advancedToggle" type="button" onClick={() => setAdvancedOpen((value) => !value)} disabled={running}>
            {advancedOpen ? "Ukryj ustawienia zaawansowane" : "Ustawienia zaawansowane"} <span>{advancedOpen ? "▲" : "▼"}</span>
          </button>

          {advancedOpen && (
            <div className="advancedPanel">
              <div className="advancedTitle"><strong>Model AI</strong><span>{selectedModel.label}</span></div>
              <input className="modelSlider" type="range" min="0" max={MODEL_OPTIONS.length - 1} step="1" value={selectedModelIndex} onChange={(e) => updateSettings({ model: MODEL_OPTIONS[Number(e.target.value)].value })} />
              <div className="modelMarks">{MODEL_OPTIONS.map((item, index) => <button type="button" key={item.value} className={index === selectedModelIndex ? "modelMark active" : "modelMark"} onClick={() => updateSettings({ model: item.value })}>{item.short}</button>)}</div>

              <div className="settingGrid">
                <label className="settingField"><span>Minimalna długość</span><strong>{settings.minLength}</strong><input type="range" min="1" max={Math.min(12, settings.maxLength)} value={settings.minLength} onChange={(e) => updateSettings({ minLength: Number(e.target.value) })} /></label>
                <label className="settingField"><span>Maksymalna długość</span><strong>{settings.maxLength}</strong><input type="range" min={Math.max(2, settings.minLength)} max="18" value={settings.maxLength} onChange={(e) => updateSettings({ maxLength: Number(e.target.value) })} /></label>
                <label className="settingField"><span>Tryb</span><select value={settings.mode} onChange={(e) => updateSettings({ mode: e.target.value as SearchMode })}><option value="all">ALL — domyślny</option><option value="ultra-short">ULTRA SHORT</option><option value="close">CLOSE MATCH</option><option value="brandable">BRANDABLE</option><option value="semantic">SEMANTIC</option><option value="creative">CREATIVE</option></select></label>
                <label className="settingField"><span>Język</span><select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as SearchLanguage })}><option value="all">All</option><option value="pl">PL</option><option value="en">EN</option><option value="international">International</option></select></label>
              </div>

              <label className="expectedField"><span>EXPECTED / OCZEKIWANE — pozytywne przykłady</span><textarea value={expectedText} onChange={(e) => setExpectedText(e.target.value)} placeholder="np. labu, labo, labko, labio" /></label>
              <label className="toggleLine"><input type="checkbox" checked={settings.onlyAvailable} onChange={(e) => updateSettings({ onlyAvailable: e.target.checked })} /><span>Pokazuj w pełnej liście tylko dostępne</span></label>
              <div className="advancedHint">Cyfry: OFF · myślniki: OFF · Dynadot LIVE: dostępność + ceny · RDAP: awaryjna weryfikacja dostępności · AUTO: Luna w cyklach 1–3, Terra w 4, Sol w 5.</div>
            </div>
          )}

          <div className="batchBar">
            <div><span>Partia</span><strong>{batch}/5</strong></div>
            <div><span>FOUND</span><strong>{results.length}/500</strong></div>
            <div><span>Model</span><strong>{selectedModel.short}</strong></div>
          </div>
          <div className="actions">
            <button className="primary" type="submit" disabled={running || prompt.trim().length < 1 || batch >= MAX_BATCHES}>{running ? `Szukam partii ${batch + 1}/5…` : batch === 0 ? "Wyszukaj pierwsze 100" : batch < MAX_BATCHES ? "Wyszukaj kolejne 100" : "Limit 500 osiągnięty"}</button>
            {running && <button className="secondary" type="button" onClick={stop}>Stop</button>}
            {!running && batch > 0 && <button className="ghost" type="button" onClick={resetCurrent}>RESET</button>}
          </div>
        </form>
      </section>

      {buyError && <div className="purchaseError">{buyError}</div>}

      <section className="card monitor">
        <div className="monitorHead"><strong>Status: {stage}</strong><span className={running ? "pulse live" : "pulse"}>{running ? "LIVE" : "IDLE"}</span></div>
        <div className="progress"><div style={{ width: `${progress}%` }} /></div>
        <div className="statusLine"><span>{status}</span><span>{progress}%</span></div>
        <div className="metrics four"><div><span>Partia</span><strong>{batch + (running ? 1 : 0)}/5</strong></div><div><span>Dostępne</span><strong>{available.length}</strong></div><div><span>Zajęte / ?</span><strong>{registered} / {unknown}</strong></div><div><span>Heartbeat</span><strong>{heartbeat ? new Date(heartbeat).toLocaleTimeString("pl-PL") : "—"}</strong></div></div>
        <div className="liveLog"><div className="liveLogHead"><strong>Dziennik LIVE</strong><span>{log.length} zdarzeń</span></div><div className="liveLogBody">{log.length === 0 ? <div className="logEmpty">Brak zdarzeń.</div> : log.slice().reverse().map((item, index) => <div className="logRow" key={`${item.time}-${index}`}><time>{item.time}</time><span>{item.text}</span></div>)}</div></div>
      </section>

      <section className="results">
        <div className="resultsHead"><h2>Najmocniejsze dostępne domeny</h2><span>{available.length} dostępnych</span></div>
        {available.length === 0 ? <div className="empty">Dostępne domeny z cenami pojawią się tutaj podczas skanowania.</div> : (
          <div className="grid">
            {available.slice(0, 60).map((item, index) => (
              <article className="domainCard" key={item.domain}>
                <span className="rank">#{index + 1} · {item.label.length} zn.{item.premium ? " · PREMIUM" : ""}</span>
                <h3>{item.domain}</h3>
                <div className="scoreRow"><span>Domain <strong>{item.score}</strong></span><span>Similarity <strong>{item.similarity}</strong></span><span>Brand <strong>{item.brandScore}</strong></span></div>
                <p className="reason">{item.reason}</p>
                <div className="domainPrice">
                  <span>Cena zakupu</span>
                  <strong>{money(item.retailPrice, item.currency || "PLN")}</strong>
                  {item.renewalRetailPrice !== undefined && <small>Odnowienie: {money(item.renewalRetailPrice, item.currency || "PLN")}</small>}
                </div>
                <div className="domainPurchaseRow">
                  <span className="available">DOSTĘPNA</span>
                  <button type="button" className="buyButton" onClick={() => buyDomain(item)} disabled={Boolean(buyingDomain)}>
                    {buyingDomain === item.domain ? "Przechodzę do płatności…" : "Kup domenę"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="results allResults">
        <div className="resultsHead"><h2>FOUND / wszystkie sprawdzone</h2><span>{allSorted.length}/{results.length}</span></div>
        {allSorted.length === 0 ? <div className="empty">Pierwsza partia zawiera do 100 nowych nazw.</div> : (
          <div className="compactGrid">
            {allSorted.map((item) => (
              <article className="miniDomain" key={`all-${item.domain}`}>
                <div className="miniMain">
                  <strong>{item.domain}</strong>
                  <small>{item.label.length} zn. · score {item.score} · sim {item.similarity}{item.state === "available" && item.retailPrice !== undefined ? ` · ${money(item.retailPrice, item.currency || "PLN")}` : ""}</small>
                </div>
                <span className={`stateBadge ${item.state}`}>{item.state === "available" ? "wolna" : item.state === "registered" ? "zajęta" : "?"}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
