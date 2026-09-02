import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MailProviderKind } from '@shared/types';
import { AlertTriangle, Check, ChevronRight, Circle, Globe, Inbox, KeyRound, Server, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Field, Input, Select } from '../components/ui';
import { get, post, put } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { useConfig, useMe } from '../lib/queries';
import { cn } from '../lib/utils';
import { AuthShell } from './LoginPage';

type SetupStatus = {
  hasAdmin: boolean;
  setupCompleted: boolean;
  defaultProvider: MailProviderKind;
  providers: Record<string, { configured: boolean; label: string }>;
  domainCount: number;
  mailboxCount: number;
  encryptionKeyConfigured: boolean;
  authSecretConfigured: boolean;
  cloudflareTokenConfigured: boolean;
  workerName: string;
  baseUrl: string;
};

type ProviderInfo = {
  kind: MailProviderKind;
  capabilities: { label: string; description: string; webhookPath: string | null; requiresCloudflareDns: boolean; credentialFields: Array<{ name: string; label: string; secret: boolean; required: boolean; hint?: string }> };
  configured: boolean;
  fields: Record<string, boolean>;
  fromEnv: Record<string, boolean>;
  webhookUrl: string | null;
};

const STEPS = [
  { id: 'welcome', label: 'Checks', icon: ShieldCheck },
  { id: 'admin', label: 'Administrator', icon: UserPlus },
  { id: 'provider', label: 'Mail provider', icon: Server },
  { id: 'domain', label: 'Domain', icon: Globe },
  { id: 'mailbox', label: 'Mailbox', icon: Inbox },
] as const;

export function SetupPage({ authenticated }: { authenticated: boolean }) {
  return (
    <Routes>
      <Route path="register" element={<RegisterPage />} />
      <Route path="*" element={<Wizard authenticated={authenticated} />} />
    </Routes>
  );
}

function Wizard({ authenticated }: { authenticated: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => get<SetupStatus>('/api/setup/status'), refetchInterval: 15_000 });
  const me = useMe(authenticated);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!status.data) return;
    if (status.data.hasAdmin && !authenticated) navigate('/login', { replace: true });
    if (status.data.setupCompleted && authenticated) navigate('/mail/inbox', { replace: true });
  }, [status.data, authenticated, navigate]);

  useEffect(() => {
    if (!status.data) return;
    if (step === 0) return;
    if (!status.data.hasAdmin) setStep(1);
  }, [status.data, step]);

  if (!status.data) return null;
  if (status.data.hasAdmin && !authenticated) return <Navigate to="/login" replace />;
  if (authenticated && me.data && !me.data.user.isAdmin) return <Navigate to="/mail/inbox" replace />;

  const s = status.data;

  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto grid max-w-5xl gap-8 p-6 md:grid-cols-[240px_1fr] md:p-10">
        <aside>
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow">
              <Inbox className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-semibold">Mailcove setup</div>
              <div className="text-xs text-muted">About five minutes</div>
            </div>
          </div>
          <ol className="space-y-1">
            {STEPS.map((st, i) => {
              const done = i < step;
              const Icon = st.icon;
              return (
                <li key={st.id}>
                  <button
                    type="button"
                    onClick={() => i <= step && setStep(i)}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', i === step ? 'bg-surface font-medium shadow-sm' : 'text-muted hover:bg-surface')}
                  >
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-xs', done ? 'border-success bg-success text-white' : i === step ? 'border-accent text-accent' : 'border-border-strong')}>
                      {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    </span>
                    {st.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <main className="card min-h-[520px] p-8 fade-in">
          {step === 0 && <WelcomeStep status={s} onNext={() => setStep(s.hasAdmin ? 2 : 1)} />}
          {step === 1 && (
            <AdminStep
              onDone={async () => {
                await qc.invalidateQueries();
                setStep(2);
              }}
            />
          )}
          {step === 2 && <ProviderStep status={s} onNext={() => setStep(3)} />}
          {step === 3 && <DomainStep status={s} onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
          {step === 4 && (
            <MailboxStep
              userId={me.data?.user.id ?? null}
              onDone={async () => {
                await post('/api/setup/complete');
                await qc.invalidateQueries();
                toast.success('Mailcove is ready. Welcome!');
                navigate('/mail/inbox', { replace: true });
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
      {ok ? <Check className="mt-0.5 h-4 w-4 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />}
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted">{detail}</div>
      </div>
    </li>
  );
}

function WelcomeStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Welcome to Mailcove</h2>
      <p className="mt-1 text-sm text-muted">Let&apos;s check the Worker configuration before creating your account. Missing items are not blockers — you can fix them later from the admin panel.</p>
      <ul className="mt-6 space-y-2">
        <CheckRow ok={status.authSecretConfigured} label="AUTH_SECRET" detail={status.authSecretConfigured ? 'Session signing secret is set.' : 'Set a strong AUTH_SECRET with `wrangler secret put AUTH_SECRET` before going to production.'} />
        <CheckRow ok={status.encryptionKeyConfigured} label="ENCRYPTION_KEY" detail={status.encryptionKeyConfigured ? 'Provider credentials can be stored from the admin panel.' : 'Without it, provider API keys must be configured as Worker secrets.'} />
        <CheckRow ok={status.providers.cloudflare?.configured ?? false} label="Cloudflare send_email binding" detail={status.providers.cloudflare?.configured ? 'Outbound mail via Cloudflare Email Service is available.' : 'Add the EMAIL send_email binding in wrangler.jsonc (Workers paid plan).'} />
        <CheckRow ok={status.cloudflareTokenConfigured} label="CF_API_TOKEN" detail={status.cloudflareTokenConfigured ? 'Domains can be onboarded automatically.' : 'Optional: lets Mailcove enable Email Routing and Sending on your zones for you.'} />
        <CheckRow ok label="Worker name" detail={`Email Routing rules will target "${status.workerName}". Base URL: ${status.baseUrl}`} />
      </ul>
      <div className="mt-8 flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Continue <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AdminStep({ onDone }: { onDone: () => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => post('/api/setup/admin', { name, email, password }),
    onSuccess: async () => {
      await authClient.getSession();
      await onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create account'),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setError(null);
    mutation.mutate();
  }
  return (
    <form onSubmit={submit}>
      <h2 className="text-lg font-semibold">Create the administrator</h2>
      <p className="mt-1 text-sm text-muted">This account manages domains, users and providers. The email is only used to sign in — your mailbox address comes later.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Your name" className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Sign-in email" className="sm:col-span-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
      </div>
      {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-8 flex justify-end">
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          Create account <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

export function ProviderCredentialsForm({ provider, onSaved }: { provider: ProviderInfo; onSaved?: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => put(`/api/admin/providers/${provider.kind}/credentials`, values),
    onSuccess: () => {
      toast.success(`${provider.capabilities.label} credentials saved`);
      setValues({});
      void qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
      void qc.invalidateQueries({ queryKey: ['setup-status'] });
      onSaved?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {provider.capabilities.credentialFields.map((f) => (
        <Field key={f.name} label={`${f.label}${f.required ? '' : ' (optional)'}`} hint={f.hint}>
          <div className="flex items-center gap-2">
            <Input
              type={f.secret ? 'password' : 'text'}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              placeholder={provider.fields[f.name] ? (provider.fromEnv[f.name] ? 'Set via Worker secret' : '•••••••• (stored)') : ''}
              disabled={provider.fromEnv[f.name]}
              autoComplete="off"
            />
            {provider.fields[f.name] && <Check className="h-4 w-4 shrink-0 text-success" />}
          </div>
        </Field>
      ))}
      {provider.webhookUrl && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          Webhook URL: <code className="select-all font-mono text-text">{provider.webhookUrl}</code>
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" loading={save.isPending} disabled={Object.keys(values).length === 0}>
          Save credentials
        </Button>
      </div>
    </form>
  );
}

function ProviderStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => get<{ items: ProviderInfo[] }>('/api/admin/providers') });
  const [selected, setSelected] = useState<MailProviderKind>(status.defaultProvider);
  const current = providers.data?.items.find((p) => p.kind === selected);
  return (
    <div>
      <h2 className="text-lg font-semibold">Choose how mail moves</h2>
      <p className="mt-1 text-sm text-muted">Each domain uses one provider. Cloudflare Email Service is the default; others work with any DNS host. You can add more providers later.</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {providers.data?.items.map((p) => (
          <button
            key={p.kind}
            type="button"
            onClick={() => setSelected(p.kind)}
            className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors', selected === p.kind ? 'border-accent bg-accent/5' : 'hover:bg-surface-2')}
          >
            {selected === p.kind ? <Check className="mt-0.5 h-4 w-4 text-accent" /> : <Circle className="mt-0.5 h-4 w-4 text-faint" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.capabilities.label}
                {p.configured && <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-semibold uppercase text-success">Ready</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted">{p.capabilities.description}</div>
            </div>
          </button>
        ))}
      </div>
      {current && (
        <div className="mt-6 rounded-xl border bg-surface-2/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-muted" /> {current.capabilities.label} credentials
          </div>
          {current.kind === 'cloudflare' && (
            <p className="mb-3 text-xs text-muted">
              Outbound uses the <code>EMAIL</code> binding ({current.configured ? 'detected' : 'missing'}). A Cloudflare API token lets Mailcove enable Email Routing and Email Sending on your zone automatically.
            </p>
          )}
          {status.encryptionKeyConfigured ? (
            <ProviderCredentialsForm provider={current} />
          ) : (
            <p className="text-xs text-muted">
              Set <code>ENCRYPTION_KEY</code> to enter credentials here, or configure them as Worker secrets:{' '}
              {current.capabilities.credentialFields.map((f) => (
                <code key={f.name} className="mr-1">
                  wrangler secret put {f.name}
                </code>
              ))}
            </p>
          )}
        </div>
      )}
      <div className="mt-8 flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Continue <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

type DomainRow = { id: string; name: string; provider: MailProviderKind; status: string; dnsRecords: Array<{ type: string; name: string; value: string; priority?: number | null; status?: string; purpose?: string }> | null; lastError: string | null };

export function DnsRecordsTable({ records }: { records: DomainRow['dnsRecords'] }) {
  if (!records?.length) return <p className="text-xs text-muted">No DNS records reported yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-2 text-faint">
          <tr>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 font-medium">Name</th>
            <th className="px-2 py-1.5 font-medium">Value</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-t align-top">
              <td className="px-2 py-1.5 font-mono">{r.type}{r.priority ? ` ${r.priority}` : ''}</td>
              <td className="px-2 py-1.5 font-mono break-all">{r.name}</td>
              <td className="px-2 py-1.5 font-mono break-all">{r.value}</td>
              <td className="px-2 py-1.5">
                <span className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold uppercase', r.status === 'verified' ? 'bg-success/15 text-success' : r.status === 'failed' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning')}>{r.status ?? 'pending'}</span>
                {r.purpose && <div className="text-[10px] text-faint">{r.purpose}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DomainStep({ status, onNext, onSkip }: { status: SetupStatus; onNext: () => void; onSkip: () => void }) {
  const qc = useQueryClient();
  const domains = useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<{ items: DomainRow[] }>('/api/admin/domains') });
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => get<{ items: ProviderInfo[] }>('/api/admin/providers') });
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<MailProviderKind>(status.defaultProvider);
  const [notes, setNotes] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: () => post<{ domain: DomainRow; notes: string[] }>('/api/admin/domains', { name, provider }),
    onSuccess: (data) => {
      setNotes(data.notes);
      setName('');
      void qc.invalidateQueries({ queryKey: ['admin', 'domains'] });
      void qc.invalidateQueries({ queryKey: ['setup-status'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add domain'),
  });
  const verify = useMutation({
    mutationFn: (id: string) => post<{ domain: DomainRow; notes: string[] }>(`/api/admin/domains/${id}/verify`),
    onSuccess: (data) => {
      setNotes(data.notes);
      void qc.invalidateQueries({ queryKey: ['admin', 'domains'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Verification failed'),
  });
  const items = domains.data?.items ?? [];
  return (
    <div>
      <h2 className="text-lg font-semibold">Connect a domain</h2>
      <p className="mt-1 text-sm text-muted">Mailcove will onboard the domain with the selected provider and show the DNS records you need. Verification can take a few minutes after DNS changes.</p>
      <form
        className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Domain" className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" required />
        </Field>
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value as MailProviderKind)}>
            {providers.data?.items.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.capabilities.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Add domain
        </Button>
      </form>
      {notes.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-xs text-text">
          {notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}
      <div className="mt-6 space-y-4">
        {items.map((d) => (
          <div key={d.id} className="rounded-xl border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted">
                  {d.provider} · <span className={d.status === 'verified' ? 'text-success' : 'text-warning'}>{d.status}</span>
                  {d.lastError && <span className="text-danger"> · {d.lastError}</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => verify.mutate(d.id)} loading={verify.isPending}>
                Re-check DNS
              </Button>
            </div>
            <DnsRecordsTable records={d.dnsRecords} />
          </div>
        ))}
      </div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
        <Button variant="primary" onClick={onNext} disabled={items.length === 0}>
          Continue <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function MailboxStep({ userId, onDone }: { userId: string | null; onDone: () => Promise<void> }) {
  const domains = useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<{ items: DomainRow[] }>('/api/admin/domains') });
  const [domainId, setDomainId] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [finishing, setFinishing] = useState(false);
  const list = useMemo(() => domains.data?.items ?? [], [domains.data]);
  useEffect(() => {
    if (!domainId && list[0]) setDomainId(list[0].id);
  }, [list, domainId]);
  const domainName = useMemo(() => list.find((d) => d.id === domainId)?.name ?? '', [list, domainId]);
  const create = useMutation({
    mutationFn: () => post('/api/admin/mailboxes', { domainId, localPart, displayName: displayName || null, type: 'personal', ownerUserId: userId }),
    onSuccess: async () => {
      setFinishing(true);
      await onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create mailbox'),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="text-lg font-semibold">Your first mailbox</h2>
      <p className="mt-1 text-sm text-muted">This is the address you will send from and receive at. You can add more addresses, aliases and shared mailboxes from the admin panel.</p>
      {list.length === 0 ? (
        <div className="mt-6 rounded-lg bg-surface-2 p-4 text-sm text-muted">
          No domains yet. You can finish setup now and add a domain from Admin → Domains.
          <div className="mt-4">
            <Button variant="primary" onClick={() => onDone()} loading={finishing}>
              Finish setup
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="Address">
              <Input value={localPart} onChange={(e) => setLocalPart(e.target.value.toLowerCase())} placeholder="you" required autoFocus pattern="[a-z0-9._%+-]+" />
            </Field>
            <div className="hidden items-end pb-2 text-muted sm:flex">@</div>
            <Field label="Domain">
              <Select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
                {list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Display name (optional)" className="sm:col-span-3">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" />
            </Field>
          </div>
          {localPart && domainName && (
            <p className="mt-3 text-sm text-muted">
              You will be <span className="font-medium text-text">{localPart}@{domainName}</span>
            </p>
          )}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" type="button" onClick={() => onDone()}>
              Skip
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending || finishing}>
              Create mailbox & finish <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useConfig();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (config.data && !config.data.allowSignups && config.data.hasUsers) return <Navigate to="/login" replace />;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await authClient.signUp.email({ name, email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (result.error) return setError(result.error.message ?? 'Could not create account');
    await qc.invalidateQueries();
    navigate('/mail/inbox', { replace: true });
  }
  return (
    <AuthShell title="Create your account" subtitle="An administrator will assign your mailbox address.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
        </Field>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export type { ProviderInfo, DomainRow };
