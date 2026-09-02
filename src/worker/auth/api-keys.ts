import { and, eq, isNull } from 'drizzle-orm';
import type { ApiKeyScope } from '../../shared/types';
import type { Db } from '../db/client';
import { apiKeys, users, type ApiKey, type User } from '../db/schema';
import { newId, randomToken, sha256Hex } from '../lib/crypto';

export const API_KEY_PREFIX = 'mc_live_';
export const ALL_SCOPES: ApiKeyScope[] = ['mail:read', 'mail:send', 'mail:write', 'contacts:read', 'admin'];

export async function createApiKey(
  db: Db,
  input: { userId: string; name: string; scopes: ApiKeyScope[]; expiresAt?: Date | null },
): Promise<{ key: ApiKey; secret: string }> {
  const secret = `${API_KEY_PREFIX}${randomToken(32)}`;
  const prefix = secret.slice(0, API_KEY_PREFIX.length + 8);
  const keyHash = await sha256Hex(secret);
  const id = newId();
  await db.insert(apiKeys).values({
    id,
    userId: input.userId,
    name: input.name,
    prefix,
    keyHash,
    scopes: input.scopes,
    expiresAt: input.expiresAt ?? null,
  });
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get())!;
  return { key, secret };
}

export async function verifyApiKey(db: Db, secret: string): Promise<{ key: ApiKey; user: User } | null> {
  if (!secret.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = await sha256Hex(secret);
  const row = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .get();
  if (!row) return null;
  if (row.key.expiresAt && row.key.expiresAt.getTime() < Date.now()) return null;
  if (row.user.disabled || row.user.banned) return null;
  // Best-effort usage stamp; never block the request on it.
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id)).run();
  return row;
}

export function hasScope(scopes: ApiKeyScope[], needed: ApiKeyScope): boolean {
  if (scopes.includes('admin')) return true;
  if (needed === 'mail:read' && scopes.includes('mail:write')) return true;
  return scopes.includes(needed);
}
