import { getDynadotConfig, isDynadotConfigured, searchDynadotDomains } from '@/lib/dynadot';

export const runtime = 'nodejs';
export const maxDuration = 60;

function cleanLabel(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 63);
}

async function usdToPln() {
  const fallback = Number.parseFloat(process.env.DYNADOT_USD_PLN_RATE || '4');
  try {
    const response = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    const payload = await response.json();
    const rate = Number(payload?.rates?.[0]?.mid);
    return Number.isFinite(rate) ? rate : fallback;
  } catch {
    return fallback;
  }
}

function round(value: number) { return Math.round(value * 100) / 100; }

export async function GET(request: Request) {
  if (!isDynadotConfigured()) return Response.json({ connected: false, error: 'Dynadot API is not configured.' }, { status: 503 });
  const url = new URL(request.url);
  const labels = Array.from(new Set((url.searchParams.get('names') || '').split(',').map(cleanLabel).filter(Boolean))).slice(0, 50);
  if (!labels.length) return Response.json({ error: 'Provide names.' }, { status: 400 });
  const domains = labels.map((label) => `${label}.vip`);
  try {
    const config = getDynadotConfig();
    const live = await searchDynadotDomains(domains);
    const rate = await usdToPln();
    const results = domains.map((domain) => {
      const item = live.get(domain);
      const currency = item?.price?.currency || config.currency;
      const factor = currency === 'USD' ? rate : 1;
      const registration = item?.price?.registrationPrice;
      const renewal = item?.price?.renewalPrice;
      return {
        domain,
        state: item?.state || 'unknown',
        premium: item?.premium || false,
        pricePLN: registration === undefined ? undefined : round(registration * factor),
        renewalPLN: renewal === undefined ? undefined : round(renewal * factor),
        detailsError: item?.detailsError,
      };
    });
    return Response.json({ connected: true, count: results.length, results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ connected: true, error: error instanceof Error ? error.message : 'Dynadot VIP scan failed.' }, { status: 502 });
  }
}
