import type { Db } from '../db/client';
import { auditLogs } from '../db/schema';
import { newId } from './crypto';

export type AuditInput = {
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

export async function audit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: newId(),
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    });
  } catch (error) {
    console.error('audit log failed', error);
  }
}
