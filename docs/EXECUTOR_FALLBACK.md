# Domain Radar Executor Fallback

Domain Radar uses a reusable executor chain instead of treating any external runner as a single point of failure.

## Policy

Default provider order:

1. `native`
2. `replit`
3. `appdeploy`
4. `yepcode`

A provider failure does not stop the task. The chain records a sanitized attempt result and moves to the next configured provider.

The chain stops only when:

- the task succeeds;
- a task explicitly requires human action, such as CAPTCHA, 2FA approval, or a protected account-security step;
- an adapter marks an error as non-retryable.

## Security boundary

The executor chain is an orchestration primitive, not a public arbitrary-code runner. Each task must be implemented as a named, code-defined adapter. Inputs and secret payloads must never be included in executor logs or attempt summaries.

Credential-changing actions must preserve provider security controls and may require explicit user interaction.

## Configuration

`EXECUTOR_PROVIDER_ORDER` may override the default order using a comma-separated list of supported providers.

Remote providers are considered configured only when their endpoint is present:

- `EXECUTOR_REPLIT_URL`
- `EXECUTOR_APPDEPLOY_URL`
- `EXECUTOR_YEPCODE_URL`

The native provider is always available inside the Domain Radar deployment.

## Status

`GET /api/executor/status` reports the active strategy, provider order, and whether each provider is configured. It never returns credentials, tokens, or secret configuration values.
