# DOMAIN RADAR AI

AI-assisted domain and brand discovery platform.

## MVP goals
- understand a business niche from a short prompt
- generate brandable domain candidates
- check availability across multiple TLDs using RDAP
- score and rank candidates
- expose progress, heartbeat and watchdog status
- keep search history ready for a persistence layer

## Architecture
Next.js application with server-side API routes. Domain checks use the IANA RDAP bootstrap registry and authoritative RDAP services. The naming engine is provider-based so an AI provider can be enabled without changing the UI or domain-checking pipeline.

## Status
Initial production-oriented scaffold in progress.

<!-- redeploy: refresh Dynadot production environment -->
