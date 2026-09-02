import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach, inject } from 'vitest';

beforeEach(async () => {
  await applyD1Migrations(env.DB, inject('mailcoveMigrations'));
});
