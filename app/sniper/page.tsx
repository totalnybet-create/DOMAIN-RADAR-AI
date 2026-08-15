"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type SniperStatus = {
  connected: boolean;
  executionEnabled: boolean;
  provider: string;
  limits: { minScore: number; maxDomainPrice: number; maxDailyBudget: number };
};

type ExpiringResult = {
  type: "expiring";
  domain: string;
  domainAscii: string;
  score: number;
  length: number;
  ageYears?: number;
  archive?: string;
  deleted?: string;
  deletedTime?: number;
  expires?: string;
  majesticQuality: number;
  majesticDomains: number;
  majesticLinks: number;
  pages: number;
  registrar?: string;
};

type AuctionResult = {
  type: "auction";
  domain: string;
  domainAscii: string;
  score: number;
  auctionId: number;
  price?: number;
  minBid?: number;
  priceBuyNow?: number;
  currency: string;
  bids: number;
  watched: number;
  visits: number;
  endtime?: number;
  catch: boolean;
};

type Result = ExpiringResult | AuctionResult;

type ScanResponse = {
  connected?: boolean;
  mode?: "expiring" | "auctions";
  scanned?: number;
  qualified?: number;
  results?: Result[];
  error?: string;
};

function money(value?: number, currency = "PLN") {
  if (value === undefined) return "—";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function dateTime(value?: number) {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

export default function PlSniperPage() {
  const [status, setStatus] = useState<SniperStatus | null>(null);
  const [mode, setMode] = useState<"expiring" | "auctions">("expiring");
  const [minScore, setMinScore] = useState(78);
  const [maxLength, setMaxLength] = useState(14);
  const [maxPrice, setMaxPrice] = useState(50);
  const [limit, setLimit] = useState(250);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sniper/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: SniperStatus) => {
        setStatus(payload);
        if (payload?.limits?.minScore !== undefined) setMinScore(payload.limits.minScore);
        if (payload?.limits?.maxDomainPrice !== undefined) setMaxPrice(payload.limits.maxDomainPrice);
      })
      .catch(() => setStatus(null));
  }, []);

  const topScore = useMemo(() => results.reduce((best, item) => Math.max(best, item.score), 0), [results]);

  async function scan(event?: FormEvent) {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        mode,
        minScore: String(minScore),
        maxLength: String(maxLength),
        maxPrice: String(maxPrice),
        limit: String(limit),
      });
      const response = await fetch(`/api/sniper/scan?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as ScanResponse;
      if (!response.ok) throw new Error(payload.error || `Błąd API ${response.status}`);
      setResults(payload.results || []);
      setScanned(payload.scanned || 0);
      setLastRun(new Date().toLocaleTimeString("pl-PL"));
    } catch (cause) {
      setResults([]);
      setScanned(0);
      setError(cause instanceof Error ? cause.message : "Nie udało się uruchomić skanera.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <nav className={styles.nav}>
          <a className={styles.brand} href="/domains">Domena<span>Go</span></a>
          <div className={styles.navLinks}>
            <a href="/radar">Domain Radar</a>
            <a className={styles.activeLink} href="/sniper">PL Sniper</a>
          </div>
          <a className={styles.navCta} href="/radar">Rodzina skanerów</a>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroBadge}>DOMAIN RADAR FAMILY · AFTERMARKET.PL</div>
          <h1>PL <span>Sniper</span></h1>
          <p>Skaner spadających i tanich aukcyjnych domen .pl. Odsiewa śmieci, punktuje mocne nazwy i pokazuje kandydatów według jakości, historii i sygnałów rynku.</p>
          <div className={styles.statusStrip}>
            <span className={status?.connected ? styles.ok : styles.off}>● {status?.connected ? "AfterMarket API połączone" : "AfterMarket API niepodłączone"}</span>
            <span className={status?.executionEnabled ? styles.warn : styles.safe}>● AUTO BUY {status?.executionEnabled ? "ARMED" : "LOCKED"}</span>
            <span>Max domena: {money(status?.limits?.maxDomainPrice)}</span>
            <span>Budżet dzienny: {money(status?.limits?.maxDailyBudget)}</span>
          </div>
        </section>

        <section className={styles.controlCard}>
          <form onSubmit={scan}>
            <div className={styles.modeRow}>
              <button type="button" className={mode === "expiring" ? styles.modeActive : styles.modeButton} onClick={() => setMode("expiring")}>Spadające .pl</button>
              <button type="button" className={mode === "auctions" ? styles.modeActive : styles.modeButton} onClick={() => setMode("auctions")}>Aukcje .pl</button>
            </div>

            <div className={styles.controls}>
              <label>
                <span>Minimalny score <b>{minScore}</b></span>
                <input type="range" min="50" max="98" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
              </label>
              <label>
                <span>Maks. długość <b>{maxLength}</b></span>
                <input type="range" min="4" max="24" value={maxLength} onChange={(e) => setMaxLength(Number(e.target.value))} />
              </label>
              <label>
                <span>Limit wyników</span>
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  <option value="100">100</option>
                  <option value="250">250</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>
              </label>
              <label className={mode === "auctions" ? "" : styles.disabledControl}>
                <span>Maks. cena aukcji</span>
                <div className={styles.priceInput}><input type="number" min="1" step="1" value={maxPrice} disabled={mode !== "auctions"} onChange={(e) => setMaxPrice(Number(e.target.value))} /><em>PLN</em></div>
              </label>
            </div>

            <div className={styles.runRow}>
              <div>
                <strong>{mode === "expiring" ? "Tryb DROP WATCH" : "Tryb AUCTION HUNTER"}</strong>
                <span>{mode === "expiring" ? "Skan historii, wieku i Majestic. Bez automatycznego zakupu." : "Skan tanich aukcji .pl do ustawionego limitu."}</span>
              </div>
              <button className={styles.runButton} disabled={loading || status?.connected === false}>
                {loading ? "Skanuję…" : "Uruchom PL Sniper"}
              </button>
            </div>
          </form>
        </section>

        {status?.connected === false && (
          <div className={styles.notice}><strong>Moduł jest wdrożony, ale nie ma jeszcze kluczy AfterMarket.</strong><span>Po dodaniu AFTERMARKET_API_KEY i AFTERMARKET_API_PASSWORD po stronie Vercel skan zacznie działać bez zmian w kodzie.</span></div>
        )}
        {error && <div className={styles.error}>{error}</div>}

        <section className={styles.metrics}>
          <div><span>Przeskanowano</span><strong>{scanned}</strong></div>
          <div><span>Zakwalifikowane</span><strong>{results.length}</strong></div>
          <div><span>Najwyższy score</span><strong>{topScore || "—"}</strong></div>
          <div><span>Ostatni skan</span><strong>{lastRun || "—"}</strong></div>
        </section>

        <section className={styles.resultsSection}>
          <div className={styles.sectionHead}>
            <div><span>WYNIKI</span><h2>{mode === "expiring" ? "Najmocniejsze spadające .pl" : "Najmocniejsze tanie aukcje .pl"}</h2></div>
            <small>Filtr: score ≥ {minScore} · długość ≤ {maxLength}</small>
          </div>

          {!results.length && !loading ? (
            <div className={styles.empty}><strong>PL Sniper czeka na strzał.</strong><span>Po skanie pojawią się tu wyłącznie kandydaci spełniający ustawiony próg.</span></div>
          ) : (
            <div className={styles.grid}>
              {results.map((item, index) => (
                <article className={styles.card} key={`${item.type}-${item.domainAscii}-${"auctionId" in item ? item.auctionId : index}`}>
                  <div className={styles.cardTop}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={item.score >= 90 ? styles.scoreHot : item.score >= 82 ? styles.scoreGood : styles.score}>SCORE {item.score}</span>
                  </div>
                  <h3>{item.domain}</h3>

                  {item.type === "expiring" ? (
                    <>
                      <div className={styles.detailGrid}>
                        <div><span>Wiek</span><b>{item.ageYears !== undefined ? `${item.ageYears} lat` : "—"}</b></div>
                        <div><span>Trust Flow</span><b>{item.majesticQuality}</b></div>
                        <div><span>Ref. domeny</span><b>{item.majesticDomains}</b></div>
                        <div><span>Backlinki</span><b>{item.majesticLinks}</b></div>
                      </div>
                      <div className={styles.deadline}><span>Drop / usunięcie</span><strong>{dateTime(item.deletedTime)}</strong></div>
                      <div className={styles.metaLine}><span>Archive: {item.archive || "—"}</span><span>{item.registrar || "rejestrator —"}</span></div>
                    </>
                  ) : (
                    <>
                      <div className={styles.auctionPrice}><span>Następna oferta</span><strong>{money(item.minBid ?? item.price, item.currency)}</strong></div>
                      <div className={styles.detailGrid}>
                        <div><span>Oferty</span><b>{item.bids}</b></div>
                        <div><span>Obserwuje</span><b>{item.watched}</b></div>
                        <div><span>Wizyty</span><b>{item.visits}</b></div>
                        <div><span>Catch</span><b>{item.catch ? "TAK" : "NIE"}</b></div>
                      </div>
                      <div className={styles.deadline}><span>Koniec aukcji</span><strong>{dateTime(item.endtime)}</strong></div>
                    </>
                  )}

                  <div className={styles.cardFoot}><span>Zakup automatyczny</span><b>LOCKED</b></div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <a className={styles.brand} href="/domains">Domena<span>Go</span></a>
          <p>PL Sniper · moduł Domain Radar AI</p>
          <a href="/radar">Wróć do Domain Radar →</a>
        </footer>
      </div>
    </main>
  );
}
