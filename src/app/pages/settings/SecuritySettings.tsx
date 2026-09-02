import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WEBHOOK_EVENTS } from '@shared/types';
import { Copy, KeyRound, Laptop, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { del, get, patch, post } from '../../lib/api';
import { useApp } from '../../lib/app-state';
import { authClient } from '../../lib/auth-client';
import { keys, useApiKeys, useSessions } from '../../lib/queries';
import { formatRelative } from '../../lib/utils';
import { Badge, Button, Dialog, Field, IconButton, Input, SectionCard, Switch } from './shared';

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success('Copied'));
}

export function SecuritySettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const sessions = useSessions();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [twoFa, setTwoFa] = useState<{ step: 'password' | 'verify' | 'codes'; password: string; totpUri?: string; backupCodes?: string[]; code: string; disabling?: boolean } | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return toast.error('Passwords do not match');
    setPwLoading(true);
    const result = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setPwLoading(false);
    if (result.error) return toast.error(result.error.message ?? 'Could not change password');
    toast.success('Password updated. Other sessions were signed out.');
    setCurrent('');
    setNext('');
    setConfirm('');
    void qc.invalidateQueries({ queryKey: keys.sessions });
  }

  async function start2fa(disabling: boolean) {
    setTwoFa({ step: 'password', password: '', code: '', disabling });
  }

  async function submit2faPassword() {
    if (!twoFa) return;
    if (twoFa.disabling) {
      const res = await authClient.twoFactor.disable({ password: twoFa.password });
      if (res.error) return toast.error(res.error.message ?? 'Could not disable');
      toast.success('Two-step verification disabled');
      setTwoFa(null);
      void qc.invalidateQueries({ queryKey: keys.me });
      return;
    }
    const res = await authClient.twoFactor.enable({ password: twoFa.password, issuer: me?.settings.appName });
    if (res.error) return toast.error(res.error.message ?? 'Could not enable');
    const data = res.data as { totpURI?: string; backupCodes?: string[] } | null;
    setTwoFa({ ...twoFa, step: 'verify', totpUri: data?.totpURI, backupCodes: data?.backupCodes });
  }

  async function verify2fa() {
    if (!twoFa) return;
    const res = await authClient.twoFactor.verifyTotp({ code: twoFa.code.replace(/\s/g, '') });
    if (res.error) return toast.error(res.error.message ?? 'Invalid code');
    setTwoFa({ ...twoFa, step: 'codes' });
    void qc.invalidateQueries({ queryKey: keys.me });
  }

  const revoke = useMutation({
    mutationFn: (id: string) => del(`/api/me/sessions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sessions }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => post('/api/me/sessions/revoke-others'),
    onSuccess: () => {
      toast.success('Other sessions signed out');
      void qc.invalidateQueries({ queryKey: keys.sessions });
    },
  });

  return (
    <>
      <SectionCard title="Password">
        <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-3">
          <Field label="Current password">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 10 characters">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <Field label="Confirm">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" variant="primary" loading={pwLoading}>
              Update password
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Two-step verification" description="Require a code from an authenticator app when signing in.">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className={me?.user.twoFactorEnabled ? 'h-5 w-5 text-success' : 'h-5 w-5 text-faint'} />
            {me?.user.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
          </div>
          <Switch checked={Boolean(me?.user.twoFactorEnabled)} onCheckedChange={(v) => start2fa(!v)} />
        </div>
      </SectionCard>

      <SectionCard
        title="Sessions"
        description="Devices signed in to your account."
        actions={
          <Button size="sm" onClick={() => revokeOthers.mutate()} loading={revokeOthers.isPending}>
            Sign out other sessions
          </Button>
        }
      >
        <ul className="divide-y">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
              <Laptop className="h-4 w-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {s.deviceName ?? 'Unknown device'} {s.current && <Badge className="bg-success/15 text-success">this device</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {s.ipAddress ?? 'unknown IP'} · active {formatRelative(s.lastSeenAt)} · expires {formatRelative(s.expiresAt)}
                </div>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      {twoFa && (
        <Dialog
          open
          onOpenChange={(o) => !o && setTwoFa(null)}
          title={twoFa.disabling ? 'Disable two-step verification' : twoFa.step === 'codes' ? 'Save your backup codes' : 'Set up two-step verification'}
          size="md"
          footer={
            twoFa.step === 'password' ? (
              <Button variant="primary" onClick={submit2faPassword} disabled={!twoFa.password}>
                Continue
              </Button>
            ) : twoFa.step === 'verify' ? (
              <Button variant="primary" onClick={verify2fa} disabled={twoFa.code.length < 6}>
                Verify & enable
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setTwoFa(null)}>
                Done
              </Button>
            )
          }
        >
          {twoFa.step === 'password' && (
            <Field label="Confirm your password">
              <Input type="password" value={twoFa.password} onChange={(e) => setTwoFa({ ...twoFa, password: e.target.value })} autoFocus autoComplete="current-password" />
            </Field>
          )}
          {twoFa.step === 'verify' && twoFa.totpUri && (
            <div className="space-y-4">
              <p className="text-sm text-muted">Scan this code with Google Authenticator, 1Password, Authy or any TOTP app, then enter the 6-digit code.</p>
              <QrImage value={twoFa.totpUri} />
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Can&apos;t scan? Enter the key manually</summary>
                <code className="mt-1 block break-all rounded bg-surface-2 p-2 font-mono">{new URL(twoFa.totpUri).searchParams.get('secret')}</code>
              </details>
              <Input value={twoFa.code} onChange={(e) => setTwoFa({ ...twoFa, code: e.target.value })} placeholder="123 456" inputMode="numeric" className="text-center text-lg tracking-widest" autoFocus />
            </div>
          )}
          {twoFa.step === 'codes' && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Each backup code works once if you lose your authenticator. Store them somewhere safe.</p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-sm">
                {(twoFa.backupCodes ?? []).map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <Button size="sm" onClick={() => copy((twoFa.backupCodes ?? []).join('\n'))}>
                <Copy className="h-4 w-4" /> Copy codes
              </Button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

export function ApiKeysSettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const keysQuery = useApiKeys();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['mail:read', 'mail:send']);
  const [expires, setExpires] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ secret: string }>('/api/api-keys', { name, scopes, expiresInDays: expires ? Number(expires) : null }),
    onSuccess: (data) => {
      setSecret(data.secret);
      setName('');
      void qc.invalidateQueries({ queryKey: keys.apiKeys });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create key'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/api/api-keys/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.apiKeys }),
  });
  const available = (keysQuery.data?.scopes ?? []).filter((s) => s !== 'admin' || me?.user.isAdmin);
  return (
    <>
      <SectionCard title="API keys" description="Use keys as Authorization: Bearer <key> against /api/v1. Only the hash is stored — copy the key when it is shown.">
        {!me?.settings.publicApiEnabled && <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">The public API is disabled by an administrator.</p>}
        <form
          className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && scopes.length) create.mutate();
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI notifications" />
          </Field>
          <Field label="Expires">
            <select className="input" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!me?.settings.publicApiEnabled}>
              <Plus className="h-4 w-4" /> Create key
            </Button>
          </div>
          <div className="flex flex-wrap gap-3 sm:col-span-3">
            {available.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} className="accent-[var(--accent)]" />
                <code className="text-xs">{s}</code>
              </label>
            ))}
          </div>
        </form>
        <ul className="divide-y">
          {(keysQuery.data?.items ?? []).map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-2.5 text-sm">
              <KeyRound className="h-4 w-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {k.name} <code className="ml-1 text-xs text-muted">{k.prefix}…</code>
                </div>
                <div className="text-xs text-muted">
                  {k.scopes.join(', ')} · created {formatRelative(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${formatRelative(k.lastUsedAt)}` : ' · never used'}
                  {k.expiresAt ? ` · expires ${formatRelative(k.expiresAt)}` : ''}
                </div>
              </div>
              <IconButton label="Revoke key" size="sm" onClick={() => revoke.mutate(k.id)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
          {keysQuery.data?.items.length === 0 && <li className="py-4 text-center text-sm text-muted">No API keys.</li>}
        </ul>
      </SectionCard>
      {secret && (
        <Dialog open onOpenChange={(o) => !o && setSecret(null)} title="Your new API key" description="This is the only time the full key is shown." size="md" footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3 font-mono text-xs">
            <span className="flex-1 break-all">{secret}</span>
            <IconButton label="Copy" size="sm" onClick={() => copy(secret)}>
              <Copy className="h-4 w-4" />
            </IconButton>
          </div>
          <pre className="mt-3 overflow-auto rounded-lg bg-surface-2 p-3 text-[11px] text-muted">{`curl ${window.location.origin}/api/v1/threads?view=inbox \\\n  -H "Authorization: Bearer ${secret}"`}</pre>
        </Dialog>
      )}
    </>
  );
}

type OutgoingWebhook = { id: string; url: string; events: string[]; description: string | null; enabled: boolean; lastStatus: number | null; lastDeliveredAt: string | null; global: boolean };

export function WebhooksSettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const hooks = useQuery({ queryKey: keys.webhooks, queryFn: () => get<{ items: OutgoingWebhook[] }>('/api/outgoing-webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['message.received']);
  const [global, setGlobal] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ secret: string }>('/api/outgoing-webhooks', { url, events, global }),
    onSuccess: (data) => {
      setSecret(data.secret);
      setUrl('');
      void qc.invalidateQueries({ queryKey: keys.webhooks });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create webhook'),
  });
  const toggle = useMutation({
    mutationFn: (h: OutgoingWebhook) => patch(`/api/outgoing-webhooks/${h.id}`, { enabled: !h.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhooks }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/outgoing-webhooks/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.webhooks }),
  });
  return (
    <>
      <SectionCard title="Outgoing webhooks" description="Mailcove POSTs signed JSON (X-Mailcove-Signature: v1=<HMAC-SHA256 of timestamp.body>) when these events happen.">
        <form
          className="mb-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url && events.length) create.mutate();
          }}
        >
          <Field label="Endpoint URL">
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/mailcove" required />
          </Field>
          <div className="flex flex-wrap gap-3">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} className="accent-[var(--accent)]" />
                <code className="text-xs">{ev}</code>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between">
            {me?.user.isAdmin ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} className="accent-[var(--accent)]" />
                Global (all mailboxes on this server)
              </label>
            ) : (
              <span />
            )}
            <Button type="submit" variant="primary" loading={create.isPending}>
              <Plus className="h-4 w-4" /> Add webhook
            </Button>
          </div>
        </form>
        <ul className="divide-y">
          {(hooks.data?.items ?? []).map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
              <Switch checked={h.enabled} onCheckedChange={() => toggle.mutate(h)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {h.url} {h.global && <Badge>global</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {h.events.join(', ')}
                  {h.lastStatus ? ` · last ${h.lastStatus} ${h.lastDeliveredAt ? formatRelative(h.lastDeliveredAt) : ''}` : ''}
                </div>
              </div>
              <IconButton label="Delete webhook" size="sm" onClick={() => remove.mutate(h.id)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
          {hooks.data?.items.length === 0 && <li className="py-4 text-center text-sm text-muted">No webhooks configured.</li>}
        </ul>
      </SectionCard>
      {secret && (
        <Dialog open onOpenChange={(o) => !o && setSecret(null)} title="Webhook signing secret" description="Verify requests with HMAC-SHA256 over `timestamp.body` using this secret. Shown once." size="md" footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3 font-mono text-xs">
            <span className="flex-1 break-all">{secret}</span>
            <IconButton label="Copy" size="sm" onClick={() => copy(secret)}>
              <Copy className="h-4 w-4" />
            </IconButton>
          </div>
        </Dialog>
      )}
    </>
  );
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(value, { width: 200, margin: 1 }).then(setSrc).catch(() => setSrc(null));
  }, [value]);
  return <div className="flex justify-center rounded-xl bg-white p-4">{src ? <img alt="TOTP QR code" width={180} height={180} src={src} /> : <span className="text-xs text-muted">Generating…</span>}</div>;
}
