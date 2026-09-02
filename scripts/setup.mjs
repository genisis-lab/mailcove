#!/usr/bin/env node
/**
 * Provisions Mailcove Cloudflare resources and a local .dev.vars file.
 *
 *   node scripts/setup.mjs              local secrets + D1 migrations
 *   node scripts/setup.mjs --execute    also create remote D1 / R2 / queues
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = process.argv.includes('--execute');
const wranglerJson = resolve(root, 'wrangler.jsonc');
const devVars = resolve(root, '.dev.vars');
const example = resolve(root, '.dev.vars.example');

function run(bin, args, opts = {}) {
  return execFileSync(bin, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function ensureDevVars() {
  if (!existsSync(devVars)) {
    writeFileSync(devVars, existsSync(example) ? readFileSync(example, 'utf8') : '');
  }
  let text = readFileSync(devVars, 'utf8');
  const set = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) {
      const current = text.match(re)?.[0]?.slice(key.length + 1) ?? '';
      if (current.trim()) return current.trim();
      text = text.replace(re, `${key}=${value}`);
    } else {
      text += `\n${key}=${value}\n`;
    }
    return value;
  };
  const auth = set('AUTH_SECRET', randomBytes(48).toString('base64'));
  const enc = set('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  writeFileSync(devVars, text);
  console.log(`Wrote ${devVars}`);
  console.log(`  AUTH_SECRET length ${auth.length}, ENCRYPTION_KEY length ${enc.length}`);
}

function applyLocalMigrations() {
  console.log('Applying local D1 migrations…');
  const out = run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'mailcove', '--local'], {
    stdio: 'inherit',
  });
  return out;
}

function patchDatabaseId(id) {
  const src = readFileSync(wranglerJson, 'utf8');
  if (src.includes(id)) {
    console.log(`wrangler.jsonc already has database_id ${id}`);
    return;
  }
  const next = src.replace(/"database_id":\s*"[^"]+"/, `"database_id": "${id}"`);
  if (next === src) throw new Error('Could not find database_id in wrangler.jsonc');
  writeFileSync(wranglerJson, next);
  console.log(`Updated wrangler.jsonc database_id → ${id}`);
}

function parseDatabaseId(output) {
  const uuid = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid?.[0] ?? null;
}

function createRemote() {
  console.log('\nCreating remote Cloudflare resources (requires wrangler login)…\n');
  const created = run('npx', ['wrangler', 'd1', 'create', 'mailcove']);
  process.stdout.write(created);
  const id = parseDatabaseId(created);
  if (!id) throw new Error('D1 create succeeded but no database id was parsed from wrangler output');
  patchDatabaseId(id);

  for (const args of [
    ['wrangler', 'r2', 'bucket', 'create', 'mailcove-storage'],
    ['wrangler', 'queues', 'create', 'mailcove-inbound'],
    ['wrangler', 'queues', 'create', 'mailcove-outbound'],
    ['wrangler', 'queues', 'create', 'mailcove-dlq'],
  ]) {
    try {
      process.stdout.write(run('npx', args));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/already exists|code: 1003/i.test(msg + (error.stderr ?? ''))) {
        console.log(`  (already exists) ${args.slice(-1)}`);
        continue;
      }
      throw error;
    }
  }

  console.log('\nApplying remote D1 migrations…');
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'mailcove', '--remote'], { stdio: 'inherit' });
}

ensureDevVars();
applyLocalMigrations();

if (execute) {
  createRemote();
  console.log(`
Remote resources are ready. Next:

  npx wrangler secret put AUTH_SECRET
  npx wrangler secret put ENCRYPTION_KEY
  # plus any provider secrets — see .dev.vars.example
  npm run deploy
`);
} else {
  console.log(`
Local setup is ready. Start the app with:

  npm run dev

To also create D1 / R2 / queues on your Cloudflare account:

  npm run setup -- --execute
`);
}
