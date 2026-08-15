import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DynadotContact } from "@/lib/dynadot";

const HOTPAY_URL = "https://platnosc.hotpay.pl/";
const SUPABASE_URL = "https://wmcgybrgnxeghvryqitt.supabase.co";
const SUPABASE_KEY = "sb_publishable_2-00TURs_jfUI14PErPC1w_axNB4jVF";

export type HotPayOrder = {
  id: string;
  token: string;
  domain: string;
  amountPln: number;
  wholesalePrice: number;
  wholesaleCurrency: string;
  registrationYears: number;
  premium: boolean;
  contact: DynadotContact;
  paymentStatus: string;
  registrationStatus: string;
  providerPaymentId?: string | null;
  providerSecure?: string | null;
  registrationError?: string | null;
};

function hotPayConfig() {
  return {
    serviceSecret: process.env.HOTPAY_SERVICE_SECRET?.trim() || "",
    notificationPassword: process.env.HOTPAY_NOTIFICATION_PASSWORD?.trim() || "",
  };
}

export function isHotPayConfigured() {
  const config = hotPayConfig();
  return Boolean(config.serviceSecret && config.notificationPassword);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeEqual(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Order store ${response.status}: ${text.slice(0, 220)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export function validateContact(input: unknown): DynadotContact | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const clean = (key: string) => String(source[key] || "").trim();
  const contact: DynadotContact = {
    name: clean("name"),
    email: clean("email"),
    phoneCc: clean("phoneCc").replace(/\D/g, ""),
    phoneNumber: clean("phoneNumber").replace(/\D/g, ""),
    address1: clean("address1"),
    address2: clean("address2") || undefined,
    city: clean("city"),
    state: clean("state") || undefined,
    postalCode: clean("postalCode"),
    country: clean("country").toUpperCase(),
  };
  if (!contact.name || !/^\S+@\S+\.\S+$/.test(contact.email) || !contact.phoneCc || !contact.phoneNumber || !contact.address1 || !contact.city || !contact.postalCode || !/^[A-Z]{2}$/.test(contact.country)) return null;
  return contact;
}

export async function createHotPayOrder(input: {
  domain: string;
  amountPln: number;
  wholesalePrice: number;
  wholesaleCurrency: string;
  registrationYears: number;
  premium: boolean;
  contact: DynadotContact;
}) {
  const id = randomUUID();
  const token = randomBytes(16).toString("base64url");
  const reference = `${id}.${token}`;
  if (reference.length > 64) throw new Error("HotPay order reference too long");
  await rpc<boolean>("create_domenago_order", {
    p_id: id,
    p_token: token,
    p_domain: input.domain,
    p_amount_pln: input.amountPln,
    p_wholesale_price: input.wholesalePrice,
    p_wholesale_currency: input.wholesaleCurrency,
    p_registration_years: input.registrationYears,
    p_premium: input.premium,
    p_contact: input.contact,
  });
  return { id, token, reference };
}

export async function getHotPayOrder(reference: string): Promise<HotPayOrder | null> {
  const [id, token] = reference.split(".");
  if (!/^[0-9a-f-]{36}$/i.test(id || "") || !token || token.length < 20) return null;
  const rows = await rpc<Array<Record<string, unknown>>>("get_domenago_order", { p_id: id, p_token: token });
  const row = rows?.[0];
  if (!row) return null;
  return {
    id,
    token,
    domain: String(row.domain),
    amountPln: Number(row.amount_pln),
    wholesalePrice: Number(row.wholesale_price),
    wholesaleCurrency: String(row.wholesale_currency),
    registrationYears: Number(row.registration_years),
    premium: Boolean(row.premium),
    contact: row.contact as DynadotContact,
    paymentStatus: String(row.payment_status),
    registrationStatus: String(row.registration_status),
    providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
    providerSecure: row.provider_secure ? String(row.provider_secure) : null,
    registrationError: row.registration_error ? String(row.registration_error) : null,
  };
}

export async function updateHotPayOrder(reference: string, changes: {
  paymentStatus?: string;
  registrationStatus?: string;
  providerPaymentId?: string;
  providerSecure?: string;
  registrationError?: string;
}) {
  const [id, token] = reference.split(".");
  if (!id || !token) throw new Error("Invalid HotPay order reference");
  return rpc<boolean>("update_domenago_order", {
    p_id: id,
    p_token: token,
    p_payment_status: changes.paymentStatus ?? null,
    p_registration_status: changes.registrationStatus ?? null,
    p_provider_payment_id: changes.providerPaymentId ?? null,
    p_provider_secure: changes.providerSecure ?? null,
    p_registration_error: changes.registrationError ?? null,
  });
}

export async function createHotPayPayment(input: { reference: string; domain: string; amountPln: number; origin: string; contact: DynadotContact }) {
  const config = hotPayConfig();
  if (!isHotPayConfigured()) throw new Error("HotPay is not configured");
  const amount = input.amountPln.toFixed(2);
  const serviceName = `Rejestracja domeny ${input.domain}`;
  const returnUrl = `${input.origin}/checkout/success?provider=hotpay&order_id=${encodeURIComponent(input.reference)}`;
  const hash = sha256(`${config.notificationPassword};${amount};${serviceName};${returnUrl};${input.reference};${config.serviceSecret}`);
  const form = new FormData();
  form.set("SEKRET", config.serviceSecret);
  form.set("KWOTA", amount);
  form.set("NAZWA_USLUGI", serviceName);
  form.set("ADRES_WWW", returnUrl);
  form.set("ID_ZAMOWIENIA", input.reference);
  form.set("EMAIL", input.contact.email);
  form.set("DANE_OSOBOWE", input.contact.name);
  form.set("TYP", "INIT");
  form.set("HASH", hash);
  const response = await fetch(HOTPAY_URL, { method: "POST", body: form, cache: "no-store" });
  const raw = await response.text();
  let payload: { STATUS?: boolean; URL?: string; WIADOMOSC?: string } = {};
  try { payload = JSON.parse(raw); } catch { throw new Error(`HotPay returned invalid response: ${raw.slice(0, 160)}`); }
  if (!response.ok || !payload.STATUS || !payload.URL) throw new Error(payload.WIADOMOSC || `HotPay API ${response.status}`);
  return payload.URL;
}

export type HotPayNotification = {
  SEKRET: string;
  KWOTA: string;
  STATUS: "SUCCESS" | "PENDING" | "FAILURE" | string;
  ID_ZAMOWIENIA: string;
  ID_PLATNOSCI: string;
  SECURE?: string;
  HASH: string;
};

export function verifyHotPayNotification(values: HotPayNotification) {
  const config = hotPayConfig();
  if (!isHotPayConfigured()) throw new Error("HotPay is not configured");
  if (values.SEKRET !== config.serviceSecret) throw new Error("Invalid HotPay service secret");
  const pieces = [config.notificationPassword, values.KWOTA, values.ID_PLATNOSCI, values.ID_ZAMOWIENIA, values.STATUS];
  if (values.SECURE) pieces.push(values.SECURE);
  pieces.push(values.SEKRET);
  const expected = sha256(pieces.join(";"));
  if (!constantTimeEqual(expected, values.HASH)) throw new Error("Invalid HotPay notification hash");
  return true;
}
