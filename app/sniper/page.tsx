"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import extraStyles from "./watchlist.module.css";

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
type SortKey =
  | "recommended"
  | "score"
  | "bestName"
  | "priceAsc"
  | "priceDesc"
  | "ageDesc"
  | "oldestMarket"
  | "historyStrength"
  | "seoStrength"
  | "trafficStrength"
  | "marketActivity"
  | "valueStrength"
  | "endingSoon"
  | "dropSoon"
  | "name";

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

type WatchEntry = {
  key: string;
  addedAt: number;
  lastSeenAt: number;
  initialPrice?: number;
  previousPrice?: number;
  lastPrice?: number;
  snapshot: Result;
};

const WATCH_STORAGE_KEY = "pl-sniper-watchlist-v1";

const criteria: Array<{ key: SignalKey; title: string; description: string }> = [
  { key: "name", title: "Mocna nazwa", description: "krótka, czytelna, brandowa lub komercyjna" },
  { key: "history", title: "Historia", description: "wiek i/lub realny ślad archiwalnej strony" },
  { key: "seo", title: "SEO", description: "Majestic, referring domains i backlinki" },
  { key: "traffic", title: "Ruch*", description: "pośredni ślad widoczności; nie jest to Analytics" },
  { key: "market", title: "Aktywność / pilność", description: "oferty, last minute, bliski koniec aukcji lub drop" },
  { key: "value", title: "Cena / wartość", description: "cena mieści się w założonym progu okazji" },
  { key: "safe", title: "Bez czerwonej flagi", description: "brak oczywistego trademarku lub odrzucenia" },
];

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "recommended", label: "Najlepsze ogólnie" },
  { value: "score", label: "Score — najwyższy" },
  { value: "bestName", label: "Najlepsza nazwa" },
  { value: "priceAsc", label: "Cena — najniższa" },
  { value: "priceDesc", label: "Cena — najwyższa" },
  { value: "ageDesc", label: "Wiek / historia — najstarsze" },
  { value: "oldestMarket", label: "Najdłużej na rynku — lata" },
  { value: "historyStrength", label: "Historia — najmocniejsza" },
  { value: "seoStrength", label: "SEO / autorytet — najmocniejsze" },
  { value: "trafficStrength", label: "Widoczność / ruch* — największa" },
  { value: "marketActivity", label: "Aktywność — najwięcej ofert" },
  { value: "valueStrength", label: "Cena / wartość — najlepsza okazja" },
  { value: "endingSoon", label: "Aukcje — kończące się najszybciej" },
  { value: "dropSoon", label: "DROP — najbliższy termin" },
  { value: "name", label: "Nazwa — A–Z" },
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

function timeFromMs(value?: number) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function countdown(endtime: number | undefined, nowMs: number) {
  if (!endtime) return "—";
  const seconds = Math.max(0, Math.floor(endtime - nowMs / 1000));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
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

function resultPrice(item: Result) {
  return item.type === "auction" ? item.minBid ?? item.price : undefined;
}

function resultKey(item: Result) {
  return item.type === "auction" && item.auctionId
    ? `auction:${item.auctionId}`
    : `${item.type}:${item.domainAscii.toLowerCase()}`;
}

function namePower(item: Result) {
  return item.breakdown.name + item.breakdown.commercial;
}

function historyPower(item: Result) {
  if (item.type !== "expiring") return undefined;
  return item.breakdown.authority * 100 + (item.ageYears || 0);
}

function seoPower(item: Result) {
  if (item.type !== "expiring") return undefined;
  return item.majesticQuality * 100000 + item.majesticDomains * 100 + Math.min(item.majesticLinks, 99);
}

function trafficPower(item: Result) {
  if (item.type !== "expiring") return undefined;
  return item.majesticDomains * 1000 + item.pages * 10 + Math.min(item.majesticLinks, 999);
}

function activityPower(item: Result) {
  if (item.type === "auction") return item.bids * 100 + item.breakdown.market * 10 + (item.auctionKind === "last-minute" ? 50 : 0);
  return item.breakdown.market;
}

function valuePower(item: Result) {
  const price = resultPrice(item);
  return item.breakdown.value * 100000 - (price ?? 99999);
}

function compareMissingLast(a?: number, b?: number, direction: "asc" | "desc" = "asc") {
  const aMissing = a === undefined || !Number.isFinite(a);
  const bMissing = b === undefined || !Number.isFinite(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return direction === "asc" ? a - b : b - a;
}

function watchTrend(entry: WatchEntry) {
  const current = entry.lastPrice;
  const initial = entry.initialPrice;
  if (current === undefined || initial === undefined) return { label: "brak ceny", className: extraStyles.trendFlat };
  const diff = current - initial;
  const currency = entry.snapshot.type === "auction" ? entry.snapshot.currency : "PLN";
  if (Math.abs(diff) < 0.0001) return { label: "bez zmiany", className: extraStyles.trendFlat };
  if (diff > 0) return { label: `↑ +${money(diff, currency)} od dodania`, className: extraStyles.trendUp };
  return { label: `↓ -${money(Math.abs(diff), currency)} od dodania`, className: extraStyles.trendDown };
}

export default function PlSniperPage() {
  const [status, setStatus] = useState<SniperStatus | null>(null);
  const [market, setMarket] = useState<Result[]>([]);
  const [ending, setEnding] = useState<AuctionResult[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [endingLoading, setEndingLoading] = useState(false);
  const [watchLoading, setWatchLoading] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [nextStart, setNextStart] = useState(0);
  const [scannedTotal, setScannedTotal] = useState(0);
  const [sourceTotals, setSourceTotals] = useState({ expiring: 0, auctions: 0 });
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");
  const [selected, setSelected] = useState<Result | null>(null);
  const [watched, setWatched] = useState<Record<string, WatchEntry>>({});
  const [watchReady, setWatchReady] = useState(false);
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
    try {
      const raw = window.localStorage.getItem(WATCH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, WatchEntry>;
        if (parsed && typeof parsed === "object") setWatched(parsed);
      }
    } catch {
      // Ignore corrupted local watchlist and start clean.
    } finally {
      setWatchReady(true);
    }
  }, []);

  useEffect(() => {
    if (!watchReady) return;
    try {
      window.localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(watched));
    } catch {
      // Local storage may be blocked; the current session still works.
    }
  }, [watched, watchReady]);

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

  const watchedAuctionDomains = useMemo(() => Object.values(watched)
    .filter((entry) => entry.snapshot.type === "auction")
    .map((entry) => entry.snapshot.domainAscii.toLowerCase())
    .sort()
    .join(","), [watched]);

  useEffect(() => {
    if (!status?.connected || !watchReady || !watchedAuctionDomains) return;
    void loadWatchedAuctions(true);
    const timer = window.setInterval(() => void loadWatchedAuctions(true), 60000);
    return () => window.clearInterval(timer);
  }, [status?.connected, watchReady, watchedAuctionDomains]);

  function updateWatchedSnapshots(items: Result[]) {
    if (!items.length) return;
    setWatched((previous) => {
      let changed = false;
      const next = { ...previous };
      const seenAt = Date.now();
      for (const item of items) {
        const key = resultKey(item);
        const existing = next[key];
        if (!existing) continue;
        const price = resultPrice(item);
        const priceChanged = price !== undefined && existing.lastPrice !== undefined && Math.abs(price - existing.lastPrice) > 0.0001;
        next[key] = {
          ...existing,
          previousPrice: priceChanged ? existing.lastPrice : existing.previousPrice,
          lastPrice: price ?? existing.lastPrice,
          lastSeenAt: seenAt,
          snapshot: item,
        };
        changed = true;
      }
      return changed ? next : previous;
    });
  }

  function toggleWatch(item: Result) {
    const key = resultKey(item);
    const now = Date.now();
    const price = resultPrice(item);
    setWatched((previous) => {
      if (previous[key]) {
        const next = { ...previous };
        delete next[key];
        return next;
      }
      return {
        ...previous,
        [key]: {
          key,
          addedAt: now,
          lastSeenAt: now,
          initialPrice: price,
          lastPrice: price,
          snapshot: item,
        },
      };
    });
  }

  function isWatched(item: Result) {
    return Boolean(watched[resultKey(item)]);
  }

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
      });
      const response = await fetch(`/api/sniper/scan?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as MarketResponse;
      if (!response.ok) throw new Error(payload.error || `Błąd API ${response.status}`);
      const incoming = payload.results || [];
      setMarket((previous) => append ? mergeUnique(previous, incoming) : incoming);
      updateWatchedSnapshots(incoming);
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
      const params = new URLSearchParams({ mode: "ending", limit: "80" });
      const response = await fetch(`/api/sniper/scan?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as EndingResponse;
      if (!response.ok) throw new Error(payload.error || `Błąd API ${response.status}`);
      const incoming = payload.results || [];
      setEnding(incoming);
      updateWatchedSnapshots(incoming);
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : "Nie udało się odświeżyć kończących aukcji.");
    } finally {
      if (!silent) setEndingLoading(false);
    }
  }

  async function loadWatchedAuctions(silent = false) {
    if (!watchedAuctionDomains || watchLoading) return;
    if (!silent) setWatchLoading(true);
    try {
      const params = new URLSearchParams({ mode: "watch", limit: "50", domains: watchedAuctionDomains });
      const response = await fetch(`/api/sniper/scan?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as EndingResponse;
      if (!response.ok) throw new Error(payload.error || `Błąd API ${response.status}`);
      updateWatchedSnapshots(payload.results || []);
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : "Nie udało się odświeżyć obserwowanych aukcji.");
    } finally {
      if (!silent) setWatchLoading(false);
    }
  }

  const activeKeys = useMemo(() => criteria.filter((item) => active[item.key]).map((item) => item.key), [active]);

  const visibleMarket = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = market
      .filter((item) => !query || item.domain.toLowerCase().includes(query))
      .filter((item) => activeKeys.every((key) => item.signals[key].status === "pass"));

    return [...filtered].sort((a, b) => {
      if (sortKey === "score") return b.score - a.score || b.passCount - a.passCount || a.domain.localeCompare(b.domain);
      if (sortKey === "bestName") return namePower(b) - namePower(a) || b.score - a.score;
      if (sortKey === "priceAsc") return compareMissingLast(resultPrice(a), resultPrice(b), "asc") || b.score - a.score;
      if (sortKey === "priceDesc") return compareMissingLast(resultPrice(a), resultPrice(b), "desc") || b.score - a.score;
      if (sortKey === "ageDesc" || sortKey === "oldestMarket") {
        const aAge = a.type === "expiring" ? a.ageYears : undefined;
        const bAge = b.type === "expiring" ? b.ageYears : undefined;
        return compareMissingLast(aAge, bAge, "desc") || b.score - a.score;
      }
      if (sortKey === "historyStrength") return compareMissingLast(historyPower(a), historyPower(b), "desc") || b.score - a.score;
      if (sortKey === "seoStrength") return compareMissingLast(seoPower(a), seoPower(b), "desc") || b.score - a.score;
      if (sortKey === "trafficStrength") return compareMissingLast(trafficPower(a), trafficPower(b), "desc") || b.score - a.score;
      if (sortKey === "marketActivity") return activityPower(b) - activityPower(a) || b.score - a.score;
      if (sortKey === "valueStrength") return valuePower(b) - valuePower(a) || compareMissingLast(resultPrice(a), resultPrice(b), "asc");
      if (sortKey === "endingSoon") {
        const aEnd = a.type === "auction" ? a.endtime : undefined;
        const bEnd = b.type === "auction" ? b.endtime : undefined;
        return compareMissingLast(aEnd, bEnd, "asc") || b.score - a.score;
      }
      if (sortKey === "dropSoon") {
        const aDrop = a.type === "expiring" ? a.deletedTime : undefined;
        const bDrop = b.type === "expiring" ? b.deletedTime : undefined;
        return compareMissingLast(aDrop, bDrop, "asc") || b.score - a.score;
      }
      if (sortKey === "name") return a.domain.localeCompare(b.domain, "pl");
      return b.passCount - a.passCount || b.score - a.score || a.domain.localeCompare(b.domain);
    });
  }, [market, activeKeys, search, sortKey]);

  const liveEnding = useMemo(() => ending.filter((item) => (item.endtime || 0) > nowMs / 1000), [ending, nowMs]);
  const watchedEntries = useMemo(() => Object.values(watched).sort((a, b) => {
    const aEnd = a.snapshot.type === "auction" ? a.snapshot.endtime : a.snapshot.deletedTime;
    const bEnd = b.snapshot.type === "auction" ? b.snapshot.endtime : b.snapshot.deletedTime;
    return compareMissingLast(aEnd, bEnd, "asc") || b.addedAt - a.addedAt;
  }), [watched]);
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
          <p>Spadające domeny, aukcje, last minute, caught i tanie oferty trafiają do jednej puli. Przeglądasz ją jak giełdę: widzisz cenę, termin, historię i sygnały jakości, sortujesz po tym, co jest dla Ciebie najważniejsze, a wybrane domeny zapisujesz do obserwowanych.</p>
          <div className={styles.statusStrip}>
            <span className={status?.connected ? styles.ok : styles.off}>● {status?.connected ? "AfterMarket API połączone" : "AfterMarket API niepodłączone"}</span>
            <span className={status?.executionEnabled ? styles.warn : styles.safe}>● AUTO BUY {status?.executionEnabled ? "ARMED" : "LOCKED"}</span>
            <span>Ostatni skan: {lastRun || "—"}</span>
            <span>Obserwowane: {watchedEntries.length}</span>
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
              <p>Pełna przewijalna lista. Odliczanie działa co sekundę; gdy aukcja dojdzie do zera, znika, a kolejne przesuwają się wyżej.</p>
            </div>
            <button className={styles.secondaryButton} onClick={() => void loadEnding(false)} disabled={endingLoading || status?.connected === false}>{endingLoading ? "Odświeżam…" : "Odśwież teraz"}</button>
          </div>
          <div className={`${styles.liveRail} ${extraStyles.liveRailScroll}`}>
            {liveEnding.length ? liveEnding.map((item) => (
              <div className={`${styles.liveCard} ${extraStyles.liveListCard}`} key={`live-${item.auctionId}-${item.domainAscii}`}>
                <button className={extraStyles.liveOpen} onClick={() => setSelected(item)}>
                  <div className={extraStyles.liveIdentity}><span>{item.source}</span><strong>{item.domain}</strong></div>
                  <div className={extraStyles.liveScore}><b>{item.score}</b></div>
                  <div className={extraStyles.liveCountdown}>{countdown(item.endtime, nowMs)}</div>
                  <div className={extraStyles.livePrice}><strong>{money(item.minBid ?? item.price, item.currency)}</strong><span>{item.bids} ofert</span></div>
                </button>
                <button
                  className={isWatched(item) ? extraStyles.watchIconActive : extraStyles.watchIcon}
                  onClick={() => toggleWatch(item)}
                  title={isWatched(item) ? "Usuń z obserwowanych" : "Dodaj do obserwowanych"}
                >{isWatched(item) ? "★" : "☆"}</button>
              </div>
            )) : <div className={styles.liveEmpty}>Brak aktywnych aukcji w aktualnie pobranej paczce.</div>}
          </div>
        </section>

        <section className={extraStyles.watchSection}>
          <div className={extraStyles.watchHead}>
            <div>
              <span>OBSERWOWANE <b className={extraStyles.watchBadge}>{watchedEntries.length}</b></span>
              <h2>Twoje zapamiętane domeny</h2>
              <p>Cena i stan aukcji aktualizują się automatycznie. Lista jest zachowana w tej przeglądarce, więc nie musisz prowadzić osobnego notesu.</p>
            </div>
            <button className={extraStyles.watchRefresh} onClick={() => void loadWatchedAuctions(false)} disabled={!watchedAuctionDomains || watchLoading || status?.connected === false}>{watchLoading ? "Aktualizuję…" : "Odśwież obserwowane"}</button>
          </div>
          {!watchedEntries.length ? (
            <div className={extraStyles.watchEmpty}>Kliknij ☆ przy dowolnej domenie albo aukcji. Pojawi się tutaj i zostanie zapamiętana.</div>
          ) : (
            <div className={extraStyles.watchList}>
              {watchedEntries.map((entry) => {
                const item = entry.snapshot;
                const trend = watchTrend(entry);
                const deadline = item.type === "auction" ? item.endtime : item.deletedTime;
                const ended = deadline !== undefined && deadline <= nowMs / 1000;
                return (
                  <div className={extraStyles.watchRow} key={entry.key}>
                    <button className={extraStyles.watchMain} onClick={() => setSelected(item)}>
                      <div className={extraStyles.watchIdentity}><strong>{item.domain}</strong><span>{item.source}</span></div>
                      <div className={extraStyles.watchMetric}><span>Cena teraz</span><strong>{item.type === "auction" ? money(entry.lastPrice, item.currency) : "DROP"}</strong></div>
                      <div className={extraStyles.watchMetric}><span>Zmiana</span><strong className={trend.className}>{trend.label}</strong></div>
                      <div className={extraStyles.watchMetric}><span>{ended ? "Status" : "Koniec / DROP"}</span><strong>{ended ? "ZAKOŃCZONA" : countdown(deadline, nowMs)}</strong><span>akt. {timeFromMs(entry.lastSeenAt)}</span></div>
                    </button>
                    <button className={extraStyles.removeWatch} onClick={() => toggleWatch(item)} title="Usuń z obserwowanych">×</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={styles.workbench}>
          <div className={styles.workbenchHead}>
            <div>
              <span>SZEROKI SKAN</span>
              <h2>Rynek domen .pl</h2>
              <p>Jedna wspólna lista bez przełączania źródeł. Niczego nie musisz filtrować — możesz po prostu przeglądać oferty i ustawić kolejność, która Cię interesuje.</p>
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
              <div><span>MOCNY RESEARCH</span><h3>Włączaj kolejne warunki tylko wtedy, gdy chcesz zawęzić listę.</h3></div>
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

            <div className={styles.marketToolbar}>
              <div className={styles.searchBox}>
                <span>SZUKAJ</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="np. hotel.pl, auto, zdrowie…" />
              </div>
              <label className={styles.sortBox}>
                <span>SORTUJ WEDŁUG</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                  {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className={styles.activeSummary}>
                <span>AKTYWNE WARUNKI</span>
                <strong>{activeKeys.length}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.resultsSection}>
          <div className={styles.sectionHead}>
            <div><span>WYNIKI</span><h2>{activeKeys.length ? "Kandydaci po Mocnym Researchu" : "Pełna pobrana pula"}</h2></div>
            <small>Zielony = spełnia · czerwony = nie spełnia · szary = brak danych · ☆ = obserwuj</small>
          </div>

          {!visibleMarket.length && !marketLoading ? (
            <div className={styles.empty}><strong>Żaden rekord nie spełnia aktualnego zestawu warunków.</strong><span>Wyłącz jeden z filtrów albo doładuj kolejną partię rynku.</span></div>
          ) : (
            <div className={styles.tableWrap}>
              <div className={styles.tableHeader}>
                <span>#</span><span>Domena / źródło</span><span>Score</span><span>Cena</span><span>Koniec / DROP</span><span>Warunki</span><span>Obserwuj</span>
              </div>
              {visibleMarket.map((item, index) => (
                <div
                  className={styles.resultRow}
                  key={`${item.type}-${item.domainAscii}-${item.type === "auction" ? item.auctionId : index}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelected(item);
                  }}
                >
                  <span className={styles.rank}>#{index + 1}</span>
                  <div className={styles.domainCell}>
                    <strong>{item.domain}</strong>
                    <span>{item.source}</span>
                    {item.type === "expiring" && item.ageYears !== undefined ? <small>{item.ageYears} lat historii rejestracji</small> : null}
                  </div>
                  <div className={styles.scoreCell}><strong>{item.score}</strong><span>{item.tier}</span></div>
                  <div className={styles.priceCell}>
                    {item.type === "auction" ? <><strong>{money(item.minBid ?? item.price, item.currency)}</strong><span>{item.bids} ofert</span></> : <><strong>—</strong><span>DROP bez ceny aukcyjnej</span></>}
                  </div>
                  <div className={styles.deadlineCell}>
                    {item.type === "auction" ? <><strong>{dateTime(item.endtime)}</strong><span>Zostało {countdown(item.endtime, nowMs)}</span></> : <><strong>{dateTime(item.deletedTime)}</strong><span>Planowany DROP</span></>}
                  </div>
                  <div className={styles.signalGrid}>
                    {criteria.map((criterion) => {
                      const sig = item.signals[criterion.key];
                      return <span key={criterion.key} className={signalClass(sig.status)} title={sig.detail}>{sig.status === "pass" ? "✓" : sig.status === "fail" ? "✕" : "?"} {criterion.title}</span>;
                    })}
                  </div>
                  <div className={extraStyles.rowActions}>
                    <button
                      className={isWatched(item) ? extraStyles.rowWatchActive : extraStyles.rowWatch}
                      onClick={(event) => { event.stopPropagation(); toggleWatch(item); }}
                      title={isWatched(item) ? "Usuń z obserwowanych" : "Dodaj do obserwowanych"}
                    >{isWatched(item) ? "★" : "☆"}</button>
                    <span className={extraStyles.rowArrow}>→</span>
                  </div>
                </div>
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
              <div className={extraStyles.drawerActions}>
                <button className={isWatched(selected) ? extraStyles.drawerWatchActive : extraStyles.drawerWatch} onClick={() => toggleWatch(selected)}>{isWatched(selected) ? "★ Obserwujesz" : "☆ Obserwuj"}</button>
                <button className={extraStyles.drawerClose} onClick={() => setSelected(null)}>×</button>
              </div>
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
