# Mail providers

Every domain picks one provider. Credentials come from Worker secrets or the encrypted store in **Admin → Providers**. The Worker talks to them through a single `MailProvider` interface (`send`, webhook verify/parse, domain create/status/delete).

## Cloudflare (default)

**Inbound:** Email Routing catch-all → this Worker’s `email()` handler. Size is checked, the recipient is routed (exact / alias / plus-tag / catch-all / unrouted), raw MIME is written to R2, and an ingest job is queued.

**Outbound:** `env.EMAIL.send()` (structured Email Sending API). Limits enforced up front: 50 recipients, 5 MiB total, 32 attachments, header allowlist.

**Domain onboarding:** `CF_API_TOKEN` + `CF_ACCOUNT_ID`. The Worker lists the zone, enables routing, points the catch-all at `EMAIL_WORKER_NAME`, enables sending, and caches DNS status.

Locally the send binding is simulated (logged, not delivered). Add `"remote": true` on the `send_email` binding after `wrangler login` if you want real sends from `npm run dev`.

## Resend (full)

**Outbound:** `POST https://api.resend.com/emails` with an idempotency key (`mailcove-<messageId>`).

**Inbound:** webhook `email.received` (Svix HMAC, `svix-*` or `webhook-*` headers) → `GET /emails/receiving/{id}` (falls back from `data_uri` HTML to `cid` when the body is large) → attachment download.

**Events:** `sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`.

**Domains:** Resend Domains API for create / verify / DNS records. Point the webhook URL shown in Admin → Providers at `/api/webhooks/resend`.

Secrets: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`.

## Postmark

Inbound Parse (JSON) and delivery/bounce webhooks on `/api/webhooks/postmark`. Authenticated with `POSTMARK_WEBHOOK_SECRET` (shared token header). Outbound uses `POSTMARK_SERVER_TOKEN`; domain DNS uses `POSTMARK_ACCOUNT_TOKEN` when present.

## SendGrid

Inbound Parse (multipart) on `/api/webhooks/sendgrid`. Event webhook (delivered / bounce / drop / spamreport) uses ECDSA verification with `SENDGRID_WEBHOOK_PUBLIC_KEY`. Outbound: `SENDGRID_API_KEY`.

## Mailgun

Routes “store and notify” + event webhooks on `/api/webhooks/mailgun` (HMAC with `MAILGUN_WEBHOOK_SIGNING_KEY`). Outbound: `MAILGUN_API_KEY`. Region: `MAILGUN_REGION` (`us` or `eu`).

## Choosing a provider per domain

Admin → Domains → Add domain → pick the provider. Mailcove stores the provider id, cached DNS records, and catch-all / unknown-recipient policy (`unrouted` or `reject`) on the domain row. Switching providers later is “remove + re-add”; in-flight messages keep the provider they were sent with.

## Webhook URLs

All inbound webhooks skip session/origin checks and authenticate themselves:

| Provider | Path |
| --- | --- |
| Resend | `https://<APP_BASE_URL>/api/webhooks/resend` |
| Postmark | `https://<APP_BASE_URL>/api/webhooks/postmark` |
| SendGrid | `https://<APP_BASE_URL>/api/webhooks/sendgrid` |
| Mailgun | `https://<APP_BASE_URL>/api/webhooks/mailgun` |

Rate-limited at 600 req/min per the `WEBHOOK_RATE_LIMITER` binding.
