import chromium from "@sparticuz/chromium";
import puppeteer, { type ElementHandle, type Page } from "puppeteer-core";
import { testAftermarketCredentials } from "@/lib/aftermarket-runtime";

const AFTERMARKET_URL = "https://www.aftermarket.pl/";

export type ProvisionSession = {
  url: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
  }>;
};

export type ProvisionKeyMode = "auto" | "new";

export type ProvisionRequest = {
  login: string;
  password: string;
  otp?: string;
  keyName?: string;
  keyMode?: ProvisionKeyMode;
  session?: ProvisionSession;
};

export type ProvisionResult =
  | { ok: true; apiKey: string; apiPassword: string; keyName: string; keySource: "existing" | "created" }
  | { ok: false; code: "OTP_REQUIRED"; message: string; session: ProvisionSession }
  | {
      ok: false;
      code:
        | "HUMAN_VERIFICATION"
        | "LOGIN_FAILED"
        | "PERMISSION_MAPPING_FAILED"
        | "KEY_EXTRACTION_FAILED"
        | "EXISTING_KEY_FOUND"
        | "PROVISION_FAILED";
      message: string;
    };

type ExistingKeyCandidate = {
  text: string;
  apiKey: string | null;
  exactName: boolean;
};

type ExistingKeyLookup =
  | { status: "none" }
  | { status: "reused"; apiKey: string; apiPassword: string; keyName: string }
  | { status: "blocked"; message: string };

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function clickByText(page: Page, phrases: string[]) {
  const wanted = phrases.map(normalized);
  const handles = await page.$$("a,button,[role='button']");
  for (const handle of handles) {
    const text = normalized(await handle.evaluate((node) => (node.textContent || "").trim()));
    if (!text || !wanted.some((phrase) => text.includes(phrase))) continue;
    try {
      await handle.click();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function clickRowAction(page: Page, rowText: string, phrases: string[]) {
  const wantedRow = normalized(rowText);
  const wantedActions = phrases.map(normalized);
  const rows = await page.$$("tr,[role='row'],.list-group-item,.card");
  for (const row of rows) {
    const text = normalized(await row.evaluate((node) => (node.textContent || "").trim()));
    if (!text || text !== wantedRow) continue;
    const actions = await row.$$("a,button,[role='button']");
    for (const action of actions) {
      const actionText = normalized(await action.evaluate((node) => (node.textContent || "").trim()));
      if (!actionText || !wantedActions.some((phrase) => actionText.includes(phrase))) continue;
      try {
        await action.click();
        await waitSettled(page);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function fill(handle: ElementHandle<Element>, value: string) {
  await handle.evaluate((node, nextValue) => {
    if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) return;
    node.focus();
    node.value = nextValue;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitSettled(page: Page) {
  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

async function bodyText(page: Page) {
  return normalized(await page.evaluate(() => document.body?.innerText || ""));
}

function challengeFromText(text: string) {
  return ["captcha", "recaptcha", "hcaptcha", "turnstile", "sprawdz czy jestes czlowiekiem", "verify you are human"].some((needle) => text.includes(needle));
}

async function findOtpInput(page: Page) {
  return page.$(
    "input[autocomplete='one-time-code'],input[name*='otp' i],input[id*='otp' i],input[name*='code' i],input[id*='code' i],input[name*='token' i]",
  );
}

async function submitNearestForm(page: Page, field: ElementHandle<Element>) {
  const clicked = await field.evaluate((node) => {
    const form = node.closest("form");
    const button = form?.querySelector<HTMLElement>("button[type='submit'],input[type='submit'],button");
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clicked) await page.keyboard.press("Enter");
  await waitSettled(page);
}

async function captureSession(page: Page): Promise<ProvisionSession> {
  const cookies = (await page.cookies()).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    ...(Number.isFinite(cookie.expires) ? { expires: cookie.expires } : {}),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
  }));
  return { url: page.url(), cookies };
}

async function verifyLoggedIn(page: Page) {
  const text = await bodyText(page);
  if (challengeFromText(text)) {
    return { ok: false, code: "HUMAN_VERIFICATION", message: "AfterMarket uruchomił CAPTCHA lub inną weryfikację człowieka." } as const;
  }
  const stillHasPassword = Boolean(await page.$("input[type='password']"));
  const loggedInSignal = text.includes("wyloguj") || text.includes("logout") || text.includes("moje konto") || text.includes("twoje konto");
  if (stillHasPassword && !loggedInSignal) {
    return { ok: false, code: "LOGIN_FAILED", message: "AfterMarket odrzucił dane logowania lub wymaga dodatkowego kroku." } as const;
  }
  return null;
}

async function continueOtpSession(page: Page, input: ProvisionRequest): Promise<ProvisionResult | null> {
  if (!input.session) return null;
  await page.setCookie(...input.session.cookies);
  await page.goto(input.session.url, { waitUntil: "domcontentloaded", timeout: 25000 });
  const text = await bodyText(page);
  if (challengeFromText(text)) {
    return { ok: false, code: "HUMAN_VERIFICATION", message: "AfterMarket wymaga weryfikacji człowieka przed dokończeniem 2FA." };
  }
  const otpField = await findOtpInput(page);
  if (!otpField) {
    const verification = await verifyLoggedIn(page);
    if (!verification) return null;
    return { ok: false, code: "LOGIN_FAILED", message: "Sesja 2FA wygasła. Rozpocznij połączenie ponownie." };
  }
  if (!input.otp?.trim()) {
    return { ok: false, code: "OTP_REQUIRED", message: "Wpisz kod jednorazowy przesłany przez AfterMarket.", session: await captureSession(page) };
  }
  await fill(otpField, input.otp.trim());
  await submitNearestForm(page, otpField);
  return verifyLoggedIn(page);
}

async function logIn(page: Page, input: ProvisionRequest): Promise<ProvisionResult | null> {
  if (input.session) return continueOtpSession(page, input);

  await page.goto(AFTERMARKET_URL, { waitUntil: "domcontentloaded", timeout: 25000 });

  let passwordField = await page.$("input[type='password']");
  if (!passwordField) {
    await clickByText(page, ["zaloguj sie", "log in"]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    passwordField = await page.$("input[type='password']");
  }
  if (!passwordField) {
    const text = await bodyText(page);
    if (challengeFromText(text)) {
      return { ok: false, code: "HUMAN_VERIFICATION", message: "AfterMarket wymaga weryfikacji człowieka przed logowaniem." };
    }
    return { ok: false, code: "LOGIN_FAILED", message: "Nie znaleziono formularza logowania AfterMarket." };
  }

  const loginField =
    (await page.$("input[autocomplete='username']")) ||
    (await page.$("input[name*='login' i]")) ||
    (await page.$("input[id*='login' i]")) ||
    (await page.$("input[type='email']")) ||
    (await page.$("input[type='text']"));

  if (!loginField) return { ok: false, code: "LOGIN_FAILED", message: "Nie znaleziono pola loginu AfterMarket." };

  await fill(loginField, input.login);
  await fill(passwordField, input.password);
  await submitNearestForm(page, passwordField);

  let text = await bodyText(page);
  if (challengeFromText(text)) {
    return { ok: false, code: "HUMAN_VERIFICATION", message: "AfterMarket uruchomił CAPTCHA lub inną weryfikację człowieka." };
  }

  const otpField = await findOtpInput(page);
  const otpLikely = Boolean(otpField) || text.includes("kod jednorazowy") || text.includes("one-time code") || text.includes("kod autoryzacyjny");
  if (otpLikely) {
    if (!input.otp?.trim()) {
      return {
        ok: false,
        code: "OTP_REQUIRED",
        message: "AfterMarket wymaga kodu jednorazowego. Wpisz go w Domain Radar, aby dokończyć tę samą sesję.",
        session: await captureSession(page),
      };
    }
    if (!otpField) {
      return {
        ok: false,
        code: "OTP_REQUIRED",
        message: "AfterMarket wymaga kodu jednorazowego, ale formularz 2FA ma nieznany układ.",
        session: await captureSession(page),
      };
    }
    await fill(otpField, input.otp.trim());
    await submitNearestForm(page, otpField);
    text = await bodyText(page);
  }

  return verifyLoggedIn(page);
}

async function openKeyListPage(page: Page) {
  const direct = await page.evaluate(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
    const found = anchors.find((anchor) => {
      const text = normalize(anchor.textContent || "");
      return text.includes("lista kluczy api") || text.includes("list of api keys");
    });
    return found?.href || null;
  });
  if (direct) {
    await page.goto(direct, { waitUntil: "domcontentloaded", timeout: 20000 });
    return true;
  }

  await clickByText(page, ["konto", "account"]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (await clickByText(page, ["lista kluczy api", "list of api keys"])) {
    await waitSettled(page);
    return true;
  }
  return false;
}

async function existingKeyCandidates(page: Page, keyName: string): Promise<ExistingKeyCandidate[]> {
  return page.evaluate((preferredName) => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const preferred = normalize(preferredName);
    const rows = [...document.querySelectorAll<HTMLElement>("tr,[role='row'],.list-group-item,.card")];
    const result: ExistingKeyCandidate[] = [];
    for (const row of rows) {
      const rawText = (row.innerText || row.textContent || "").trim();
      const text = normalize(rawText);
      if (!text) continue;
      const actions = [...row.querySelectorAll<HTMLElement>("a,button,[role='button']")].map((item) => normalize(item.textContent || ""));
      const hasShowPassword = actions.some((item) => item.includes("pokaz haslo") || item.includes("show password"));
      if (!hasShowPassword) continue;

      const inputKey = [...row.querySelectorAll<HTMLInputElement>("input")]
        .map((field) => ({
          value: field.value?.trim() || "",
          meta: normalize(`${field.name} ${field.id} ${field.placeholder || ""} ${field.labels?.[0]?.textContent || ""}`),
        }))
        .find((item) => item.value.length >= 8 && /(api.?key|klucz)/.test(item.meta) && !/(pass|hasl)/.test(item.meta))?.value;

      const compactTokens = rawText
        .split(/\s+/)
        .map((item) => item.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9_.-]+$/g, ""))
        .filter((item) => item.length >= 12 && /^[A-Za-z0-9_.-]+$/.test(item) && /[A-Za-z]/.test(item) && /\d/.test(item));

      result.push({
        text: rawText,
        apiKey: inputKey || compactTokens[0] || null,
        exactName: preferred.length > 0 && text.includes(preferred),
      });
    }
    return result;
  }, keyName);
}

async function currentPermissionsAreSafe(page: Page) {
  return page.evaluate(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const deny = /(kup|buy|bid|licyt|register|rejestr|renew|odnow|delete|usun|transfer|push|dns|invoice|platn|payment|payout|wypl)/;
    const allow = /(buyer\/expiring\/domain\/list|listing\/list|expiring|wygas|spadaj|aukcj|listing|gield|market.*list|lista.*ofert|ofert.*lista)/;
    const checked = [...document.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")].map((box) => {
      const label = box.labels?.length ? [...box.labels].map((item) => item.textContent || "").join(" ") : box.parentElement?.textContent || "";
      return normalize(`${box.name} ${box.id} ${box.value} ${label}`);
    });
    return {
      safe: checked.length > 0 && !checked.some((meta) => deny.test(meta)) && checked.some((meta) => allow.test(meta)),
      relevant: checked.filter((meta) => allow.test(meta)).length,
      dangerous: checked.filter((meta) => deny.test(meta)).length,
    };
  });
}

async function extractExistingCredentials(page: Page, knownApiKey: string | null, accountPassword: string) {
  return page.evaluate(
    ({ knownKey, accountPass }) => {
      const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const candidates = [...document.querySelectorAll<HTMLInputElement>("input")]
        .filter((field) => field.value && field.type !== "hidden")
        .map((field) => {
          const label = field.labels?.length ? [...field.labels].map((item) => item.textContent || "").join(" ") : field.parentElement?.textContent || "";
          return { value: field.value.trim(), meta: normalize(`${field.name} ${field.id} ${label}`) };
        });
      const key =
        candidates.find((item) => /(api.?key|klucz)/.test(item.meta) && !/(pass|hasl)/.test(item.meta) && item.value.length >= 8)?.value ||
        knownKey;
      const password = candidates.find(
        (item) =>
          item.value !== accountPass &&
          item.value.length >= 8 &&
          /(api.*pass|key.*pass|hasl.*klucz|klucz.*hasl|password.*api)/.test(item.meta),
      )?.value;
      if (key && password) return { apiKey: key, apiPassword: password };

      const text = document.body?.innerText || "";
      const keyMatch = text.match(/(?:API\s*key|klucz(?:\s*API)?)\s*[:\-]?\s*([A-Za-z0-9_\-.]{8,})/i);
      const passwordMatch = text.match(/(?:API\s*key\s*password|has(?:ł|l)o\s*(?:do\s*)?klucza(?:\s*API)?|key\s*password)\s*[:\-]?\s*([A-Za-z0-9_\-.!@#$%^&*]{8,})/i);
      const finalKey = keyMatch?.[1] || key;
      if (!finalKey || !passwordMatch?.[1] || passwordMatch[1] === accountPass) return null;
      return { apiKey: finalKey, apiPassword: passwordMatch[1] };
    },
    { knownKey: knownApiKey, accountPass: accountPassword },
  );
}

async function tryReuseExistingKey(page: Page, keyName: string, accountPassword: string): Promise<ExistingKeyLookup> {
  if (!(await openKeyListPage(page))) return { status: "none" };
  const listText = await bodyText(page);
  if (challengeFromText(listText)) {
    return { status: "blocked", message: "AfterMarket wymaga dodatkowej weryfikacji przed odczytem listy kluczy API." };
  }

  const candidates = await existingKeyCandidates(page, keyName);
  if (candidates.length === 0) return { status: "none" };
  const matching = candidates.filter((candidate) => candidate.exactName);
  const candidate = matching[0] || (candidates.length === 1 ? candidates[0] : null);
  if (!candidate) return { status: "none" };

  const listUrl = page.url();
  if (!(await clickRowAction(page, candidate.text, ["uprawnienia", "permissions"]))) {
    return {
      status: "blocked",
      message: "Wykryłem istniejący klucz API, ale nie mogę bezpiecznie sprawdzić jego uprawnień. Użyj ręcznego importu albo świadomie wybierz utworzenie nowego klucza.",
    };
  }

  const permissions = await currentPermissionsAreSafe(page);
  await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!permissions.safe) {
    return {
      status: "blocked",
      message: permissions.dangerous > 0
        ? "Wykryłem istniejący klucz, ale ma szersze uprawnienia niż PL Sniper. Nie użyję go automatycznie."
        : "Wykryłem istniejący klucz, ale nie potrafię potwierdzić wymaganych uprawnień read-only.",
    };
  }

  if (!(await clickRowAction(page, candidate.text, ["pokaz haslo", "show password"]))) {
    return {
      status: "blocked",
      message: "Wykryłem bezpieczny istniejący klucz, ale AfterMarket nie pozwolił automatycznie otworzyć formularza „Pokaż hasło”.",
    };
  }

  const passwordField = await page.$("input[type='password']");
  if (!passwordField) {
    return {
      status: "blocked",
      message: "Wykryłem istniejący klucz, ale formularz ponownego wyświetlenia hasła ma nieznany układ.",
    };
  }
  await fill(passwordField, accountPassword);
  await submitNearestForm(page, passwordField);

  const revealText = await bodyText(page);
  if (challengeFromText(revealText)) {
    return { status: "blocked", message: "AfterMarket wymaga dodatkowej weryfikacji przed pokazaniem hasła klucza API." };
  }

  const credentials = await extractExistingCredentials(page, candidate.apiKey, accountPassword);
  if (!credentials) {
    return {
      status: "blocked",
      message: "Wykryłem istniejący klucz, ale nie udało się bezpiecznie odczytać pary API key + API password.",
    };
  }

  try {
    await testAftermarketCredentials(credentials);
  } catch {
    return {
      status: "blocked",
      message: "Wykryłem istniejący klucz, ale test wymaganych odczytów PL Snipera nie przeszedł. Nie utworzę duplikatu bez Twojej decyzji.",
    };
  }
  return { status: "reused", ...credentials, keyName };
}

async function openCreateKeyPage(page: Page) {
  const direct = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
    const found = anchors.find((anchor) => {
      const text = (anchor.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return text.includes("utworz nowy klucz api") || text.includes("create new api key");
    });
    return found?.href || null;
  });
  if (direct) {
    await page.goto(direct, { waitUntil: "domcontentloaded", timeout: 20000 });
    return true;
  }

  await clickByText(page, ["konto", "account"]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (await clickByText(page, ["utworz nowy klucz api", "create new api key"])) {
    await waitSettled(page);
    return true;
  }

  const secondDirect = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
    const found = anchors.find((anchor) => {
      const text = (anchor.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return text.includes("klucz api") || text.includes("api key");
    });
    return found?.href || null;
  });
  if (!secondDirect) return false;
  await page.goto(secondDirect, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (await clickByText(page, ["utworz nowy klucz api", "create new api key"])) await waitSettled(page);
  return true;
}

async function configureReadOnlyPermissions(page: Page) {
  return page.evaluate(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const forms = [...document.querySelectorAll<HTMLFormElement>("form")];
    const form = forms.find((candidate) => {
      const text = normalize(candidate.innerText || "");
      return text.includes("uprawn") || text.includes("permission") || text.includes("klucz api") || text.includes("api key");
    });
    if (!form) return { ok: false, selected: 0, reason: "form" };

    const textInputs = [...form.querySelectorAll<HTMLInputElement>("input[type='text'],input:not([type])")];
    const nameInput = textInputs.find((field) => {
      const meta = normalize(`${field.name} ${field.id} ${field.placeholder}`);
      return meta.includes("name") || meta.includes("nazwa") || meta.includes("key");
    }) || textInputs[0];
    if (nameInput) nameInput.dataset.domainRadarKeyName = "1";

    const deny = /(kup|buy|bid|licyt|register|rejestr|renew|odnow|delete|usun|transfer|push|dns|invoice|platn|payment|payout|wypl)/;
    const allow = /(buyer\/expiring\/domain\/list|listing\/list|expiring|wygas|spadaj|aukcj|listing|gield|market.*list|lista.*ofert|ofert.*lista)/;
    let selected = 0;
    for (const box of [...form.querySelectorAll<HTMLInputElement>("input[type='checkbox']")]) {
      const label = box.labels?.length ? [...box.labels].map((item) => item.textContent || "").join(" ") : box.parentElement?.textContent || "";
      const meta = normalize(`${box.name} ${box.id} ${box.value} ${label}`);
      if (deny.test(meta)) continue;
      if (!allow.test(meta)) continue;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      selected += 1;
    }
    return { ok: Boolean(nameInput) && selected > 0, selected, reason: selected > 0 ? "" : "permissions" };
  });
}

async function fillKeyName(page: Page, keyName: string) {
  const field = await page.$("input[data-domain-radar-key-name='1']");
  if (!field) return false;
  await fill(field, keyName);
  return true;
}

async function submitKeyForm(page: Page) {
  const field = await page.$("input[data-domain-radar-key-name='1']");
  if (!field) return false;
  await submitNearestForm(page, field);
  return true;
}

async function extractCredentials(page: Page) {
  return page.evaluate(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const candidates = [...document.querySelectorAll<HTMLInputElement>("input")]
      .filter((field) => field.value && field.type !== "hidden")
      .map((field) => {
        const label = field.labels?.length ? [...field.labels].map((item) => item.textContent || "").join(" ") : field.parentElement?.textContent || "";
        return { value: field.value.trim(), meta: normalize(`${field.name} ${field.id} ${label}`) };
      });
    const key = candidates.find((item) => /(api.?key|klucz)/.test(item.meta) && !/(pass|hasl)/.test(item.meta) && item.value.length >= 8)?.value;
    const password = candidates.find((item) => /(password|hasl)/.test(item.meta) && item.value.length >= 8)?.value;
    if (key && password) return { apiKey: key, apiPassword: password };

    const text = document.body?.innerText || "";
    const keyMatch = text.match(/(?:API\s*key|klucz(?:\s*API)?)\s*[:\-]?\s*([A-Za-z0-9_\-.]{8,})/i);
    const passwordMatch = text.match(/(?:API\s*key\s*password|has(?:ł|l)o(?:\s*do\s*klucza)?|password)\s*[:\-]?\s*([A-Za-z0-9_\-.!@#$%^&*]{8,})/i);
    if (!keyMatch?.[1] || !passwordMatch?.[1]) return null;
    return { apiKey: keyMatch[1], apiPassword: passwordMatch[1] };
  });
}

export async function provisionAftermarketKey(input: ProvisionRequest): Promise<ProvisionResult> {
  const login = input.login.trim();
  const password = input.password;
  const keyName = (input.keyName?.trim() || "Domain Radar PL Sniper").slice(0, 80);
  const keyMode = input.keyMode || "auto";
  if (!login || password.length < 6) return { ok: false, code: "LOGIN_FAILED", message: "Podaj poprawny login i hasło AfterMarket." };

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149 Safari/537.36 DomainRadarProvisioner/1.0");

    const loginFailure = await logIn(page, { ...input, login, password });
    if (loginFailure) return loginFailure;

    if (keyMode === "auto") {
      const existing = await tryReuseExistingKey(page, keyName, password);
      if (existing.status === "reused") {
        return { ok: true, apiKey: existing.apiKey, apiPassword: existing.apiPassword, keyName: existing.keyName, keySource: "existing" };
      }
      if (existing.status === "blocked") {
        return { ok: false, code: "EXISTING_KEY_FOUND", message: existing.message };
      }
    }

    if (!(await openCreateKeyPage(page))) {
      return { ok: false, code: "PROVISION_FAILED", message: "Nie udało się otworzyć formularza tworzenia klucza API w AfterMarket." };
    }

    const pageContent = await bodyText(page);
    if (challengeFromText(pageContent)) {
      return { ok: false, code: "HUMAN_VERIFICATION", message: "AfterMarket wymaga dodatkowej weryfikacji przed utworzeniem klucza." };
    }

    const permissionState = await configureReadOnlyPermissions(page);
    if (!permissionState.ok) {
      return { ok: false, code: "PERMISSION_MAPPING_FAILED", message: "Nie udało się bezpiecznie dopasować minimalnych uprawnień read-only. Bot nie nadał szerszych uprawnień automatycznie." };
    }

    if (!(await fillKeyName(page, keyName)) || !(await submitKeyForm(page))) {
      return { ok: false, code: "PROVISION_FAILED", message: "Nie udało się wysłać formularza tworzenia klucza API." };
    }

    const credentials = await extractCredentials(page);
    if (!credentials) {
      return { ok: false, code: "KEY_EXTRACTION_FAILED", message: "Klucz mógł zostać utworzony, ale AfterMarket zmienił układ strony i nie udało się bezpiecznie odczytać obu danych dostępowych." };
    }

    await testAftermarketCredentials(credentials);
    return { ok: true, ...credentials, keyName, keySource: "created" };
  } catch (error) {
    return { ok: false, code: "PROVISION_FAILED", message: error instanceof Error ? error.message : "Provisioning AfterMarket nie powiódł się." };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
