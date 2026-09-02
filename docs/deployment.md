# Deploying Mailcove

Mailcove is one Cloudflare Worker plus D1, R2, three Queues, and a Durable Object. A **paid Workers plan** is required for Email Workers (`email()` / `env.EMAIL.send()`).

## 1. Cloudflare resources

From a machine that is `wrangler login`’d to the account you want:

```bash
npm install
npm run setup -- --execute
```

The wizard creates:

- D1 database `mailcove` and writes its id into `wrangler.jsonc`
- R2 bucket `mailcove-storage`
- Queues `mailcove-inbound`, `mailcove-outbound`, `mailcove-dlq`

You can also create them by hand:

```bash
npx wrangler d1 create mailcove
npx wrangler r2 bucket create mailcove-storage
npx wrangler queues create mailcove-inbound
npx wrangler queues create mailcove-outbound
npx wrangler queues create mailcove-dlq
```

Copy the D1 `database_id` into `wrangler.jsonc`.

## 2. Secrets

Required in production:

```bash
npx wrangler secret put AUTH_SECRET          # openssl rand -base64 48
npx wrangler secret put ENCRYPTION_KEY       # openssl rand -base64 32
```

Optional, depending on providers:

```bash
npx wrangler secret put CF_API_TOKEN         # Zone Read, Email Routing Edit, Email Sending Edit
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put POSTMARK_SERVER_TOKEN
npx wrangler secret put POSTMARK_ACCOUNT_TOKEN
npx wrangler secret put POSTMARK_WEBHOOK_SECRET
npx wrangler secret put SENDGRID_API_KEY
npx wrangler secret put SENDGRID_WEBHOOK_PUBLIC_KEY
npx wrangler secret put MAILGUN_API_KEY
npx wrangler secret put MAILGUN_WEBHOOK_SIGNING_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT        # mailto:you@yourdomain
```

Generate VAPID keys with `npx web-push generate-vapid-keys`.

## 3. Vars

In `wrangler.jsonc` → `vars`:

| Var | Meaning |
| --- | --- |
| `APP_NAME` | Shown in the UI and emails |
| `APP_BASE_URL` | Public origin (`https://mail.example.com`). Used for cookies, webhook URLs, and links |
| `EMAIL_WORKER_NAME` | Must match the Worker `name` so Email Routing can target it |
| `DEFAULT_MAIL_PROVIDER` | `cloudflare` (default), `resend`, `postmark`, `sendgrid`, or `mailgun` |
| `UNDO_SEND_SECONDS` | Hold outgoing mail so it can be cancelled (0–60) |

Uncomment the `routes` block to serve the app on your own hostname (zone must live on the same account).

## 4. Migrate and deploy

```bash
npx wrangler d1 migrations apply mailcove --remote
npm run deploy
```

Or enable the `Deploy` GitHub Action by setting repository variable `DEPLOY_ENABLED=true` and secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.

## 5. First-run wizard

Open the deployed URL. `/setup` creates the first admin (that user becomes `role=admin`), then walks through provider → domain → mailbox.

If you get locked out:

```bash
npm run admin:reset-password -- you@example.com 'new-long-password' --remote
```

## 6. Cloudflare Email Routing

1. In the Cloudflare dashboard, open the zone for the domain.
2. Email → Email Routing → enable.
3. Destination / catch-all: send to Worker `mailcove` (the `EMAIL_WORKER_NAME`).
4. Email Sending: enable for the same zone if you want `env.EMAIL.send()`.

The admin **Domains** page can do this through the API when `CF_API_TOKEN` has Email Routing Edit + Email Sending Edit + Zone Read.

DNS the wizard will ask for typically includes MX toward Cloudflare, SPF, DKIM, and a DMARC record. Exact rows are shown per provider on the domain card.

## 7. Cron and queues

`wrangler.jsonc` already wires:

- `* * * * *` — wake snoozed threads, dispatch scheduled sends, retry stuck outbound
- `0 3 * * *` — trash/spam retention, staged-upload cleanup, session cleanup, DNS re-check, optional R2 backup

Inbound `email()` stores raw MIME in R2 and enqueues `mailcove-inbound`. Sends go through `mailcove-outbound` with `delaySeconds` equal to the undo window. Failures land on `mailcove-dlq` and show up under Admin → Dead letters.

## Follow-ups (not in this build)

IMAP/SMTP access, a CLI + MCP server, calendar, and AI features.
