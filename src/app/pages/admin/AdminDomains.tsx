import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAIL_PROVIDERS, MAILBOX_PERMISSIONS, type MailProviderKind } from '@shared/types';
import { CheckCircle2, ChevronDown, Globe, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, ConfirmDialog, Dialog, Field, IconButton, Input, SectionCard, Select, Switch } from '../../components/ui';
import { del, get, patch, post, put } from '../../lib/api';
import { cn, formatBytes, formatRelative } from '../../lib/utils';
import { DnsRecordsTable, type DomainRow as WizardDomain } from '../SetupPage';

type Domain = WizardDomain & {
  sendingEnabled: boolean;
  receivingEnabled: boolean;
  catchallMailboxId: string | null;
  unknownRecipientPolicy: 'unrouted' | 'reject';
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  mailboxCount: number;
  createdAt: string;
};

type MailboxRow = {
  id: string;
  address: string;
  localPart: string;
  domainId: string;
  domainName: string;
  displayName: string | null;
  type: 'personal' | 'shared';
  disabled: boolean;
  owner: { id: string; name: string | null; email: string | null } | null;
  aliases: Array<{ id: string; address: string }>;
  access: Array<{ userId: string; permission: string; name: string; email: string }>;
  messageCount: number;
  storageBytes: number;
  lastMessageAt: number | null;
};

type UserRow = { id: string; name: string; email: string };

const useDomains = () => useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<{ items: Domain[]; defaultProvider: MailProviderKind }>('/api/admin/domains') });
const useMailboxes = () => useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<{ items: MailboxRow[] }>('/api/admin/mailboxes') });
const useUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<{ items: UserRow[] }>('/api/admin/users') });

export function AdminDomains() {
  const qc = useQueryClient();
  const domains = useDomains();
  const mailboxes = useMailboxes();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [deleting, setDeleting] = useState<Domain | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'domains'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const verify = useMutation({
    mutationFn: (id: string) => post<{ notes: string[] }>(`/api/admin/domains/${id}/verify`),
    onSuccess: (data, id) => {
      setNotes((n) => ({ ...n, [id]: data.notes }));
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Verification failed'),
  });
  const provision = useMutation({
    mutationFn: (id: string) => post<{ notes: string[] }>(`/api/admin/domains/${id}/provision`),
    onSuccess: (data, id) => {
      setNotes((n) => ({ ...n, [id]: data.notes }));
      toast.success('Provider setup re-run');
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Provisioning failed'),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/api/admin/domains/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });
  const remove = useMutation({
    mutationFn: (d: Domain) => del(`/api/admin/domains/${d.id}?force=1`),
    onSuccess: () => {
      toast.success('Domain removed');
      setDeleting(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  return (
    <>
      <SectionCard
        title="Domains"
        description="Each domain is served by one provider. Mailcove keeps DNS status current and shows what still needs attention."
        actions={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add domain
          </Button>
        }
      >
        <ul className="divide-y">
          {(domains.data?.items ?? []).map((d) => {
            const open = expanded === d.id;
            const domainMailboxes = (mailboxes.data?.items ?? []).filter((m) => m.domainId === d.id);
            return (
              <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(open ? null : d.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.name}</span>
                      <Badge>{d.provider}</Badge>
                      <Badge className={d.status === 'verified' ? 'bg-success/15 text-success' : d.status === 'failed' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'}>{d.status}</Badge>
                      {d.receivingEnabled && <Badge className="bg-success/15 text-success">receiving</Badge>}
                      {d.sendingEnabled && <Badge className="bg-success/15 text-success">sending</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {d.mailboxCount} mailbox{d.mailboxCount === 1 ? '' : 'es'}
                      {d.lastCheckedAt ? ` · checked ${formatRelative(d.lastCheckedAt)}` : ''}
                      {d.lastError && <span className="text-danger"> · {d.lastError}</span>}
                    </div>
                  </button>
                  <Button size="sm" onClick={() => verify.mutate(d.id)} loading={verify.isPending && verify.variables === d.id}>
                    <RefreshCw className="h-3.5 w-3.5" /> Re-check
                  </Button>
                  <IconButton label={open ? 'Collapse' : 'Expand'} onClick={() => setExpanded(open ? null : d.id)}>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
                  </IconButton>
                </div>
                {open && (
                  <div className="mt-4 space-y-4 pl-8 fade-in">
                    {notes[d.id]?.length ? (
                      <ul className="space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-xs">
                        {notes[d.id]!.map((n, i) => (
                          <li key={i}>• {n}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted">DNS records</div>
                      <DnsRecordsTable records={d.dnsRecords} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Catch-all mailbox" hint="Receives mail for addresses that don't exist.">
                        <Select value={d.catchallMailboxId ?? ''} onChange={(e) => update.mutate({ id: d.id, body: { catchallMailboxId: e.target.value || null } })}>
                          <option value="">None</option>
                          {domainMailboxes.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.address}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Unknown recipients" hint="When there is no mailbox and no catch-all.">
                        <Select value={d.unknownRecipientPolicy} onChange={(e) => update.mutate({ id: d.id, body: { unknownRecipientPolicy: e.target.value } })}>
                          <option value="unrouted">Keep in Unrouted mail</option>
                          <option value="reject">Reject at SMTP (bounce)</option>
                        </Select>
                      </Field>
                      <Field label="Provider">
                        <Select value={d.provider} onChange={(e) => update.mutate({ id: d.id, body: { provider: e.target.value } })}>
                          {MAIL_PROVIDERS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => provision.mutate(d.id)} loading={provision.isPending}>
                        Re-run provider setup
                      </Button>
                      <Button size="sm" onClick={() => update.mutate({ id: d.id, body: { status: 'verified', sendingEnabled: true, receivingEnabled: true } })}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark verified manually
                      </Button>
                      <Button size="sm" variant="danger" className="ml-auto" onClick={() => setDeleting(d)}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove domain
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {domains.data?.items.length === 0 && <li className="py-8 text-center text-sm text-muted">No domains connected yet.</li>}
        </ul>
      </SectionCard>
      {adding && <AddDomainDialog defaultProvider={domains.data?.defaultProvider ?? 'cloudflare'} onClose={() => setAdding(false)} onCreated={(id, n) => { setNotes((x) => ({ ...x, [id]: n })); setExpanded(id); refresh(); }} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        description={`This deletes ${deleting?.mailboxCount ?? 0} mailbox(es) and all their mail. Provider configuration (DNS, routing) is left in place.`}
        confirmLabel="Remove domain and mail"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}

function AddDomainDialog({ defaultProvider, onClose, onCreated }: { defaultProvider: MailProviderKind; onClose: () => void; onCreated: (id: string, notes: string[]) => void }) {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<MailProviderKind>(defaultProvider);
  const [manual, setManual] = useState(false);
  const add = useMutation({
    mutationFn: () => post<{ domain: { id: string }; notes: string[] }>('/api/admin/domains', { name, provider, manual }),
    onSuccess: (data) => {
      toast.success(`Added ${name}`);
      onCreated(data.domain.id, data.notes);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add domain'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add domain"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => add.mutate()} loading={add.isPending} disabled={!name}>
            Add domain
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Domain">
          <Input value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} placeholder="example.com" autoFocus />
        </Field>
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value as MailProviderKind)}>
            {MAIL_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            Manual setup — skip provider API calls. <span className="text-muted">Use this when you configure DNS and routing yourself.</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

export function AdminMailboxes() {
  const qc = useQueryClient();
  const mailboxes = useMailboxes();
  const domains = useDomains();
  const users = useUsers();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MailboxRow | null>(null);
  const [deleting, setDeleting] = useState<MailboxRow | null>(null);
  const [filter, setFilter] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'domains'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/admin/mailboxes/${id}`),
    onSuccess: () => {
      toast.success('Mailbox deleted');
      setDeleting(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });
  const items = (mailboxes.data?.items ?? []).filter((m) => !filter || m.address.includes(filter.toLowerCase()) || (m.owner?.email ?? '').includes(filter.toLowerCase()));

  return (
    <>
      <SectionCard
        title="Mailboxes"
        description="Addresses that receive mail. Personal mailboxes belong to one user; shared mailboxes can be delegated to several."
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)} disabled={!domains.data?.items.length}>
            <Plus className="h-4 w-4" /> New mailbox
          </Button>
        }
      >
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by address or owner…" className="mb-3 max-w-sm" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-faint">
              <tr>
                <th className="py-2 font-medium">Address</th>
                <th className="py-2 font-medium">Owner</th>
                <th className="py-2 font-medium">Messages</th>
                <th className="py-2 font-medium">Storage</th>
                <th className="py-2 font-medium">Last mail</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((m) => (
                <tr key={m.id} className={m.disabled ? 'opacity-60' : ''}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      {m.address}
                      {m.type === 'shared' && (
                        <Badge>
                          <Users className="mr-1 h-3 w-3" /> shared
                        </Badge>
                      )}
                      {m.disabled && <Badge className="bg-danger/15 text-danger">disabled</Badge>}
                    </div>
                    {m.aliases.length > 0 && <div className="text-xs text-muted">aliases: {m.aliases.map((a) => a.address).join(', ')}</div>}
                    {m.access.length > 0 && <div className="text-xs text-muted">shared with {m.access.map((a) => a.name).join(', ')}</div>}
                  </td>
                  <td className="py-2.5 text-muted">{m.owner ? m.owner.name || m.owner.email : <span className="text-warning">unassigned</span>}</td>
                  <td className="py-2.5">{m.messageCount.toLocaleString()}</td>
                  <td className="py-2.5 text-muted">{formatBytes(m.storageBytes)}</td>
                  <td className="py-2.5 text-muted">{m.lastMessageAt ? formatRelative(new Date(m.lastMessageAt)) : '—'}</td>
                  <td className="py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
                    {domains.data?.items.length ? 'No mailboxes yet.' : 'Add a domain first.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      {creating && <MailboxDialog domains={domains.data?.items ?? []} users={users.data?.items ?? []} onClose={() => setCreating(false)} onSaved={refresh} />}
      {editing && <MailboxDialog mailbox={editing} domains={domains.data?.items ?? []} users={users.data?.items ?? []} onClose={() => setEditing(null)} onSaved={refresh} onDelete={() => { setDeleting(editing); setEditing(null); }} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.address}?`}
        description={`All ${deleting?.messageCount ?? 0} messages and attachments in this mailbox are permanently deleted.`}
        confirmLabel="Delete mailbox"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

function MailboxDialog({ mailbox, domains, users, onClose, onSaved, onDelete }: { mailbox?: MailboxRow; domains: Domain[]; users: UserRow[]; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [domainId, setDomainId] = useState(mailbox?.domainId ?? domains[0]?.id ?? '');
  const [localPart, setLocalPart] = useState(mailbox?.localPart ?? '');
  const [displayName, setDisplayName] = useState(mailbox?.displayName ?? '');
  const [type, setType] = useState<'personal' | 'shared'>(mailbox?.type ?? 'personal');
  const [ownerUserId, setOwnerUserId] = useState(mailbox?.owner?.id ?? '');
  const [disabled, setDisabled] = useState(mailbox?.disabled ?? false);
  const [alias, setAlias] = useState('');
  const [accessUser, setAccessUser] = useState('');
  const [accessPermission, setAccessPermission] = useState<string>('full_access');
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });

  const save = useMutation({
    mutationFn: () =>
      mailbox
        ? patch(`/api/admin/mailboxes/${mailbox.id}`, { displayName: displayName || null, type, ownerUserId: ownerUserId || null, disabled })
        : post('/api/admin/mailboxes', { domainId, localPart, displayName: displayName || null, type, ownerUserId: ownerUserId || null }),
    onSuccess: () => {
      toast.success(mailbox ? 'Mailbox updated' : 'Mailbox created');
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  const addAlias = useMutation({
    mutationFn: () => post(`/api/admin/mailboxes/${mailbox!.id}/aliases`, { address: alias }),
    onSuccess: () => {
      setAlias('');
      refresh();
      toast.success('Alias added');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add alias'),
  });
  const removeAlias = useMutation({ mutationFn: (id: string) => del(`/api/admin/mailboxes/${mailbox!.id}/aliases/${id}`), onSuccess: refresh });
  const grant = useMutation({
    mutationFn: () => put(`/api/admin/mailboxes/${mailbox!.id}/access`, { userId: accessUser, permission: accessPermission }),
    onSuccess: () => {
      setAccessUser('');
      refresh();
      toast.success('Access granted');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not grant access'),
  });
  const revoke = useMutation({ mutationFn: (userId: string) => del(`/api/admin/mailboxes/${mailbox!.id}/access/${userId}`), onSuccess: refresh });

  const domainName = domains.find((d) => d.id === domainId)?.name ?? '';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mailbox ? mailbox.address : 'New mailbox'}
      size="lg"
      footer={
        <>
          {onDelete && (
            <Button variant="danger" onClick={onDelete} className="mr-auto">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!mailbox && (!localPart || !domainId)}>
            {mailbox ? 'Save' : 'Create mailbox'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!mailbox && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="Address">
              <Input value={localPart} onChange={(e) => setLocalPart(e.target.value.toLowerCase())} placeholder="support" autoFocus />
            </Field>
            <div className="hidden items-end pb-2 text-muted sm:flex">@</div>
            <Field label="Domain">
              <Select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            {localPart && domainName && (
              <p className="text-xs text-muted sm:col-span-3">
                Address: <span className="font-medium text-text">{localPart}@{domainName}</span>
              </p>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Support team" />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as 'personal' | 'shared')}>
              <option value="personal">Personal</option>
              <option value="shared">Shared</option>
            </Select>
          </Field>
          <Field label="Owner" hint="The owner's filters, labels and blocked senders apply to incoming mail.">
            <Select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </Field>
          {mailbox && (
            <div className="flex items-end justify-between rounded-lg border px-3 py-2">
              <span className="text-sm">Disabled (rejects incoming mail)</span>
              <Switch checked={disabled} onCheckedChange={setDisabled} />
            </div>
          )}
        </div>

        {mailbox && (
          <>
            <div className="rounded-xl border p-4">
              <div className="mb-2 text-sm font-medium">Aliases</div>
              <p className="mb-3 text-xs text-muted">Extra addresses (on any connected domain) that deliver into this mailbox and can be used as From.</p>
              <ul className="mb-3 space-y-1">
                {mailbox.aliases.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                    <span className="font-mono text-xs">{a.address}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeAlias.mutate(a.id)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (alias) addAlias.mutate();
                }}
              >
                <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={`hello@${mailbox.domainName}`} />
                <Button type="submit" size="sm" loading={addAlias.isPending}>
                  Add alias
                </Button>
              </form>
            </div>
            <div className="rounded-xl border p-4">
              <div className="mb-2 text-sm font-medium">Delegated access</div>
              <p className="mb-3 text-xs text-muted">Let other users read, send as, or fully manage this mailbox.</p>
              <ul className="mb-3 space-y-1">
                {mailbox.access.map((a) => (
                  <li key={a.userId} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                    <span>
                      {a.name} <span className="text-xs text-muted">({a.email})</span> <Badge>{a.permission.replace('_', ' ')}</Badge>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(a.userId)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (accessUser) grant.mutate();
                }}
              >
                <Select value={accessUser} onChange={(e) => setAccessUser(e.target.value)} className="min-w-52 flex-1">
                  <option value="">Choose a user…</option>
                  {users.filter((u) => u.id !== mailbox.owner?.id).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </Select>
                <Select value={accessPermission} onChange={(e) => setAccessPermission(e.target.value)} className="w-40">
                  {MAILBOX_PERMISSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" loading={grant.isPending} disabled={!accessUser}>
                  Grant
                </Button>
              </form>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
