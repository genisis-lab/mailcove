import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Vacation } from '@shared/types';
import { Mailbox, Palmtree } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Editor, type EditorHandle } from '../../components/Editor';
import { Avatar, Badge, Button, Dialog, Field, Input, SectionCard, Switch, upload as _u } from './shared';
import { patch } from '../../lib/api';
import { useApp } from '../../lib/app-state';
import { keys } from '../../lib/queries';
import type { MailboxSummary } from '../../lib/types';

export function AccountsSettings() {
  const { me } = useApp();
  const [editing, setEditing] = useState<MailboxSummary | null>(null);
  const mailboxes = me?.mailboxes ?? [];
  return (
    <>
      <SectionCard title="Your mailboxes" description="Addresses you can read and send from. Administrators add new addresses and aliases.">
        <ul className="divide-y">
          {mailboxes.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar email={m.address} name={m.displayName} src={m.avatarUrl} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {m.displayName || m.address}
                  {m.type === 'shared' && <Badge>shared</Badge>}
                  {m.permission !== 'full_access' && <Badge>{m.permission.replace('_', ' ')}</Badge>}
                  {m.vacation?.enabled && (
                    <Badge className="bg-warning/15 text-warning">
                      <Palmtree className="mr-1 h-3 w-3" /> auto-reply on
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {m.address}
                  {m.aliases?.length ? ` · aliases: ${m.aliases.join(', ')}` : ''}
                </div>
              </div>
              <Button size="sm" onClick={() => setEditing(m)} disabled={m.permission !== 'full_access'}>
                Edit
              </Button>
            </li>
          ))}
          {mailboxes.length === 0 && (
            <li className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
              <Mailbox className="h-8 w-8 text-faint" />
              You don&apos;t have a mailbox yet. Ask an administrator to create one for you.
            </li>
          )}
        </ul>
      </SectionCard>
      {editing && <MailboxDialog mailbox={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MailboxDialog({ mailbox, onClose }: { mailbox: MailboxSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(mailbox.displayName ?? '');
  const [vacation, setVacation] = useState<Vacation>(mailbox.vacation ?? { enabled: false, subject: '', bodyHtml: '', startsAt: null, endsAt: null, contactsOnly: false });
  const signatureRef = useRef<EditorHandle>(null);
  const vacationRef = useRef<EditorHandle>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      patch(`/api/mailboxes/${mailbox.id}`, {
        displayName: displayName || null,
        signatureHtml: signatureRef.current?.getText().trim() ? signatureRef.current.getHtml() : null,
        vacation: { ...vacation, bodyHtml: vacationRef.current?.getHtml() ?? vacation.bodyHtml },
      }),
    onSuccess: () => {
      toast.success('Mailbox updated');
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.mailboxes });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });

  async function onAvatar(file: File) {
    setAvatarBusy(true);
    try {
      await _u(`/api/mailboxes/${mailbox.id}/avatar`, file);
      void qc.invalidateQueries({ queryKey: keys.me });
      toast.success('Avatar updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mailbox.address}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar email={mailbox.address} name={displayName || mailbox.displayName} src={mailbox.avatarUrl} size={56} />
          <label className="btn btn-secondary cursor-pointer">
            {avatarBusy ? 'Uploading…' : 'Change picture'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void onAvatar(e.target.files[0])} />
          </label>
        </div>
        <Field label="Display name" hint="Shown as the sender name on outgoing mail.">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" />
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Signature</div>
          <div className="rounded-lg border px-2 pb-1">
            <Editor ref={signatureRef} initialHtml={mailbox.signatureHtml ?? ''} placeholder="— Jane" minHeight={90} />
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Palmtree className="h-4 w-4 text-muted" /> Vacation responder
              </div>
              <div className="text-xs text-muted">Automatically reply to incoming mail (at most once per sender every 24 hours).</div>
            </div>
            <Switch checked={vacation.enabled} onCheckedChange={(v) => setVacation({ ...vacation, enabled: v })} />
          </div>
          {vacation.enabled && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First day">
                  <Input type="date" value={vacation.startsAt?.slice(0, 10) ?? ''} onChange={(e) => setVacation({ ...vacation, startsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </Field>
                <Field label="Last day (optional)">
                  <Input type="date" value={vacation.endsAt?.slice(0, 10) ?? ''} onChange={(e) => setVacation({ ...vacation, endsAt: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })} />
                </Field>
              </div>
              <Field label="Subject" hint="Leave empty to reply with “Re: <original subject>”.">
                <Input value={vacation.subject} onChange={(e) => setVacation({ ...vacation, subject: e.target.value })} placeholder="Out of office" />
              </Field>
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Message</div>
                <div className="rounded-lg border px-2 pb-1">
                  <Editor ref={vacationRef} initialHtml={vacation.bodyHtml} placeholder="Thanks for your message. I'm away until…" minHeight={100} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={vacation.contactsOnly ?? false} onChange={(e) => setVacation({ ...vacation, contactsOnly: e.target.checked })} className="accent-[var(--accent)]" />
                Only reply to people in my contacts
              </label>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
