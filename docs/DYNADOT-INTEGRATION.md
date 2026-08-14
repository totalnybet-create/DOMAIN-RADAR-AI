# Dynadot integration

Backend integration uses Dynadot REST API v2. Search and price checks are server-side only; API credentials must never be exposed to the browser.

Required production environment variable:

- `DYNADOT_API_KEY`

Recommended:

- `DYNADOT_API_SECRET` for signed, sensitive operations
- `DYNADOT_CURRENCY=PLN`
- `DYNADOT_BULK_SIZE=5` for Regular pricing tier (10 for Bulk, 20 for Super Bulk)
- `DYNADOT_REQUEST_INTERVAL_MS=1050` for Regular tier
- `DYNADOT_MARKUP_PERCENT=20`
- `DYNADOT_MARKUP_FIXED=0`

Domain registration is intentionally disabled until checkout/payment is connected. To enable the guarded server registration endpoint later, set:

- `DYNADOT_REGISTRATION_ENABLED=true`
- `DOMAIN_RADAR_REGISTRATION_TOKEN=<strong random server-only token>`

The integration should fall back to RDAP when Dynadot is not configured or temporarily unavailable.
