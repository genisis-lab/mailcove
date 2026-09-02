import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ExternalLink, Send, Webhook } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Field, Input, SectionCard } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useApp } from '../../lib/app-state';
import { ProviderCredentialsForm, type ProviderInfo } from '../SetupPage';

type ProvidersResponse = { items: Array<ProviderInfo & { domainCount: number; capabilities: ProviderInfo['capabilities'] & { docsUrl: string; deliveryEvents: boolean; inbound: string; maxMessageBytes: number } }>; encryptionKeyConfigured: boolean; defaultProvider: string };

export function AdminProviders() {
  const { me } = useApp();
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => get<ProvidersResponse>('/api/admin/providers') });
  const [testTo, setTestTo] = useState(me?.mailboxes[0]?.address ?? '');
  const [testFrom, setTestFrom] = useState(me?.mailboxes[0]?.address ?? '');
  const test = useMutation({
    mutationFn: (kind: string) => post<{ ok: boolean; error?: { message: string } }>(`/api/admin/providers/${kind}/test`, { from: testFrom, to: testTo }),
    onSuccess: (data) => (data.ok ? toast.success('Test message accepted by the provider') : toast.error(data.error?.message ?? 'Test failed')),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Test failed'),
  });
  const resendWebhook = useMutation({
    mutationFn: () => post<{ id: string; secret: string | null; stored: boolean }>('/api/admin/providers/resend/webhook'),
    onSuccess: (data) => {
      if (data.secret && data.stored) toast.success('Resend webhook created and signing secret stored');
      else if (data.secret) toast.success(`Webhook created. Save this secret as RESEND_WEBHOOK_SECRET: ${data.secret}`, { duration: 30_000 });
      else toast.success('Webhook already exists in Resend');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create webhook'),
  });

  return (
    <>
      {!providers.data?.encryptionKeyConfigured && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <strong>ENCRYPTION_KEY is not set.</strong> Credentials can only be configured as Worker secrets (<code>wrangler secret put …</code>). Set <code>ENCRYPTION_KEY</code> (32 random bytes, base64) to manage them here.
        </div>
      )}
      <SectionCard title="Send a test message" description="Uses the selected provider directly, bypassing queues, to confirm credentials and domain verification.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From (a verified mailbox address)">
            <Input value={testFrom} onChange={(e) => setTestFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </Field>
        </div>
      </SectionCard>
      {(providers.data?.items ?? []).map((p) => (
        <SectionCard
          key={p.kind}
          title={
            <span className="flex items-center gap-2">
              {p.configured ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-faint" />}
              {p.capabilities.label}
              {p.kind === providers.data?.defaultProvider && <Badge>default</Badge>}
              <Badge>{p.domainCount} domain{p.domainCount === 1 ? '' : 's'}</Badge>
            </span>
          }
          description={p.capabilities.description}
          actions={
            <a href={p.capabilities.docsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-8 text-xs">
              Docs <ExternalLink className="h-3.5 w-3.5" />
            </a>
          }
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div>
              {p.kind === 'cloudflare' && (
                <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                  Outbound uses the Worker&apos;s <code>EMAIL</code> binding ({p.configured ? 'present' : 'missing — add send_email to wrangler.jsonc'}). Inbound arrives through Email Routing → Send to Worker → <code>{me?.settings.appName ? 'mailcove' : 'mailcove'}</code>.
                </p>
              )}
              {providers.data?.encryptionKeyConfigured ? (
                <ProviderCredentialsForm provider={p} />
              ) : (
                <ul className="space-y-1 text-xs text-muted">
                  {p.capabilities.credentialFields.map((f) => (
                    <li key={f.name} className="flex items-center gap-2">
                      {p.fields[f.name] ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Circle className="h-3.5 w-3.5" />}
                      <code>{f.name}</code> {f.required ? '' : '(optional)'} {f.hint && <span>— {f.hint}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-3 text-xs text-muted">
              <div className="rounded-lg border p-3">
                <div className="mb-1 font-medium text-text">Capabilities</div>
                <div>Inbound: {p.capabilities.inbound === 'worker' ? 'Email Routing → Worker' : 'webhook'}</div>
                <div>Delivery events: {p.capabilities.deliveryEvents ? 'yes' : 'no'}</div>
                <div>Max message: {(p.capabilities.maxMessageBytes / 1024 / 1024).toFixed(0)} MB</div>
                {p.capabilities.requiresCloudflareDns && <div>Requires Cloudflare DNS</div>}
              </div>
              {p.webhookUrl && (
                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center gap-1 font-medium text-text">
                    <Webhook className="h-3.5 w-3.5" /> Webhook URL
                  </div>
                  <code className="block select-all break-all text-[11px] text-text">{p.webhookUrl}</code>
                  {p.kind === 'resend' && (
                    <Button size="sm" className="mt-2 w-full" onClick={() => resendWebhook.mutate()} loading={resendWebhook.isPending} disabled={!p.fields.RESEND_API_KEY}>
                      Create webhook in Resend
                    </Button>
                  )}
                </div>
              )}
              <Button size="sm" className="w-full" onClick={() => test.mutate(p.kind)} loading={test.isPending && test.variables === p.kind} disabled={!p.configured || !testTo || !testFrom}>
                <Send className="h-3.5 w-3.5" /> Send test via {p.capabilities.label}
              </Button>
            </div>
          </div>
        </SectionCard>
      ))}
    </>
  );
}
