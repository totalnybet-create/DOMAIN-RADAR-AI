import {
  isDynadotRegistrationConfigured,
  registerDynadotDomain,
  searchDynadotDomains,
  validateRegistrationToken,
} from "@/lib/dynadot";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!isDynadotRegistrationConfigured()) {
    return Response.json({ error: "Domain registration is disabled." }, { status: 503 });
  }

  if (!validateRegistrationToken(request.headers.get("x-domain-radar-registration-token"))) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { domain?: string; duration?: number; maxCost?: number; allowPremium?: boolean; confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase() || "";
  const duration = Math.min(10, Math.max(1, Number(body.duration) || 1));
  const maxCost = Number(body.maxCost);
  if (!body.confirm) return Response.json({ error: "Explicit confirmation is required." }, { status: 400 });
  if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(domain)) return Response.json({ error: "Invalid domain." }, { status: 400 });
  if (!Number.isFinite(maxCost) || maxCost <= 0) return Response.json({ error: "maxCost is required." }, { status: 400 });

  const live = (await searchDynadotDomains([domain])).get(domain);
  if (!live || live.state !== "available") return Response.json({ error: "Domain is no longer available." }, { status: 409 });
  if (live.premium && body.allowPremium !== true) return Response.json({ error: "Premium domain requires allowPremium=true." }, { status: 409 });
  const currentCost = live.price?.registrationPrice;
  if (currentCost === undefined) return Response.json({ error: "Dynadot did not return a registration price." }, { status: 502 });
  if (currentCost > maxCost) {
    return Response.json({ error: "Registration price changed.", currentCost, currency: live.price?.currency }, { status: 409 });
  }

  const result = await registerDynadotDomain(domain, { duration, allowPremium: body.allowPremium === true, privacy: "full" });
  return Response.json({ ok: true, domain, currentCost, currency: live.price?.currency, result });
}
