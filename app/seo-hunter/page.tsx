"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type ProviderStatus = {
  ahrefs: boolean;
  semrush: boolean;
  dataForSeo: boolean;
  majestic: boolean;
  similarweb: boolean;
  googleAds: boolean;
};

type MarketCandidate = {
  domain?: string;
  domainAscii?: string;
  source?: string;
  type?: string;
  score?: number;
  ageYears?: number;
  majesticQuality?: number;
  majesticDomains?: number;
  majesticLinks?: number;
  pages?: number;
  archive?: string;
  price?: number;
  minBid?: number;
  currency?: string;
};

type HunterResult = MarketCandidate & {
  domain: string;
  recognition: number;
  confidence: number;
  spamRisk: number;
  verdict: "STRONG BUY" | "WATCH" | "REVIEW" | "SKIP";
  history: { ok: boolean; captures: number; firstYear?: number; lastYear?: number; spanYears: number; error?: string };
  crawl: { ok: boolean; urls: number; index?: string; error?: string };
  breakdown: { authority: number; history: number; footprint: number; market: number; persistence: number };
};

type MarketResponse = { connected?: boolean; scanned?: number; results?: MarketCandidate[]; warnings?: string[]; error?: string };
type EnrichResponse = { providers?: ProviderStatus; analyzed?: number; results?: HunterResult[]; error?: string };

const providerLabels: Array<[keyof ProviderStatus, string]> = [
  ["ahrefs", "Ahrefs"],
  ["semrush", "Semrush"],
  ["dataForSeo", "DataForSEO"],
  ["majestic", "Majestic API"],
  ["similarweb", "Similarweb"],
  ["googleAds", "Google Ads"],
];

function seedPower(item: MarketCandidate) {
  return (item.majesticQuality || 0) * 5 + Math.log2((item.majesticDomains || 0) + 1) * 14 + Math.log2((item.majesticLinks || 0) + 1) * 3 + (item.ageYears || 0) * 3 + Math.log2((item.pages || 0) + 1) * 5 + (item.score || 0) * 0.35;
}

function compactNumber(value?: number) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("pl-PL", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function money(value?: number, currency = "PLN") {
  if (value === undefined) return "—";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export default function SeoHunterPage() {
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [results, setResults] = useState<HunterResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("Gotowy");
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(0);
  const [minScore, setMinScore] = useState(55);

  useEffect(() => {
    fetch("/api/seo-hunter/enrich", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { providers?: ProviderStatus }) => setProviders(payload.providers || null))
      .catch(() => setProviders(null));
  }, []);

  const visible = useMemo(() => results.filter((item) => item.recognition >= minScore), [results, minScore]);
  const strong = useMemo(() => results.filter((item) => item.verdict === "STRONG BUY").length, [results]);

  async function scan() {
    if (loading) return;
    setLoading(true);
    setError("");
    setResults([]);
    setStage("Pobieram domeny z rynku AfterMarket…");
    try {
      const marketResponse = await fetch("/api/sniper/scan?mode=market&limit=500&maxLength=30", { cache: "no-store" });
      const market = await marketResponse.json() as MarketResponse;
      if (!marketResponse.ok || !market.results?.length) throw new Error(market.error || "AfterMarket nie zwrócił kandydatów.");
      setScanned(market.scanned || market.results.length);

      const candidates = [...market.results]
        .filter((item) => Boolean(item.domainAscii || item.domain))
        .sort((a, b) => seedPower(b) - seedPower(a))
        .slice(0, 30);

      setStage(`Weryfikuję historię i ślad sieciowy ${candidates.length} najmocniejszych domen…`);
      const enrichResponse = await fetch("/api/seo-hunter/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates }),
      });
      const enriched = await enrichResponse.json() as EnrichResponse;
      if (!enrichResponse.ok) throw new Error(enriched.error || "Nie udało się wzbogacić danych SEO.");
      setProviders(enriched.providers || providers);
      setResults(enriched.results || []);
      setStage(`Gotowe — zweryfikowano ${enriched.analyzed || 0} domen.`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Błąd SEO Huntera.");
      setStage("Błąd skanowania");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <nav className={styles.nav}>
          <a className={styles.brand} href="/">Domena<span>Go</span></a>
          <div className={styles.navLinks}>
            <a href="/radar">Radar</a>
            <a href="/sniper">Sniper</a>
            <a className={styles.activeLink} href="/seo-hunter">SEO Hunter</a>
          </div>
          <a className={styles.navCta} href="/connections/aftermarket">Połącz źródła</a>
        </nav>

        <header className={styles.hero}>
          <div className={styles.heroBadge}>AGED DOMAIN · WEB RECOGNITION · SEO INTELLIGENCE</div>
          <h1>SEO <span>Authority Hunter</span></h1>
          <p>Wyłapuje stare domeny wracające na rynek i ocenia ich realny ślad w sieci. Priorytet: historia, autorytet linków, wieloletnia obecność, crawl footprint i niski profil spamu.</p>
          <div className={styles.sourceStrip}>
            <span className={styles.ok}>AfterMarket / Majestic feed</span>
            <span className={styles.ok}>Wayback Machine</span>
            <span className={styles.ok}>Common Crawl</span>
            <span className={styles.info}>Google visibility: adaptery rozszerzające</span>
          </div>
        </header>

        <section className={styles.controlPanel}>
          <div className={styles.controlHead}>
            <div>
              <span>SKAN RYNKU</span>
              <h2>Znajdź domeny z historią, nie tylko ładną nazwą</h2>
              <p>Najpierw przeglądamy szeroki rynek, potem kosztowniejszą weryfikację uruchamiamy tylko dla 30 najmocniejszych kandydatów.</p>
            </div>
            <button className={styles.primaryButton} onClick={scan} disabled={loading}>{loading ? "Analizuję…" : "Uruchom SEO Hunter"}</button>
          </div>

          <div className={styles.metrics}>
            <div><span>Przeskanowane</span><strong>{scanned}</strong></div>
            <div><span>Zweryfikowane</span><strong>{results.length}</strong></div>
            <div><span>Strong Buy</span><strong>{strong}</strong></div>
            <div><span>Widoczne ≥ {minScore}</span><strong>{visible.length}</strong></div>
          </div>

          <div className={styles.progressLine}><span className={loading ? styles.pulse : ""}>{stage}</span><label>Próg wyniku <strong>{minScore}</strong><input type="range" min="30" max="85" step="5" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} /></label></div>
          {error && <div className={styles.error}>{error}</div>}
        </section>

        <section className={styles.providers}>
          <div className={styles.sectionHead}><div><span>WARSTWA GOOGLE / SEO</span><h2>Źródła premium</h2></div><small>Aktywują się po dodaniu klucza — brak klucza nie fałszuje wyniku.</small></div>
          <div className={styles.providerGrid}>
            {providerLabels.map(([key, label]) => <div key={key} className={providers?.[key] ? styles.providerOn : styles.providerOff}><strong>{label}</strong><span>{providers?.[key] ? "GOTOWY" : "BRAK KLUCZA"}</span></div>)}
          </div>
        </section>

        <section className={styles.resultsSection}>
          <div className={styles.sectionHead}><div><span>WEB RECOGNITION SCORE</span><h2>Najmocniejsze stare domeny</h2></div><small>{visible.length} wyników po filtrze</small></div>
          {visible.length === 0 ? <div className={styles.empty}><strong>Uruchom skan.</strong><span>Tutaj pojawią się domeny zweryfikowane przez kilka niezależnych warstw danych.</span></div> : (
            <div className={styles.tableWrap}>
              <div className={styles.tableHeader}><span>Domena</span><span>Recognition</span><span>Historia</span><span>Autorytet</span><span>Footprint</span><span>Ryzyko</span><span>Werdykt</span></div>
              {visible.map((item) => (
                <article className={styles.resultRow} key={item.domain}>
                  <div className={styles.domainCell}><strong>{item.domain}</strong><span>{item.source || item.type || "RYNEK"}</span><small>{item.ageYears !== undefined ? `${item.ageYears} lat` : "wiek ?"} · {money(item.minBid ?? item.price, item.currency || "PLN")}</small></div>
                  <div className={styles.scoreCell}><strong>{item.recognition}</strong><span>confidence {item.confidence}%</span></div>
                  <div className={styles.factCell}><strong>{item.history.spanYears} lat</strong><span>{item.history.captures} snapshotów</span><small>{item.history.firstYear || "?"}–{item.history.lastYear || "?"}</small></div>
                  <div className={styles.factCell}><strong>TF {item.majesticQuality || 0}</strong><span>{compactNumber(item.majesticDomains)} ref. domen</span><small>{compactNumber(item.majesticLinks)} linków</small></div>
                  <div className={styles.factCell}><strong>{item.crawl.urls}</strong><span>URL w Common Crawl</span><small>{compactNumber(item.pages)} stron źródłowych</small></div>
                  <div className={item.spamRisk <= 20 ? styles.riskLow : item.spamRisk <= 40 ? styles.riskMid : styles.riskHigh}><strong>{item.spamRisk}</strong><span>spam risk</span></div>
                  <div className={`${styles.verdict} ${styles[item.verdict === "STRONG BUY" ? "buy" : item.verdict === "WATCH" ? "watch" : item.verdict === "REVIEW" ? "review" : "skip"]}`}>{item.verdict}</div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
