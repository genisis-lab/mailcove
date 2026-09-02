import { eq } from 'drizzle-orm';
import { MAIL_PROVIDERS, type MailProviderKind } from '../../../shared/types';
import type { Db } from '../../db/client';
import { providerCredentials } from '../../db/schema';
import type { AppEnv } from '../../env';
import { decryptJson, encryptJson } from '../../lib/crypto';
import { CLOUDFLARE_CAPABILITIES, createCloudflareProvider } from './cloudflare';
import { createMailgunProvider, MAILGUN_CAPABILITIES } from './mailgun';
import { createPostmarkProvider, POSTMARK_CAPABILITIES } from './postmark';
import { createResendProvider, RESEND_CAPABILITIES } from './resend';
import { createSendgridProvider, SENDGRID_CAPABILITIES } from './sendgrid';
import type { MailProvider, ProviderCapabilities } from './types';

export const PROVIDER_CAPABILITIES: Record<MailProviderKind, ProviderCapabilities> = {
  cloudflare: CLOUDFLARE_CAPABILITIES,
  resend: RESEND_CAPABILITIES,
  postmark: POSTMARK_CAPABILITIES,
  sendgrid: SENDGRID_CAPABILITIES,
  mailgun: MAILGUN_CAPABILITIES,
};

export type Credentials = Record<string, string | undefined>;

export function isProviderKind(value: unknown): value is MailProviderKind {
  return typeof value === 'string' && (MAIL_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Credentials come from Worker secrets first; anything missing is filled from
 * the encrypted admin-panel store so operators can configure providers without
 * redeploying.
 */
export async function resolveCredentials(env: AppEnv, db: Db, kind: MailProviderKind): Promise<Credentials> {
  const fields = PROVIDER_CAPABILITIES[kind].credentialFields.map((f) => f.name);
  const fromEnv: Credentials = {};
  for (const name of fields) {
    const value = (env as unknown as Record<string, string | undefined>)[name];
    if (value) fromEnv[name] = value;
  }
  if (kind === 'mailgun' && env.MAILGUN_REGION) fromEnv.MAILGUN_REGION = env.MAILGUN_REGION;

  const stored = await loadStoredCredentials(env, db, kind);
  return { ...stored, ...fromEnv };
}

export async function loadStoredCredentials(env: AppEnv, db: Db, kind: MailProviderKind): Promise<Credentials> {
  if (!env.ENCRYPTION_KEY) return {};
  const row = await db.select().from(providerCredentials).where(eq(providerCredentials.provider, kind)).get();
  if (!row) return {};
  try {
    return await decryptJson<Credentials>(env.ENCRYPTION_KEY, row.encrypted);
  } catch (error) {
    console.error(`Failed to decrypt ${kind} credentials`, error);
    return {};
  }
}

export async function storeCredentials(
  env: AppEnv,
  db: Db,
  kind: MailProviderKind,
  values: Credentials,
  userId: string | null,
): Promise<void> {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY secret is required to store provider credentials in the database.');
  }
  const existing = await loadStoredCredentials(env, db, kind);
  const merged: Credentials = { ...existing };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === '') delete merged[key];
    else merged[key] = value;
  }
  const encrypted = await encryptJson(env.ENCRYPTION_KEY, merged);
  await db
    .insert(providerCredentials)
    .values({ provider: kind, encrypted, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: providerCredentials.provider,
      set: { encrypted, updatedByUserId: userId, updatedAt: new Date() },
    });
}

export function buildProvider(env: AppEnv, kind: MailProviderKind, credentials: Credentials): MailProvider {
  switch (kind) {
    case 'cloudflare':
      return createCloudflareProvider(env.EMAIL, credentials);
    case 'resend':
      return createResendProvider(credentials);
    case 'postmark':
      return createPostmarkProvider(credentials);
    case 'sendgrid':
      return createSendgridProvider(credentials);
    case 'mailgun':
      return createMailgunProvider(credentials);
    default: {
      const never: never = kind;
      throw new Error(`Unknown provider ${String(never)}`);
    }
  }
}

export async function getProvider(env: AppEnv, db: Db, kind: MailProviderKind): Promise<MailProvider> {
  const credentials = await resolveCredentials(env, db, kind);
  return buildProvider(env, kind, credentials);
}

export function defaultProviderKind(env: AppEnv): MailProviderKind {
  return isProviderKind(env.DEFAULT_MAIL_PROVIDER) ? env.DEFAULT_MAIL_PROVIDER : 'cloudflare';
}

/** Which credential fields have a value, without exposing secrets. */
export function describeConfiguredFields(kind: MailProviderKind, credentials: Credentials): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const field of PROVIDER_CAPABILITIES[kind].credentialFields) out[field.name] = Boolean(credentials[field.name]);
  return out;
}
