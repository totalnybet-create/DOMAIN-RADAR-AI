# Architecture

## Pipeline
1. User describes a business niche.
2. Naming provider extracts sector vocabulary and generates brand candidates.
3. Candidate labels are combined with selected TLDs.
4. RDAP resolver reads the IANA DNS bootstrap registry, selects the authoritative RDAP service and checks each domain.
5. The server streams status and individual results to the browser as NDJSON.
6. The UI updates progress, checked count, available count and heartbeat on every event.
7. Results are scored and ranked.

## Reliability
- explicit heartbeat timestamp on every event
- client-side stop through AbortController
- per-RDAP request timeout
- unknown state separated from available/registered
- no domain is marked available on timeout or rate limit
- server response is non-cacheable

## Next production stages
- AI naming provider with structured output and deterministic fallback
- persistent jobs/search history
- worker queue for large searches
- registrar price adapters
- trademark/collision screening
- authentication and per-user quotas
- retry/watchdog for long jobs
