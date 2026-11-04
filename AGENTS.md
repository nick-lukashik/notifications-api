# AGENTS.md

notifications-api: sign-in codes (synchronous, from id-api), emails from events (pg-boss jobs), the in-app inbox. Built from nest-example; `src/common/` stays identical to it, except the error codes in `app-error.ts`, `error.filter.ts` and `openapi.ts` (as in id-api). Human docs: `README.md`.

## Commands

`pnpm install`, `pnpm infra:up`, `pnpm env:local`, `pnpm db:migrate`, `pnpm dev`. `pnpm verify` must be green before you hand work over.

## Rules

- A sign-in code, an address or an email body never reaches a table, a log or an event. Errors pass through `redact()`.
- Consumers only write in the inbox transaction (an inbox entry, a pg-boss job). Sending happens in the job, with retries.
- Every inbox query filters by the caller's `userId`.
