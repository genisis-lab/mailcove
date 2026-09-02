# Mailcove staging

Live URL: https://mailcove-staging.neil27.workers.dev

Provisioned on 2026-09-02 in Cloudflare account `3ece4993f323ece88322161931be6e72`.
Staging D1 ID: `ce29e912-9238-4d26-acde-5b979e08180a`.
The admin account is initialized and public sign-ups are disabled. Login details
are stored separately from the repository.

The `staging` environment in `wrangler.jsonc` uses its own Worker, D1 database,
R2 bucket, queues, Durable Object namespace, and rate-limit namespaces.

## Provision a new instance

The current staging resources already exist. For a fresh account, authenticate
Wrangler to that account, then create these resources:

```sh
npx wrangler d1 create mailcove-staging
npx wrangler r2 bucket create mailcove-staging-storage
npx wrangler queues create mailcove-staging-inbound
npx wrangler queues create mailcove-staging-outbound
npx wrangler queues create mailcove-staging-dlq
```

Set `env.staging.d1_databases[0].database_id` to the new database ID and
`env.staging.vars.APP_BASE_URL` to the actual staging HTTPS origin. The checked-in
values refer to the deployed staging instance above.

Set independent staging secrets with `npx wrangler secret put AUTH_SECRET --env staging`
and `npx wrangler secret put ENCRYPTION_KEY --env staging`. Use a random 48-byte
base64 authentication secret and a random 32-byte base64 encryption key.

## Deploy

```sh
npm run db:migrate:staging
npm run deploy:staging
```

The build selects the Cloudflare environment using `CLOUDFLARE_ENV=staging`.
Wrangler then deploys Vite's generated, flattened staging configuration.
Always rebuild with `npm run deploy:staging` before deployment.

Create the first administrator through `/setup` promptly after deployment.
Verify `/health`, `/api/config`, sign-in, and an authenticated inbox request.

Password hashing uses Noble as a fallback when hosted Workers rejects the native
PBKDF2 iteration count. The fallback preserves the original 200,000-iteration
SHA-256 hash format, including compatibility with the password-reset script.
Local workerd does not enforce the same native limit, so the unit regression
test simulates the hosted rejection and compares against Node's PBKDF2 output.

Email delivery requires a separately configured mail domain and provider.
The web staging hostname alone does not configure inbound MX records or an
outbound sender domain. Use a dedicated test mail domain when enabling delivery.
