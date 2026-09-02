import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Globe, HardDrive, Mailbox, MessageSquare, Users, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SectionCard, Skeleton } from '../../components/ui';
import { get } from '../../lib/api';
import { formatBytes, formatRelative } from '../../lib/utils';

type Overview = {
  users: number;
  domains: { total: number; verified: number };
  mailboxes: number;
  threads: number;
  messages: number;
  storageBytes: number;
  last24h: { inbound: number; outbound: number };
  failedLast7d: number;
  unrouted: number;
  deadLetters: number;
  recentDelivery: Array<{ id: string; type: string; recipient: string | null; provider: string; occurredAt: string }>;
  providers: Array<{ kind: string; configured: boolean }>;
  latestBackup: { status: string; createdAt: string; sizeBytes: number | null } | null;
  volume: Array<{ day: string; inbound: number; outbound: number }>;
  health: { authSecret: boolean; encryptionKey: boolean; sendEmailBinding: boolean; queues: boolean; push: boolean; workerName: string; baseUrl: string };
};

export function useOverview() {
  return useQuery({ queryKey: ['admin', 'overview'], queryFn: () => get<Overview>('/api/admin/overview'), refetchInterval: 30_000 });
}

function Stat({ icon: Icon, label, value, sub, to }: { icon: typeof Users; label: string; value: string | number; sub?: string; to?: string }) {
  const inner = (
    <div className="card flex items-center gap-4 p-4 transition-shadow hover:shadow">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-2xl font-semibold leading-none">{value}</div>
        <div className="mt-1 text-xs text-muted">
          {label}
          {sub ? ` · ${sub}` : ''}
        </div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export function AdminDashboard() {
  const { data, isLoading } = useOverview();
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  const max = Math.max(1, ...data.volume.map((v) => v.inbound + v.outbound));
  const checks: Array<[string, boolean, string]> = [
    ['AUTH_SECRET', data.health.authSecret, 'Session signing secret'],
    ['ENCRYPTION_KEY', data.health.encryptionKey, 'Needed to store provider credentials in the admin panel'],
    ['send_email binding', data.health.sendEmailBinding, 'Cloudflare Email Service outbound'],
    ['Queues', data.health.queues, 'Inbound/outbound processing'],
    ['Web Push', data.health.push, 'VAPID keys for notifications'],
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="Users" value={data.users} to="/admin/users" />
        <Stat icon={Globe} label="Domains" value={data.domains.total} sub={`${data.domains.verified} verified`} to="/admin/domains" />
        <Stat icon={Mailbox} label="Mailboxes" value={data.mailboxes} to="/admin/mailboxes" />
        <Stat icon={MessageSquare} label="Messages" value={data.messages.toLocaleString()} sub={formatBytes(data.storageBytes)} />
        <Stat icon={ArrowDownLeft} label="Received (24h)" value={data.last24h.inbound} />
        <Stat icon={ArrowUpRight} label="Sent (24h)" value={data.last24h.outbound} />
        <Stat icon={AlertTriangle} label="Unrouted" value={data.unrouted} sub="needs a mailbox" to="/admin/unrouted" />
        <Stat icon={XCircle} label="Failed / bounced (7d)" value={data.failedLast7d} sub={`${data.deadLetters} dead letters`} to="/admin/delivery" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <SectionCard title="Volume — last 14 days">
          <div className="flex h-40 items-end gap-1.5">
            {data.volume.length === 0 && <p className="text-sm text-muted">No traffic yet.</p>}
            {data.volume.map((v) => (
              <div key={v.day} className="group relative flex flex-1 flex-col justify-end gap-px" title={`${v.day}: ${v.inbound} in / ${v.outbound} out`}>
                <div className="rounded-t bg-accent/80" style={{ height: `${(v.inbound / max) * 100}%` }} />
                <div className="rounded-b bg-success/70" style={{ height: `${(v.outbound / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded bg-accent/80" /> inbound
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded bg-success/70" /> outbound
            </span>
          </div>
        </SectionCard>
        <SectionCard title="Health">
          <ul className="space-y-2 text-sm">
            {checks.map(([label, ok, hint]) => (
              <li key={label} className="flex items-start gap-2">
                {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />}
                <div>
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted">{hint}</div>
                </div>
              </li>
            ))}
            <li className="pt-2 text-xs text-muted">
              Worker <code>{data.health.workerName}</code> · {data.health.baseUrl}
            </li>
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Providers">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {data.providers.map((p) => (
              <li key={p.kind} className="flex items-center gap-2 rounded-lg border px-3 py-2 capitalize">
                <span className={`h-2 w-2 rounded-full ${p.configured ? 'bg-success' : 'bg-faint'}`} />
                {p.kind}
                <span className="ml-auto text-xs text-muted">{p.configured ? 'ready' : 'not configured'}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Backups">
          <div className="flex items-center gap-3 text-sm">
            <HardDrive className="h-5 w-5 text-muted" />
            {data.latestBackup ? (
              <span>
                Last backup {data.latestBackup.status} {formatRelative(data.latestBackup.createdAt)}
                {data.latestBackup.sizeBytes ? ` · ${formatBytes(data.latestBackup.sizeBytes)}` : ''}
              </span>
            ) : (
              <span className="text-muted">No backups yet.</span>
            )}
            <Link to="/admin/backups" className="ml-auto text-accent hover:underline">
              Manage
            </Link>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
