import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { accessibleMailboxes, requireMailbox } from '../auth/access';
import { currentUser, requireScope, requireUser } from '../auth/context';
import { mailboxAliases, mailboxes } from '../db/schema';
import { badRequest, notFound } from '../lib/http';
import { router } from './router';

export const mailboxRoutes = router();
mailboxRoutes.use('*', requireUser);

mailboxRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const rows = await accessibleMailboxes(c.var.db, user);
  const aliases = await c.var.db.select().from(mailboxAliases);
  return c.json({
    items: rows.map((r) => ({
      id: r.mailbox.id,
      address: r.mailbox.address,
      displayName: r.mailbox.displayName,
      type: r.mailbox.type,
      domain: r.domainName,
      permission: r.permission,
      isOwner: r.isOwner,
      signatureHtml: r.mailbox.signatureHtml,
      vacation: r.mailbox.vacation,
      disabled: r.mailbox.disabled,
      aliases: aliases.filter((a) => a.mailboxId === r.mailbox.id).map((a) => a.address),
      avatarUrl: r.mailbox.avatarKey ? `/api/mailboxes/${r.mailbox.id}/avatar` : null,
    })),
  });
});

const vacationSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().max(200).default(''),
  bodyHtml: z.string().max(50_000).default(''),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  contactsOnly: z.boolean().optional(),
});

mailboxRoutes.patch(
  '/:id',
  requireScope('mail:write'),
  zValidator('json', z.object({ displayName: z.string().trim().max(120).nullable().optional(), signatureHtml: z.string().max(50_000).nullable().optional(), vacation: vacationSchema.nullable().optional() })),
  async (c) => {
    const user = currentUser(c);
    const mailbox = await requireMailbox(c.var.db, user, c.req.param('id'), 'full_access');
    const body = c.req.valid('json');
    await c.var.db
      .update(mailboxes)
      .set({
        displayName: body.displayName === undefined ? mailbox.displayName : body.displayName,
        signatureHtml: body.signatureHtml === undefined ? mailbox.signatureHtml : body.signatureHtml,
        vacation: body.vacation === undefined ? mailbox.vacation : body.vacation,
      })
      .where(eq(mailboxes.id, mailbox.id));
    return c.json({ mailbox: await c.var.db.select().from(mailboxes).where(eq(mailboxes.id, mailbox.id)).get() });
  },
);

mailboxRoutes.get('/:id/avatar', async (c) => {
  const user = currentUser(c);
  const mailbox = await requireMailbox(c.var.db, user, c.req.param('id'));
  if (!mailbox.avatarKey) throw notFound('Avatar');
  const object = await c.env.STORAGE.get(mailbox.avatarKey);
  if (!object) throw notFound('Avatar');
  return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'image/png', 'Cache-Control': 'private, max-age=3600' } });
});

mailboxRoutes.post('/:id/avatar', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  const mailbox = await requireMailbox(c.var.db, user, c.req.param('id'), 'full_access');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('file_required');
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw badRequest('unsupported_type');
  if (file.size > 2 * 1024 * 1024) throw badRequest('too_large', 'Avatar must be under 2 MB.');
  const key = `avatars/mailboxes/${mailbox.id}/${Date.now()}`;
  await c.env.STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (mailbox.avatarKey) await c.env.STORAGE.delete(mailbox.avatarKey).catch(() => undefined);
  await c.var.db.update(mailboxes).set({ avatarKey: key }).where(eq(mailboxes.id, mailbox.id));
  return c.json({ avatarUrl: `/api/mailboxes/${mailbox.id}/avatar?v=${Date.now()}` });
});
