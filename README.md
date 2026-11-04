# notifications-api

Notifications of the nick-lukashik platform:
- sign-in codes by email (a synchronous call from id-api);
- emails caused by events: welcome, payment receipt;
- the in-app inbox shown on id-web.

Built from [`nest-example`](https://github.com/nick-lukashik/nest-example): Postgres, RabbitMQ inbox, pg-boss for emails with retries. Design: [`.github/docs/identity.md`](https://github.com/nick-lukashik/.github/blob/master/docs/identity.md). No public route.

## API

| Route                                                                                | Who                   | What                                                                                              |
| ------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/v1/internal/auth-codes` `{ challengeId, email, code, locale, expiresAt }` | id-api, service token | Sends the code now. `{ status: accepted \| failed }`. Once per challenge, never after `expiresAt` |
| `GET /api/v1/me/notifications?limit&cursor`                                          | access token          | The caller's inbox, newest first, with `unreadCount`                                              |
| `POST /api/v1/me/notifications/:id/read`, `POST /api/v1/me/notifications/read-all`   | access token          | Mark as read; someone else's entry is 404                                                         |

## Events consumed (queue `notifications-api.events`)

| Event                      | Effect, in the inbox transaction                                      |
| -------------------------- | --------------------------------------------------------------------- |
| `id.user.registered.v1`    | an email job `welcome:<userId>`                                       |
| `pay.payment.succeeded.v1` | an email job `receipt:<paymentId>`                                    |
| `wallet.credit.posted.v1`  | an inbox entry `wallet.credited` (`amount`, `balanceAfter`, `source`) |

Email jobs (pg-boss `notifications.email`, 8 retries with backoff) read the address and the language from id-api at send time. A suspended or missing user gets nothing.

## Privacy

- **Not stored and not logged:** the code, the recipient address or the body.
- **`deliveries`:** keeps only the idempotency key (`auth-code:<challengeId>`, `welcome:<userId>`, `receipt:<paymentId>`), the template and the status.
- **Provider errors:** addresses in them are replaced with `<address>`.

## Commands

```bash
pnpm install
pnpm infra:up      # Postgres, RabbitMQ (ports 5442, 5682)
pnpm env:local     # then fill the two tokens, the same as in id-api's .env
pnpm db:migrate
pnpm dev           # http://localhost:4200
pnpm verify
```
