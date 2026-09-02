# Troubleshooting

## First-run wizard loops or `/setup` 403s

- `AUTH_SECRET` must be at least 16 characters (32+ random bytes recommended).
- Apply migrations: `npx wrangler d1 migrations apply mailcove --local` (or `--remote`).
- The first user is always an admin. Later signups follow Admin → Settings → allow signups.

## Locked out of the admin account

```bash
# local Miniflare D1
npm run admin:reset-password -- admin@example.com 'new-long-password'

# production
npm run admin:reset-password -- admin@example.com 'new-long-password' --remote
```

Password hashing matches the Worker (PBKDF2-SHA256, 200k iterations).

## WebSocket never connects (polling every 60s)

The client falls back to polling when `/ws` is not 101. Common causes:

- Security headers or a proxy mutating the upgrade response. Mailcove skips header injection on `Upgrade: websocket`.
- Missing session cookie — open the app on `APP_BASE_URL` so the better-auth cookie is same-site.
- Durable Object mis-export — `src/worker/index.ts` must `export { MailHub }`.

Locally, after a Worker exception the Vite plugin can leave `/ws` broken until you restart `npm run dev`.

## Outbound mail stuck in “Sending” or “Queued”

- Undo window: the outbound queue uses `delaySeconds = UNDO_SEND_SECONDS`. Wait, or check Admin → Delivery log.
- Provider credentials: Admin → Providers → Test send.
- Cloudflare sending: Email Sending must be enabled on the zone; `env.EMAIL` is simulated in local dev unless `remote: true`.
- Size/recipients: Cloudflare 5 MiB / 50 recipients / 32 attachments. Other providers have their own caps, enforced before enqueue.
- Cron `* * * * *` re-queues messages stuck in `sending` for >10 minutes.

## Inbound never appears

1. Admin → Domains: MX / SPF / DKIM show verified?
2. Catch-all mailbox set? Unknown-recipient policy `reject` drops mail Cloudflare-side via `setReject`.
3. Address routing: exact mailbox → alias → `user+tag@` → domain catch-all → Unrouted.
4. Admin → Unrouted mail can deliver a message after you create the mailbox.
5. Provider webhooks: raw body + signature headers must reach `/api/webhooks/<provider>` (no extra JSON wrapping).
6. Check `mailcove-dlq` under Admin → Dead letters.

## “The field issuer does not exist”

The `account` table must include `issuer` (better-auth). Apply `drizzle/` migrations; do not hand-edit only the newer FTS file.

## Search returns nothing

FTS lives in `messages_fts` (migration `0001_fts_search.sql`). Re-apply migrations if that file was skipped. Operators like `from:` filter in SQL even without a text query.

## 2FA / QR does not scan

The secret is TOTP (30s). System clock skew > ~30s will fail codes. Admins can disable 2FA for a user under Admin → Users.

## Deploy fails on Queues or Email

Paid Workers plan is required for Email Workers. Queues, D1, R2, and Durable Objects must already exist — `npm run setup -- --execute` creates them. `database_id` still has to be a real UUID, not `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## Images in mail are blank

Remote images are blocked by default (tracking pixels). Use “Show images” on the message or Settings → General → External images. `cid:` inline images are rewritten to same-origin attachment URLs and always shown.

## CSP / iframe issues

Bodies render in a sandboxed iframe via `srcdoc` after DOMPurify. The page CSP is strict; do not serve the SPA from a different origin than `APP_BASE_URL` if you expect cookies or `/ws` to work.
