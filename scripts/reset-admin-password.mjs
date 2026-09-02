#!/usr/bin/env node
/**
 * Reset a user's password in D1 using the same PBKDF2-SHA256 scheme as the Worker.
 *
 *   node scripts/reset-admin-password.mjs admin@example.com 'new-password'
 *   node scripts/reset-admin-password.mjs admin@example.com 'new-password' --remote
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 200_000;
const KEY_BYTES = 32;
const CREDENTIAL_ISSUER = 'local:credential';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => a !== '--');
const remote = args.includes('--remote');
const positional = args.filter((a) => !a.startsWith('--'));
const email = positional[0]?.trim().toLowerCase();
const password = positional[1];

if (!email || !password) {
  console.error('Usage: node scripts/reset-admin-password.mjs <email> <new-password> [--remote]');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Refusing to run: email does not look valid.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Password must be at least 10 characters (same rule as the app).');
  process.exit(1);
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashPassword(value) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    KEY_BYTES * 8,
  );
  return `pbkdf2$${ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(new Uint8Array(bits))}`;
}

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function d1(command) {
  const extra = remote ? ['--remote'] : ['--local'];
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'mailcove', ...extra, '--json', '--command', command], {
    cwd: root,
    encoding: 'utf8',
  });
  return JSON.parse(raw);
}

const hash = await hashPassword(password);
const lookup = d1(`SELECT id, email, role FROM user WHERE email = ${sqlString(email)} LIMIT 1`);
const user = lookup[0]?.results?.[0];
if (!user?.id) {
  console.error(`No user with email ${email} in the ${remote ? 'remote' : 'local'} database.`);
  process.exit(2);
}

d1(`UPDATE account SET password = ${sqlString(hash)}, updated_at = cast(unixepoch('subsecond') * 1000 as integer)
    WHERE user_id = ${sqlString(user.id)} AND provider_id = 'credential'`);

const existing = d1(
  `SELECT id FROM account WHERE user_id = ${sqlString(user.id)} AND provider_id = 'credential' LIMIT 1`,
);
if (!existing[0]?.results?.[0]?.id) {
  const id = crypto.randomUUID();
  d1(`INSERT INTO account (id, issuer, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (${sqlString(id)}, ${sqlString(CREDENTIAL_ISSUER)}, ${sqlString(user.id)}, 'credential', ${sqlString(user.id)}, ${sqlString(hash)},
              cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer))`);
}

d1(`DELETE FROM session WHERE user_id = ${sqlString(user.id)}`);

console.log(`Password updated for ${user.email} (${user.role ?? 'user'}) on ${remote ? 'remote' : 'local'} D1.`);
console.log('Existing sessions for that user were revoked.');
