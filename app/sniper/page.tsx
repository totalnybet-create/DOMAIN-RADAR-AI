"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type SniperStatus = {
  connected: boolean;
  executionEnabled: boolean;
  provider: string;
  limits: { minScore: number; maxDomainPrice: number; maxDailyBudget: number };
};

type SignalStatus = "pass" | "fail" | "unknown";
type Signal = { status: SignalStatus; label: string; detail: string };
type SignalKey = "name" | "history" | "seo" | "traffic" | "market" | "value" | "safe";
type Signals = Record<SignalKey, Signal>;
type Breakdown = { name: number; commercial: number; authority: number; market: number; value: number; penalties: number };

type BaseResult = {
  type: "expiring" | "auction";
  source: string;
  domain: string;
  domainAscii: string;
  score: number;
  tier: string;
  reasons: string[];
  breakdown: Breakdown;
  trademarkRisk: boolean;
  rejectedReason?: string;
  signals: Signals;
  passCount: number;
};

type ExpiringResult = BaseResult & {
  type: "expiring";
  length: number;
  ageYears?: number;
  archive?: string;
  created?: string;
  createdTime?: number;
  deleted?: string;
  deletedTime?: number;
  expires?: string;
  expiresTime?: number;
  majesticQuality: number;
  majesticDomains: number;
  majesticLinks: number;
  pages: number;
  registrar?: string;
  future: boolean;
  premium: boolean;
};

type AuctionResult = BaseResult & {
  type: "auction";
  auctionId: number;
  auctionKind?: "auction" | "last-minute" | "caught" | "cheap";
  price?: number;
  minBid?: number;
  priceBuyNow?: number;
  currency: string;
  bids: number;
  endtime?: number;
  catch: boolean;
  featured: boolean;
  homepage: boolean;
};

type Result = ExpiringResult | AuctionResult;

type MarketResponse = {
  connected?: boolean;
  scanned?: number;
  scanStart?: number;
  nextStart?: number;
  sourceCounts?: { expiring: number; auctions: number };
  warnings?: string[];
  results?: Result[];
  error?: string;
};

type EndingResponse = {
  returned?: number;
  results?: AuctionResult[];
  error?: string;
};

const criteria: Array<{ key: SignalKey; title: string; description: string }> = [
  { key: "name", title: "Mocna nazwa", description: "krótka, czytelna, brandowa lub komercyjna" },
  { key: "history", title: "Historia", description: "wiek i/lub realny ślad archiwalnej strony" },
  { key: "seo", title: "SEO", description: "Majestic, referring domains i backlinki" },
  { key: "traffic", title: "Ruch*", description: "pośredni ślad widoczności; nie jest to Analytics" },
  { key: "market", title: "Rynek", description: "oferty, pilność, drop lub kończąca się aukcja" },
  { key: "value", title: "Cena / wartość", description: "cena mieści się w założonym progu okazji" },
  { key: "safe", title: "Bez czerwonej flagi", description: "brak oczywistego trademarku lub odrzucenia" },
];

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
  return new Date(value * 1000).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "medium" });
}

function countdown(endtime: number | undefined, nowMs: number) {
  if (!endtime) return "—";
  const seconds = Math.max(0, Math.floor(endtime - nowMs / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function signalClass(status: SignalStatus) {
  if (status === "pass") return styles.signalPass;
  if (status === "fail") return styles.signalFail;
  return styles.signalUnknown;
}

function mergeUnique(existing: Result[], incoming: Result[]) {
  const merged = new Map(existing.map((item) => [item.domainAscii.toLowerCase(), item]));
  for (const item of incoming) {
    const key = item.domainAscii.toLowerCase();
    const previous = merged.get(key);
    if (!previous || item.passCount > previous.passCount || (item.passCount === previous.passCount && item.score > previous.score)) merged.set(key, item);
  }
  return [...merged.values()];
}

export default function PlSniperPage() {
  const [status, setStatus] = useState<SniperStatus | null>(null);
  const [market, setMarket] = useState<Result[]>([]);
  const [ending, setEnding] = useState<AuctionResult[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [endingLoading, setEndingLoading] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [nextStart, setNextStart] = useState(0);
  const [scannedTotal, setScannedTotal] = useState(0);
  const [sourceTotals, setSourceTotals] = useState({ expiring: 0, auctions: 0 });
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Result | null>(null);
  const [active, setActive] = useState<Record<SignalKey, boolean>>({
    name: false,
    history: false,
    seo: false,
    traffic: false,
    market: false,
    value: false,
    safe: false,
  });

  useEffect(() => {
    fetch("/api/sniper/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: SniperStatus) => setStatus(payload))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status?.connected || bootstrapped) return;
    setBootstrapped(true);
    void loadMarket(0, false);
    void loadEnding(true);
  }, [status?.connected, bootstrapped]);

  useEffect(() => {
    if (!status?.connected) return;
    const timer = window.setInterval(() => void loadEnding(true), 10000);
    return () => window.clearInterval(timer);
  }, [status?.connected]);

  async function loadMarket(start = 0, append = false) {
    if (marketLoading) return;
    setMarketLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        mode: "market",
        start: String(start),
        limit: "1000",
        maxLength: "24",
        maxPrice: "100000",
      });
      const response = await fetch(`/api/sniper/scan?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as MarketResponse;
      if (!response.ok) throw new Error(payload.error || `Błąd API ${response.status}`);
      const incoming = payload.results || [];
      setMarket((previous) => append ? mergeUnique(previous, incoming) : incoming);
      setNextStart(payload.nextStart || 0);
      setScannedTotal((previous) => append ? previous + (payload.scanned || 0) : (payload.scanned || 0));
      setSourceTotals((previous) => append
        ? { expiring: previous.expiring + (payload.sourceCounts?.expiring || 0), auctions: previous.auctions + (payload.sourceCounts?.auctions || 0) }
        : { expiring: payload.sourceCounts?.expiring || 0, auctions: payload.sourceCounts?.auctions || 0 });
      setWarning(payload.warnings?.join(" · ") || "");
      setLastRun(new Date().toLocaleTimeString("pl-PL"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się pobrać rynku.");
    } finally {
      setMarketLoading(false);
    }
  }

  async function loadEnding(silent = false) {
    if (endingLoading) return;
    if (!silent) setEndingLoading(true);
    try {
      const params = new URLSearchParams({ mode: "ending", limit: "80", maxPrice: "100000" });
      const response = await fetch(`/api/sniper/scan?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as EndingResponse;
      if (!response.ok) throw new Error(payload.error || `Błąd API ${response.status}`);
      setEnding(payload.results || []);
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : "Nie udało się odświeżyć kończących aukcji.");
    } finally {
      if (!silent) setEndingLoading(false);
    }
  }

  const activeKeys = useMemo(() => criteria.filter((item) => active[item.key]).map((item) => item.key), [active]);

  const visibleMarket = useMemo(() => {
    const query = search.trim().toLowerCase();
    return market
      .filter((item) => !query || item.domain.toLowerCase().includes(query))
      .filter((item) => activeKeys.every((key) => item.signals[key].status === "pass"))
      .sort((a, b) => b.passCount - a.passCount || b.score - a.score || a.domain.localeCompare(b.domain));
  }, [market, activeKeys, search]);

  const liveEnding = useMemo(() => ending.filter((item) => (item.endtime || 0) > nowMs / 1000).slice(0, 8), [ending, nowMs]);
  const topScore = useMemo(() => visibleMarket.reduce((best, item) => Math.max(best, item.score), 0), [visibleMarket]);

  function toggleCriterion(key: SignalKey) {
    setActive((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  function clearResearch() {
    setActive({ name: false, history: false, seo: false, traffic: false, market: false, value: false, safe: false });
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
          <div className={styles.heroBadge}>PL SNAJPER · MARKET WORKBENCH</div>
          <h1>Cały rynek.<br/><span>Jeden ekran.</span></h1>
          <p>Spadające domeny, aukcje, last minute, caught i tanie oferty trafiają do jednej puli. Najpierw widzisz szeroki rynek, potem Mocnym Researchem odsiewasz go aż zostają najlepsze kandydatury.</p>
          <div className={styles.statusStrip}>
            <span className={status?.connected ? styles.ok : styles.off}>● {status?.connected ? "AfterMarket API połączone" : "AfterMarket API niepodłączone"}</span>
            <span className={status?.executionEnabled ? styles.warn : styles.safe}>● AUTO BUY {status?.executionEnabled ? "ARMED" : "LOCKED"}</span>
            <span>Ostatni skan: {lastRun || "—"}</span>
          </div>
        </section>

        {status?.connected === false && (
          <div className={styles.notice}><strong>Brak aktywnego połączenia AfterMarket w tej sesji.</strong><span>Połącz konto na stronie połączeń, a workbench sam rozpocznie szeroki skan.</span></div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        {warning && <div className={styles.warning}>{warning}</div>}

        <section className={styles.liveSection}>
          <div className={styles.liveHead}>
            <div>
              <span className={styles.liveEyebrow}><i/> NA ŻYWO · ODŚWIEŻANIE CO 10 S</span>
              <h2>Kończące się aukcje</h2>
              <p>Odliczanie działa co sekundę. Po dojściu do zera aukcja znika z widoku, a następna przesuwa się na jej miejsce.</p>
            </div>
            <button className={styles.secondaryButton} onClick={() => void loadEnding(false)} disabled={endingLoading || status?.connected === false}>{endingLoading ? "Odświeżam…" : "Odśwież teraz"}</button>
          </div>
          <div className={styles.liveRail}>
            {liveEnding.length ? liveEnding.map((item) => (
              <button className={styles.liveCard} key={`live-${item.auctionId}-${item.domainAscii}`} onClick={() => setSelected(item)}>
                <div className={styles.liveCardTop}><span>{item.source}</span><b>{item.score}</b></div>
                <strong>{item.domain}</strong>
                <div className={styles.countdown}>{countdown(item.endtime, nowMs)}</div>
                <div className={styles.liveMeta}><span>{money(item.minBid ?? item.price, item.currency)}</span><span>{item.bids} ofert</span></div>
              </button>
            )) : <div className={styles.liveEmpty}>Brak aktywnych aukcji w aktualnie pobranej paczce.</div>}
          </div>
        </section>

        <section className={styles.workbench}>
          <div className={styles.workbenchHead}>
            <div>
              <span>SZEROKI SKAN</span>
              <h2>Rynek domen .pl</h2>
              <p>Bez przełączania źródeł. Wyniki są sortowane najpierw po liczbie spełnionych warunków, potem po score.</p>
            </div>
            <div className={styles.actionGroup}>
              <button className={styles.secondaryButton} onClick={() => void loadMarket(0, false)} disabled={marketLoading || status?.connected === false}>{marketLoading ? "Skanuję…" : "Odśwież rynek"}</button>
              <button className={styles.primaryButton} onClick={() => void loadMarket(nextStart, true)} disabled={marketLoading || status?.connected === false || !nextStart}>{marketLoading ? "Skanuję…" : "Doładuj kolejną partię"}</button>
            </div>
          </div>

          <div className={styles.metrics}>
            <div><span>Przeskanowano</span><strong>{scannedTotal}</strong></div>
            <div><span>W puli</span><strong>{market.length}</strong></div>
            <div><span>Po Researchu</span><strong>{visibleMarket.length}</strong></div>
            <div><span>Najwyższy score</span><strong>{topScore || "—"}</strong></div>
            <div><span>DROP</span><strong>{sourceTotals.expiring}</strong></div>
            <div><span>Aukcje / LM</span><strong>{sourceTotals.auctions}</strong></div>
          </div>

          <div className={styles.researchPanel}>
            <div className={styles.researchTitle}>
              <div><span>MOCNY RESEARCH</span><h3>Włączaj kolejne warunki i obserwuj, jak pula się zawęża.</h3></div>
              <button onClick={clearResearch}>Wyczyść filtry</button>
            </div>
            <div className={styles.criteriaGrid}>
              {criteria.map((criterion) => {
                const pass = market.filter((item) => item.signals[criterion.key].status === "pass").length;
                return (
                  <button key={criterion.key} className={active[criterion.key] ? styles.criterionActive : styles.criterion} onClick={() => toggleCriterion(criterion.key)}>
                    <div><span>{active[criterion.key] ? "✓ WŁĄCZONY" : "DODAJ WARUNEK"}</span><strong>{criterion.title}</strong></div>
                    <p>{criterion.description}</p>
                    <em>{pass}/{market.length || 0} spełnia</em>
                  </button>
                );
              })}
            </div>
            <div className={styles.searchRow}>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj konkretnej domeny w pobranej puli…" />
              <span>Aktywne warunki: <b>{activeKeys.length}</b></span>
            </div>
          </div>
        </section>

        <section className={styles.resultsSection}>
          <div className={styles.sectionHead}>
            <div><span>WYNIKI</span><h2>{activeKeys.length ? "Kandydaci po Mocnym Researchu" : "Pełna pobrana pula"}</h2></div>
            <small>Zielony = spełnia · czerwony = nie spełnia · szary = brak danych</small>
          </div>

          {!visibleMarket.length && !marketLoading ? (
            <div className={styles.empty}><strong>Żaden rekord nie spełnia aktualnego zestawu warunków.</strong><span>Wyłącz jeden z filtrów albo doładuj kolejną partię rynku.</span></div>
          ) : (
            <div className={styles.tableWrap}>
              <div className={styles.tableHeader}>
                <span>#</span><span>Domena / źródło</span><span>Score</span><span>Warunki</span><span>Najważniejsze dane</span><span/>
              </div>
              {visibleMarket.map((item, index) => (
                <button className={styles.resultRow} key={`${item.type}-${item.domainAscii}-${item.type === "auction" ? item.auctionId : index}`} onClick={() => setSelected(item)}>
                  <span className={styles.rank}>#{index + 1}</span>
                  <div className={styles.domainCell}><strong>{item.domain}</strong><span>{item.source}</span></div>
                  <div className={styles.scoreCell}><strong>{item.score}</strong><span>{item.tier}</span></div>
                  <div className={styles.signalGrid}>
                    {criteria.map((criterion) => {
                      const sig = item.signals[criterion.key];
                      return <span key={criterion.key} className={signalClass(sig.status)} title={sig.detail}>{sig.status === "pass" ? "✓" : sig.status === "fail" ? "✕" : "?"} {criterion.title}</span>;
                    })}
                  </div>
                  <div className={styles.primaryData}>
                    {item.type === "expiring" ? (
                      <><span>Wiek <b>{item.ageYears !== undefined ? `${item.ageYears} lat` : "—"}</b></span><span>TF <b>{item.majesticQuality}</b></span><span>Ref <b>{item.majesticDomains}</b></span><span>Drop <b>{dateTime(item.deletedTime)}</b></span></>
                    ) : (
                      <><span>Cena <b>{money(item.minBid ?? item.price, item.currency)}</b></span><span>Oferty <b>{item.bids}</b></span><span>Koniec <b>{item.endtime ? countdown(item.endtime, nowMs) : "—"}</b></span></>
                    )}
                  </div>
                  <span className={styles.openDetails}>Szczegóły →</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <a className={styles.brand} href="/domains">Domena<span>Go</span></a>
          <p>PL Sniper · Domain Radar AI · AUTO BUY LOCKED</p>
          <a href="/radar">Wróć do Domain Radar →</a>
        </footer>
      </div>

      {selected && (
        <div className={styles.modalBackdrop} onMouseDown={() => setSelected(null)}>
          <aside className={styles.detailDrawer} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.drawerHead}>
              <div><span>{selected.source}</span><h2>{selected.domain}</h2><p>{selected.tier} · SCORE {selected.score}</p></div>
              <button onClick={() => setSelected(null)}>×</button>
            </div>

            <div className={styles.drawerSignals}>
              {criteria.map((criterion) => {
                const sig = selected.signals[criterion.key];
                return <div key={criterion.key} className={signalClass(sig.status)}><strong>{sig.status === "pass" ? "✓" : sig.status === "fail" ? "✕" : "?"} {criterion.title}</strong><span>{sig.detail}</span></div>;
              })}
            </div>

            <section className={styles.drawerSection}>
              <span>DLACZEGO TAKI SCORE</span>
              <div className={styles.reasonList}>{selected.reasons.length ? selected.reasons.map((reason) => <b key={reason}>{reason}</b>) : <b>brak dodatkowych powodów</b>}</div>
            </section>

            <section className={styles.drawerSection}>
              <span>ROZBICIE PUNKTÓW</span>
              <div className={styles.breakdownGrid}>
                <div><span>Nazwa</span><b>{selected.breakdown.name}</b></div>
                <div><span>Komercyjność</span><b>{selected.breakdown.commercial}</b></div>
                <div><span>Autorytet</span><b>{selected.breakdown.authority}</b></div>
                <div><span>Rynek</span><b>{selected.breakdown.market}</b></div>
                <div><span>Wartość</span><b>{selected.breakdown.value}</b></div>
                <div><span>Kary</span><b>{selected.breakdown.penalties}</b></div>
              </div>
            </section>

            {selected.type === "expiring" ? (
              <section className={styles.drawerSection}>
                <span>PEŁNE DANE DROP</span>
                <div className={styles.factGrid}>
                  <div><span>Wiek</span><b>{selected.ageYears !== undefined ? `${selected.ageYears} lat` : "—"}</b></div>
                  <div><span>Archive</span><b>{selected.archive || "—"}</b></div>
                  <div><span>Utworzona</span><b>{selected.created || "—"}</b></div>
                  <div><span>Wygasa</span><b>{selected.expires || "—"}</b></div>
                  <div><span>Drop</span><b>{dateTime(selected.deletedTime)}</b></div>
                  <div><span>Rejestrator</span><b>{selected.registrar || "—"}</b></div>
                  <div><span>Trust Flow</span><b>{selected.majesticQuality}</b></div>
                  <div><span>Ref. domeny</span><b>{selected.majesticDomains}</b></div>
                  <div><span>Backlinki</span><b>{selected.majesticLinks}</b></div>
                  <div><span>Strony</span><b>{selected.pages}</b></div>
                  <div><span>Premium</span><b>{selected.premium ? "TAK" : "NIE"}</b></div>
                  <div><span>Opcja future</span><b>{selected.future ? "TAK" : "NIE"}</b></div>
                </div>
              </section>
            ) : (
              <section className={styles.drawerSection}>
                <span>PEŁNE DANE AUKCJI</span>
                <div className={styles.factGrid}>
                  <div><span>ID aukcji</span><b>{selected.auctionId}</b></div>
                  <div><span>Typ</span><b>{selected.auctionKind || "aukcja"}</b></div>
                  <div><span>Aktualna cena</span><b>{money(selected.price, selected.currency)}</b></div>
                  <div><span>Następna oferta</span><b>{money(selected.minBid, selected.currency)}</b></div>
                  <div><span>Kup teraz</span><b>{money(selected.priceBuyNow, selected.currency)}</b></div>
                  <div><span>Liczba ofert</span><b>{selected.bids}</b></div>
                  <div><span>Koniec</span><b>{dateTime(selected.endtime)}</b></div>
                  <div><span>Zostało</span><b>{countdown(selected.endtime, nowMs)}</b></div>
                  <div><span>Caught</span><b>{selected.catch ? "TAK" : "NIE"}</b></div>
                  <div><span>Featured</span><b>{selected.featured ? "TAK" : "NIE"}</b></div>
                  <div><span>Homepage</span><b>{selected.homepage ? "TAK" : "NIE"}</b></div>
                </div>
              </section>
            )}

            <div className={styles.drawerNote}>* „Ruch” oznacza tylko dostępny sygnał pośredni z danych domeny. Bez dostępu do historycznego Analytics/Search Console nie podajemy zmyślonej liczby wejść.</div>
          </aside>
        </div>
      )}
    </main>
  );
}
