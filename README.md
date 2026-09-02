# Mailcove

**Your domains. Your inbox. Your Cloudflare account.**

Mailcove is a self-hosted email inbox for custom domains. It runs as a single Cloudflare Worker (paid plan) with a Gmail-inspired React client and a full admin panel. Cloudflare Email Service is the default mail path; Resend, Postmark, SendGrid, and Mailgun plug in behind the same provider interface.

## What you get

- Inbound mail via Cloudflare `email()`, or inbound webhooks from Resend / Postmark / SendGrid / Mailgun
- Outbound send through `env.EMAIL.send()` or the provider you pick per domain
- Threading, labels, filters, snooze, scheduled send, undo send, vacation auto-reply
- Gmail-style search operators (`from:`, `subject:`, `has:attachment`, `older_than:7d`, …)
- Realtime updates over a per-user Durable Object WebSocket, with polling fallback
- Web Push, 2FA, scoped API keys (`mc_live_…`), outgoing webhooks
- Admin: users, domains + DNS, mailboxes/aliases, providers, unrouted mail, delivery log, audit, backups, DLQ

## Stack

React 19 + Vite + Hono on one Worker. D1 (Drizzle), R2, Queues, Durable Objects, Rate Limiting. Auth is better-auth (email/password + TOTP).

## Quick start (local)

```bash
git clone https://github.com/genisis-lab/mailcove.git
cd mailcove
npm install
cp .dev.vars.example .dev.vars
# set AUTH_SECRET and ENCRYPTION_KEY (openssl rand -base64 32)
npx wrangler d1 migrations apply mailcove --local
npm run dev
```

Open http://localhost:5173 and walk through `/setup`. The Cloudflare send binding is simulated locally (messages are logged, not delivered).

To provision remote D1 / R2 / queues and patch `wrangler.jsonc`:

```bash
npm run setup
```

## Deploy

See [docs/deployment.md](docs/deployment.md). In short: create the Cloudflare resources, put secrets with `wrangler secret put`, apply D1 migrations, `npm run deploy`. Point Email Routing’s catch-all at this Worker.

## Docs

- [Deployment](docs/deployment.md)
- [Mail providers](docs/providers.md)
- [Public API](docs/api.md)
- [Troubleshooting](docs/troubleshooting.md)

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite + Worker locally |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run setup` | Create D1/R2/queues, write config, migrate |
| `npm run admin:reset-password` | Reset an admin password against D1 |
| `npm run verify` | Typecheck, lint, unit tests, build |

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

IMAP/SMTP client access, a CLI/MCP server, calendar, and AI features are intentionally out of scope for this build.
