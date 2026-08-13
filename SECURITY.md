# Security

## Secrets
- Never commit `OPENAI_API_KEY` or registrar credentials.
- Production secrets belong in the hosting platform environment configuration.
- Rotate any credential immediately if it is exposed in logs, source code or screenshots.

## Domain availability safety
- A domain is marked `available` only on an explicit RDAP 404 response.
- Timeouts, rate limits and other failures are reported as `unknown`, never as available.

## AI isolation
- The naming model has no tools and cannot perform purchases or mutations.
- AI output is sanitized before it is converted into domain candidates.
- Deterministic fallback keeps the search pipeline operational if AI is unavailable.

## Production hardening backlog
- persistent rate limiting
- authentication and per-user quotas
- audit log for searches and future registrar actions
- CSRF/origin controls for authenticated mutations
- dependency and secret scanning in CI
