import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attachments, messages, type Attachment, type Message } from '../db/schema';
import { newId } from '../lib/crypto';
import type { ParsedAttachment } from './providers/types';

export const MAX_BODY_BYTES = 256 * 1024;

export function safeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'attachment').slice(0, 180);
}

export function rawKey(messageId: string, date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `raw/${yyyy}/${mm}/${messageId}.eml`;
}

export function attachmentKey(messageId: string, attachmentId: string, filename: string): string {
  return `attachments/${messageId}/${attachmentId}/${encodeURIComponent(safeFilename(filename))}`;
}

export function uploadKey(userId: string, attachmentId: string, filename: string): string {
  return `uploads/${userId}/${attachmentId}/${encodeURIComponent(safeFilename(filename))}`;
}

export async function storeRaw(bucket: R2Bucket, key: string, raw: Uint8Array | ReadableStream<Uint8Array>, meta: Record<string, string> = {}): Promise<void> {
  await bucket.put(key, raw as ReadableStream<Uint8Array> | Uint8Array, {
    httpMetadata: { contentType: 'message/rfc822' },
    customMetadata: meta,
  });
}

export async function storeAttachments(
  db: Db,
  bucket: R2Bucket,
  messageId: string,
  files: ParsedAttachment[],
): Promise<Attachment[]> {
  const stored: Attachment[] = [];
  for (const file of files) {
    const id = newId();
    const key = attachmentKey(messageId, id, file.filename);
    await bucket.put(key, file.content as Uint8Array<ArrayBuffer>, {
      httpMetadata: { contentType: file.contentType || 'application/octet-stream' },
      customMetadata: { filename: file.filename.slice(0, 500) },
    });
    await db.insert(attachments).values({
      id,
      messageId,
      filename: file.filename.slice(0, 500),
      contentType: file.contentType || 'application/octet-stream',
      sizeBytes: file.content.byteLength,
      disposition: file.disposition,
      contentId: file.contentId ?? null,
      r2Key: key,
    });
    const row = await db.select().from(attachments).where(eq(attachments.id, id)).get();
    if (row) stored.push(row);
  }
  return stored;
}

export async function deleteMessageObjects(db: Db, bucket: R2Bucket, message: Pick<Message, 'id' | 'rawR2Key'>): Promise<void> {
  const rows = await db.select({ key: attachments.r2Key }).from(attachments).where(eq(attachments.messageId, message.id));
  const keys = rows.map((r) => r.key);
  if (message.rawR2Key) keys.push(message.rawR2Key);
  if (keys.length) {
    try {
      await bucket.delete(keys);
    } catch (error) {
      console.warn('R2 delete failed', error);
    }
  }
}

export async function loadAttachment(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
}

export async function messageById(db: Db, id: string): Promise<Message | undefined> {
  return db.select().from(messages).where(eq(messages.id, id)).get();
}
