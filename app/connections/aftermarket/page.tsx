"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./page.module.css";

type ConnectionMode = "auto" | "manual" | "new";

type ConnectionStatus = {
  connected: boolean;
  source?: "environment" | "vault" | null;
  keyName?: string | null;
  autoRepairReady?: boolean;
  executionEnabled?: boolean;
  permissions?: string;
};

type ConnectResponse = ConnectionStatus & {
  ok?: boolean;
  error?: string;
  code?: string;
  requiresOtp?: boolean;
  humanVerificationRequired?: boolean;
  existingKeyFound?: boolean;
  keyFingerprint?: string;
  keySource?: "existing" | "created" | "manual";
};

const modeCopy: Record<ConnectionMode, { title: string; description: string }> = {
  auto: {
    title: "Automatycznie",
    description: "Bot loguje konto, szuka istniejącego bezpiecznego klucza i używa go. Nowy tworzy dopiero wtedy, gdy nie ma pasującego klucza.",
  },
  manual: {
    title: "Mam klucz",
    description: "Wklej istniejący API key i API password. Domain Radar sprawdzi wymagane odczyty i zapisze credential w szyfrowanym vault.",
  },
  new: {
    title: "Nowy klucz",
    description: "Pomiń wykrywanie istniejących kluczy i świadomie utwórz osobny klucz read-only dla PL Snipera.",
  },
};

export default function AftermarketConnectionPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("auto");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [keyName, setKeyName] = useState("Domain Radar PL Sniper");
  const [rememberAccount, setRememberAccount] = useState(true);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const response = await fetch("/api/aftermarket/connection", { cache: "no-store" });
      const payload = (await response.json()) as ConnectionStatus;
      setStatus(payload);
    } catch {
      setStatus({ connected: false });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function chooseMode(nextMode: ConnectionMode) {
    if (loading || nextMode === mode) return;
    setMode(nextMode);
    setNeedsOtp(false);
    setOtp("");
    setMessage("");
    setError("");
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setMessage(
      mode === "manual"
        ? "Sprawdzam klucz na dwóch odczytach wymaganych przez PL Sniper…"
        : mode === "new"
          ? "Loguję konto i tworzę nowy minimalny klucz read-only…"
          : "Loguję konto, szukam istniejącego bezpiecznego klucza i dopiero w razie potrzeby tworzę nowy…",
    );

    try {
      const body =
        mode === "manual"
          ? { mode, apiKey, apiPassword, keyName }
          : { mode, login, password, otp: otp || undefined, keyName, rememberAccount };
      const response = await fetch("/api/aftermarket/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as ConnectResponse;
      if (!response.ok || !payload.connected) {
        if (payload.requiresOtp) {
          setNeedsOtp(true);
          setMessage("AfterMarket wymaga kodu jednorazowego. Wpisz kod tutaj, a Domain Radar dokończy tę samą sesję bez ponownego logowania.");
        } else if (payload.humanVerificationRequired) {
          setMessage("");
          setError("AfterMarket uruchomił CAPTCHA / weryfikację człowieka. Domain Radar jej nie obchodzi; challenge trzeba zatwierdzić legalną metodą serwisu.");
        } else if (payload.existingKeyFound) {
          setMessage("");
          setError(`${payload.error || "Wykryto istniejący klucz, którego nie można bezpiecznie przejąć automatycznie."} Możesz wybrać „Mam klucz” albo świadomie „Nowy klucz”.`);
        } else {
          setMessage("");
          setError(payload.error || "Nie udało się połączyć AfterMarket.");
        }
        return;
      }

      setNeedsOtp(false);
      setOtp("");
      setPassword("");
      setApiPassword("");
      const action = payload.keySource === "existing"
        ? "znaleziony istniejący klucz został zweryfikowany i zabezpieczony"
        : payload.keySource === "manual"
          ? "podany klucz został zweryfikowany i zabezpieczony"
          : "nowy klucz został utworzony, zweryfikowany i zabezpieczony";
      setMessage(`Połączono. ${action}. ${payload.keyFingerprint || "API"}`);
      await refresh();
    } catch {
      setMessage("");
      setError("Nie udało się zakończyć połączenia AfterMarket.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await fetch("/api/aftermarket/connection", { method: "DELETE" });
      setStatus({ connected: false });
      setMessage("Połączenie usunięte z Domain Radar. Klucz w samym AfterMarket nie jest automatycznie kasowany.");
    } finally {
      setLoading(false);
    }
  }

  const accountMode = mode !== "manual";
  const canSubmit = mode === "manual"
    ? apiKey.trim().length >= 8 && apiPassword.length >= 8
    : login.trim().length > 0 && password.length >= 6;

  return (
    <main className={styles.shell}>
      <section className={styles.header}>
        <a href="/sniper" className={styles.back}>← PL Sniper</a>
        <div className={styles.badge}>SECURE CONNECTION</div>
        <h1>Połącz <span>AfterMarket</span></h1>
        <p>Domain Radar może sam znaleźć i wykorzystać istniejący bezpieczny klucz, przyjąć klucz wpisany ręcznie albo utworzyć nowy. Domyślnie nie tworzy duplikatu, jeśli wykryje pasujący credential.</p>
      </section>

      <section className={styles.securityStrip}>
        <div><strong>READ-ONLY</strong><span>bez kupowania i licytowania</span></div>
        <div><strong>HTTPONLY</strong><span>API password poza frontendem</span></div>
        <div><strong>AES-256-GCM</strong><span>szyfrowany vault</span></div>
      </section>

      {status?.connected ? (
        <section className={styles.connectedCard}>
          <div className={styles.statusDot}>✓</div>
          <div className={styles.connectedCopy}>
            <span>AFTERMARKET CONNECTED</span>
            <h2>{status.keyName || "Domain Radar API key"}</h2>
            <p>Źródło: {status.source === "environment" ? "sekret serwerowy" : "zaszyfrowany vault"}. Auto-naprawa: {status.autoRepairReady ? "gotowa" : "wyłączona"}.</p>
          </div>
          <a className={styles.primaryLink} href="/sniper">Otwórz PL Sniper →</a>
          {status.source === "vault" && <button className={styles.disconnect} type="button" onClick={disconnect} disabled={loading}>Usuń połączenie z Domain Radar</button>}
          <div className={styles.executionLock}>AUTO BUY: {status.executionEnabled ? "ARMED" : "LOCKED"} — połączenie konta nie odblokowuje wydawania pieniędzy.</div>
        </section>
      ) : (
        <section className={styles.formCard}>
          <div className={styles.formHead}>
            <div><span>KROK 1</span><h2>Wybierz sposób połączenia</h2></div>
            <small>Automatyczny jest domyślny i najpierw szuka istniejącego klucza.</small>
          </div>

          <div className={styles.modeGrid}>
            {(["auto", "manual", "new"] as ConnectionMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`${styles.modeButton} ${mode === item ? styles.modeButtonActive : ""}`}
                onClick={() => chooseMode(item)}
                disabled={loading}
              >
                <strong>{modeCopy[item].title}</strong>
                <span>{item === "auto" ? "polecane" : item === "manual" ? "bez hasła konta" : "osobny credential"}</span>
              </button>
            ))}
          </div>
          <div className={styles.modeHint}>{modeCopy[mode].description}</div>

          <form onSubmit={connect} autoComplete="off">
            {accountMode ? (
              <>
                <label>
                  <span>Login AfterMarket</span>
                  <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required placeholder="Twój login" />
                </label>
                <label>
                  <span>Hasło do konta</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required placeholder="••••••••••••" />
                </label>
                {needsOtp && (
                  <label className={styles.otpField}>
                    <span>Kod jednorazowy / 2FA</span>
                    <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\s/g, ""))} autoComplete="one-time-code" inputMode="numeric" placeholder="Kod z SMS / e-mail / aplikacji" />
                  </label>
                )}
                <label>
                  <span>{mode === "auto" ? "Preferowana nazwa klucza" : "Nazwa nowego klucza"}</span>
                  <input value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={80} />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>API key</span>
                  <input value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} autoComplete="off" required placeholder="Klucz API z AfterMarket" />
                </label>
                <label>
                  <span>API password</span>
                  <input type="password" value={apiPassword} onChange={(event) => setApiPassword(event.target.value)} autoComplete="off" required placeholder="Hasło do klucza API" />
                </label>
                <label>
                  <span>Nazwa połączenia</span>
                  <input value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={80} />
                </label>
              </>
            )}

            <div className={styles.permissions}>
              <div><strong>Wymagany zakres</strong><span>tylko operacje potrzebne przez PL Sniper</span></div>
              <ul>
                <li>odczyt domen wygasających / spadających</li>
                <li>odczyt list aukcji i ofert rynku</li>
                <li className={styles.denied}>bez rejestracji, transferów, kupowania i licytacji</li>
              </ul>
            </div>

            {accountMode && (
              <label className={styles.remember}>
                <input type="checkbox" checked={rememberAccount} onChange={(event) => setRememberAccount(event.target.checked)} />
                <span><strong>Zachowaj zaszyfrowane dane konta do auto-naprawy klucza</strong><small>Wyłączenie tej opcji zachowa tylko API key + API password.</small></span>
              </label>
            )}

            <button className={styles.connectButton} disabled={loading || !canSubmit}>
              {loading
                ? "Łączenie w toku…"
                : needsOtp
                  ? "Wyślij kod i dokończ połączenie"
                  : mode === "manual"
                    ? "Sprawdź i zapisz klucz"
                    : mode === "new"
                      ? "Utwórz nowy klucz read-only"
                      : "Znajdź klucz i połącz automatycznie"}
            </button>
          </form>
        </section>
      )}

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.explainer}>
        <h2>Co zrobi tryb automatyczny?</h2>
        <ol>
          <li><span>01</span><div><strong>Zaloguje konto</strong><p>Użyje danych wyłącznie w zabezpieczonym połączeniu serwerowym z AfterMarket.</p></div></li>
          <li><span>02</span><div><strong>Sprawdzi istniejące klucze</strong><p>Preferuje pasujący klucz read-only i nie przejmuje automatycznie credentialu z niebezpiecznie szerokimi uprawnieniami.</p></div></li>
          <li><span>03</span><div><strong>Użyje albo utworzy</strong><p>Jeśli bezpieczny klucz istnieje, odzyska jego hasło oficjalnym mechanizmem AfterMarket. Nowy powstaje dopiero, gdy nie ma pasującego klucza.</p></div></li>
          <li><span>04</span><div><strong>Sprawdzi i zabezpieczy</strong><p>Testuje oba odczyty PL Snipera i zapisuje credential w szyfrowanym vault. Frontend nigdy nie dostaje API password.</p></div></li>
        </ol>
      </section>
    </main>
  );
}
