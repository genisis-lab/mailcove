import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'drizzle'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          AUTH_SECRET: 'integration-auth-secret-at-least-32-bytes!!',
          ENCRYPTION_KEY: 'q8G3m1nQ6yD4kL0vX9wB2sT5rJ7hF1cZ8pM4aN6eU3I=',
          APP_NAME: 'Mailcove',
          APP_BASE_URL: 'http://localhost:5173',
          EMAIL_WORKER_NAME: 'mailcove',
          DEFAULT_MAIL_PROVIDER: 'cloudflare',
          UNDO_SEND_SECONDS: '10',
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    provide: { mailcoveMigrations: migrations },
  },
});

declare module 'vitest' {
  export interface ProvidedContext {
    mailcoveMigrations: Awaited<ReturnType<typeof readD1Migrations>>;
  }
}
