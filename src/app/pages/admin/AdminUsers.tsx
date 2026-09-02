import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Shield, ShieldOff, Trash2, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, SectionCard, Select } from '../../components/ui';
import { del, get, patch, post } from '../../lib/api';
import { useApp } from '../../lib/app-state';
import { formatBytes, formatRelative } from '../../lib/utils';

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  mailboxCount: number;
  sessionCount: number;
  storageBytes: number;
};

type DomainRow = { id: string; name: string };

export function AdminUsers() {
  const qc = useQueryClient();
  const { me } = useApp();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<{ items: AdminUser[] }>('/api/admin/users') });
  const domains = useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<{ items: DomainRow[] }>('/api/admin/domains') });
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [deleteFor, setDeleteFor] = useState<AdminUser | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/api/admin/users/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/api/admin/users/${id}/revoke-sessions`), onSuccess: () => toast.success('Sessions revoked') });
  const disable2fa = useMutation({ mutationFn: (id: string) => post(`/api/admin/users/${id}/disable-2fa`), onSuccess: () => { toast.success('Two-step verification disabled'); refresh(); } });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/admin/users/${id}`),
    onSuccess: () => {
      toast.success('User deleted; their mailboxes are now unassigned');
      setDeleteFor(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  return (
    <>
      <SectionCard
        title="Users"
        description="People who can sign in. Each user can own several mailboxes and be granted access to shared ones."
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-faint">
              <tr>
                <th className="py-2 font-medium">User</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Mailboxes</th>
                <th className="py-2 font-medium">Storage</th>
                <th className="py-2 font-medium">Joined</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(users.data?.items ?? []).map((u) => (
                <tr key={u.id} className={u.disabled ? 'opacity-60' : ''}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} email={u.email} size={32} />
                      <div>
                        <div className="flex items-center gap-2 font-medium">
                          {u.name} {u.id === me?.user.id && <Badge>you</Badge>} {u.disabled && <Badge className="bg-danger/15 text-danger">disabled</Badge>}
                          {u.twoFactorEnabled && <Shield className="h-3.5 w-3.5 text-success" />}
                        </div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <Select value={u.role} onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })} className="h-8 w-28 text-xs" disabled={u.id === me?.user.id}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </Select>
                  </td>
                  <td className="py-2.5">{u.mailboxCount}</td>
                  <td className="py-2.5 text-muted">{formatBytes(u.storageBytes)}</td>
                  <td className="py-2.5 text-muted">{formatRelative(u.createdAt)}</td>
                  <td className="py-2.5 text-right">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          Manage
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem onSelect={() => setResetFor(u)}>
                          <KeyRound className="h-4 w-4 text-muted" /> Reset password
                        </MenuItem>
                        <MenuItem onSelect={() => revoke.mutate(u.id)}>Sign out everywhere ({u.sessionCount})</MenuItem>
                        {u.twoFactorEnabled && (
                          <MenuItem onSelect={() => disable2fa.mutate(u.id)}>
                            <ShieldOff className="h-4 w-4 text-muted" /> Disable two-step verification
                          </MenuItem>
                        )}
                        <MenuSeparator />
                        <MenuItem onSelect={() => update.mutate({ id: u.id, body: { disabled: !u.disabled } })} disabled={u.id === me?.user.id}>
                          <UserX className="h-4 w-4 text-muted" /> {u.disabled ? 'Enable account' : 'Disable account'}
                        </MenuItem>
                        <MenuItem danger onSelect={() => setDeleteFor(u)} disabled={u.id === me?.user.id}>
                          <Trash2 className="h-4 w-4" /> Delete user
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {creating && <CreateUserDialog domains={domains.data?.items ?? []} onClose={() => setCreating(false)} onCreated={refresh} />}
      {resetFor && <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />}
      <ConfirmDialog
        open={Boolean(deleteFor)}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title={`Delete ${deleteFor?.name}?`}
        description="Their sign-in is removed immediately. Mailboxes they own are kept and become unassigned so no mail is lost."
        confirmLabel="Delete user"
        danger
        loading={remove.isPending}
        onConfirm={() => deleteFor && remove.mutate(deleteFor.id)}
      />
    </>
  );
}

function CreateUserDialog({ domains, onClose, onCreated }: { domains: DomainRow[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => crypto.randomUUID().replace(/-/g, '').slice(0, 16));
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [createMailbox, setCreateMailbox] = useState(domains.length > 0);
  const [localPart, setLocalPart] = useState('');
  const [domain, setDomain] = useState(domains[0]?.name ?? '');
  const create = useMutation({
    mutationFn: () =>
      post('/api/admin/users', {
        name,
        email,
        password,
        role,
        mailboxAddress: createMailbox && localPart && domain ? `${localPart}@${domain}` : null,
        mailboxDisplayName: name,
      }),
    onSuccess: () => {
      toast.success(`Created ${name}. Share the temporary password securely.`);
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create user'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add user"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!name || !email || password.length < 10}>
            Create user
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => { setName(e.target.value); if (!localPart) setLocalPart(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')); }} autoFocus />
        </Field>
        <Field label="Sign-in email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Temporary password" hint="At least 10 characters. Ask the user to change it after signing in.">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </Select>
        </Field>
        {domains.length > 0 && (
          <div className="rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createMailbox} onChange={(e) => setCreateMailbox(e.target.checked)} className="accent-[var(--accent)]" />
              Create a mailbox for this user
            </label>
            {createMailbox && (
              <div className="mt-3 flex items-center gap-2">
                <Input value={localPart} onChange={(e) => setLocalPart(e.target.value.toLowerCase())} placeholder="jane" className="flex-1" />
                <span className="text-muted">@</span>
                <Select value={domain} onChange={(e) => setDomain(e.target.value)} className="w-48">
                  {domains.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState(() => crypto.randomUUID().replace(/-/g, '').slice(0, 16));
  const reset = useMutation({
    mutationFn: () => post(`/api/admin/users/${user.id}/password`, { password }),
    onSuccess: () => {
      toast.success('Password reset. All sessions and API keys were revoked.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Reset failed'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reset password for ${user.name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => reset.mutate()} loading={reset.isPending} disabled={password.length < 10}>
            Reset password
          </Button>
        </>
      }
    >
      <Field label="New password" hint="Share it with the user through a secure channel.">
        <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
      </Field>
    </Dialog>
  );
}
