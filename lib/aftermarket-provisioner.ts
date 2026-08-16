import chromium from "@sparticuz/chromium";
import puppeteer, { type ElementHandle, type Page } from "puppeteer-core";
import { testAftermarketCredentials } from "@/lib/aftermarket-runtime";

const AFTERMARKET_URL = "https://www.aftermarket.pl/";

export type ProvisionRequest = {
  login: string;
  password: string;
  otp?: string;
  keyName?: string;
};

export type ProvisionResult =
  | { ok: true; apiKey: string; apiPassword: string; keyName: string }
  | { ok: false; code: "OTP_REQUIRED" | "HUMAN_VERIFICATION" | "LOGIN_FAILED" | "PERMISSION_MAPPING_FAILED" | "KEY_EXTRACTION_FAILED" | "PROVISION_FAILED"; message: string };

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

async function fill(handle: ElementHandle<Element>, value: string) {
  await handle.click({ clickCount: 3 });
  await handle.type(value, { delay: 12 });
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
  const button = await field.evaluateHandle((node) => {
    const form = node.closest("form");
    return form?.querySelector("button[type='submit'],input[type='submit'],button") || null;
  });
  const element = button.asElement();
  if (element) {
    await element.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await waitSettled(page);
}

async function logIn(page: Page, input: ProvisionRequest): Promise<ProvisionResult | null> {
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
      return { ok: false, code: "OTP_REQUIRED", message: "AfterMarket wymaga kodu jednorazowego. Wpisz go w Domain Radar i ponów połączenie." };
    }
    if (!otpField) return { ok: false, code: "OTP_REQUIRED", message: "AfterMarket wymaga kodu jednorazowego, ale formularz 2FA ma nieznany układ." };
    await fill(otpField, input.otp.trim());
    await submitNearestForm(page, otpField);
    text = await bodyText(page);
  }

  const stillHasPassword = Boolean(await page.$("input[type='password']"));
  const loggedInSignal = text.includes("wyloguj") || text.includes("logout") || text.includes("moje konto") || text.includes("twoje konto");
  if (stillHasPassword && !loggedInSignal) {
    return { ok: false, code: "LOGIN_FAILED", message: "AfterMarket odrzucił dane logowania lub wymaga dodatkowego kroku." };
  }
  return null;
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
  const result = await page.evaluate(() => {
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
  return result;
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

    await testAftermarketCredentials({ ...credentials, source: "vault" });
    return { ok: true, ...credentials, keyName };
  } catch (error) {
    return { ok: false, code: "PROVISION_FAILED", message: error instanceof Error ? error.message : "Provisioning AfterMarket nie powiódł się." };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
