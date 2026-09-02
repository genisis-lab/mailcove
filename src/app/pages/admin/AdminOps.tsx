import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, HardDrive, Play, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, ConfirmDialog, Field, Input, SectionCard, Select, Switch } from '../../components/ui';
import { api, del, get, patch, post } from '../../lib/api';
import { downloadUrl, formatBytes, formatFullDate, formatRelative } from '../../lib/utils';

// --- Unrouted -------------------------------------------------------------------

type Unrouted = { id: string; envelopeFrom: string; envelopeTo: string; subject: string | null; reason: string; provider: string | null; sizeBytes: number; rawR2Key: string | null; createdAt: string; resolvedAt: string | null };
type MailboxRow = { id: string; address: string };

export function AdminUnrouted() {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const rows = useQuery({ queryKey: ['admin', 'unrouted', showAll], queryFn: () => get<{ items: Unrouted[] }>(`/api/admin/unrouted${showAll ? '?all=1' : ''}`) });
  const mailboxes = useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<{ items: MailboxRow[] }>('/api/admin/mailboxes') });
  const [target, setTarget] = useState<Record<string, string>>({});
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'unrouted'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const deliver = useMutation({
    mutationFn: ({ id, mailboxId }: { id: string; mailboxId: string }) => post(`/api/admin/unrouted/${id}/deliver`, { mailboxId }),
    onSuccess: () => {
      toast.success('Delivered to mailbox');
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delivery failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/admin/unrouted/${id}`), onSuccess: refresh });
  return (
    <SectionCard
      title="Unrouted mail"
      description="Messages that arrived for an address with no mailbox and no catch-all. Create the mailbox, then deliver the message into it."
      actions={
        <label className="flex items-center gap-2 text-xs text-muted">
          Show resolved <Switch checked={showAll} onCheckedChange={setShowAll} />
        </label>
      }
    >
      <ul className="divide-y">
        {(rows.data?.items ?? []).map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{u.subject || '(no subject)'}</span>
                <Badge>{u.reason.replace('_', ' ')}</Badge>
                {u.resolvedAt && <Badge className="bg-success/15 text-success">delivered</Badge>}
              </div>
              <div className="text-xs text-muted">
                {u.envelopeFrom} → <span className="font-mono">{u.envelopeTo}</span> · {formatBytes(u.sizeBytes)} · {formatRelative(u.createdAt)} · {u.provider}
              </div>
            </div>
            {!u.resolvedAt && u.rawR2Key && (
              <div className="flex items-center gap-2">
                <Select value={target[u.id] ?? ''} onChange={(e) => setTarget({ ...target, [u.id]: e.target.value })} className="h-8 w-56 text-xs">
                  <option value="">Deliver to…</option>
                  {mailboxes.data?.items.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.address}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="primary" disabled={!target[u.id]} onClick={() => deliver.mutate({ id: u.id, mailboxId: target[u.id]! })}>
                  Deliver
                </Button>
              </div>
            )}
            {u.rawR2Key && (
              <Button size="sm" variant="ghost" onClick={() => downloadUrl(`/api/admin/unrouted/${u.id}/raw`)}>
                <Download className="h-3.5 w-3.5" /> .eml
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(u.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        {rows.data?.items.length === 0 && <li className="py-8 text-center text-sm text-muted">Nothing unrouted. Every message found a home.</li>}
      </ul>
    </SectionCard>
  );
}

// --- Delivery log ------------------------------------------------------------------

type DeliveryRow = { event: { id: string; type: string; provider: string; recipient: string | null; occurredAt: string; detail: Record<string, unknown> | null }; subject: string | null; from: string | null; threadId: string | null };
type OutboundRow = { id: string; subject: string; fromAddr: string; to: Array<{ email: string }>; status: string; statusDetail: string | null; statusAt: string | null; provider: string | null; createdAt: string; threadId: string };

const STATUS_TONE: Record<string, string> = { delivered: 'bg-success/15 text-success', sent: 'bg-surface-3 text-muted', queued: 'bg-surface-3 text-muted', sending: 'bg-surface-3 text-muted', scheduled: 'bg-warning/15 text-warning', delayed: 'bg-warning/15 text-warning', bounced: 'bg-danger/15 text-danger', complained: 'bg-danger/15 text-danger', failed: 'bg-danger/15 text-danger' };

export function AdminDelivery() {
  const [type, setType] = useState('');
  const data = useQuery({ queryKey: ['admin', 'delivery', type], queryFn: () => get<{ events: DeliveryRow[]; outbound: OutboundRow[] }>(`/api/admin/logs/delivery${type ? `?type=${type}` : ''}`), refetchInterval: 30_000 });
  return (
    <>
      <SectionCard title="Recent outbound messages" description="Every message handed to a provider, with its latest known status.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-faint">
              <tr>
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">From → To</th>
                <th className="py-2 font-medium">Subject</th>
                <th className="py-2 font-medium">Provider</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data.data?.outbound ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="py-2 text-muted">{formatRelative(m.createdAt)}</td>
                  <td className="py-2">
                    <div className="text-xs">{m.fromAddr}</div>
                    <div className="text-xs text-muted">{m.to.map((t) => t.email).join(', ')}</div>
                  </td>
                  <td className="max-w-xs truncate py-2">{m.subject || '(no subject)'}</td>
                  <td className="py-2 text-muted">{m.provider}</td>
                  <td className="py-2">
                    <Badge className={STATUS_TONE[m.status] ?? ''}>{m.status}</Badge>
                    {m.statusDetail && <div className="mt-0.5 max-w-xs truncate text-[11px] text-muted" title={m.statusDetail}>{m.statusDetail}</div>}
                  </td>
                </tr>
              ))}
              {data.data?.outbound.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted">
                    Nothing sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SectionCard
        title="Provider delivery events"
        description="Bounces, complaints, deliveries and opens reported by providers."
        actions={
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-40 text-xs">
            <option value="">All events</option>
            {['delivered', 'bounced', 'complained', 'failed', 'delayed', 'opened', 'clicked', 'unsubscribed'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        }
      >
        <ul className="divide-y text-sm">
          {(data.data?.events ?? []).map((row) => (
            <li key={row.event.id} className="flex flex-wrap items-center gap-3 py-2">
              <Badge className={STATUS_TONE[row.event.type] ?? ''}>{row.event.type}</Badge>
              <span className="text-muted">{row.event.recipient ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate">{row.subject ?? <span className="text-faint">unknown message</span>}</span>
              <span className="text-xs text-muted">
                {row.event.provider} · {formatFullDate(row.event.occurredAt)}
              </span>
            </li>
          ))}
          {data.data?.events.length === 0 && <li className="py-6 text-center text-muted">No delivery events recorded.</li>}
        </ul>
      </SectionCard>
    </>
  );
}

// --- Audit log ----------------------------------------------------------------------

type AuditRow = { id: string; action: string; targetType: string | null; targetId: string | null; metadata: Record<string, unknown> | null; ip: string | null; createdAt: string; actorName: string | null; actorEmail: string | null };

export function AdminAudit() {
  const [action, setAction] = useState('');
  const rows = useQuery({ queryKey: ['admin', 'audit', action], queryFn: () => get<{ items: AuditRow[] }>(`/api/admin/logs/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`) });
  return (
    <SectionCard title="Audit log" description="Administrative and security-relevant actions." actions={<Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action prefix (admin.user)" className="h-8 w-64 text-xs" />}>
      <ul className="divide-y text-sm">
        {(rows.data?.items ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 py-2">
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{r.action}</code>
            <span className="text-muted">{r.actorName ?? r.actorEmail ?? 'system'}</span>
            {r.metadata && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{JSON.stringify(r.metadata)}</span>}
            <span className="ml-auto text-xs text-muted">
              {r.ip ? `${r.ip} · ` : ''}
              {formatFullDate(r.createdAt)}
            </span>
          </li>
        ))}
        {rows.data?.items.length === 0 && <li className="py-6 text-center text-muted">Nothing logged yet.</li>}
      </ul>
    </SectionCard>
  );
}

// --- Dead letters --------------------------------------------------------------------

type DeadLetter = { id: string; queue: string; body: string; error: string | null; attempts: number; retriedAt: string | null; createdAt: string };

export function AdminDeadLetters() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ['admin', 'dead-letters'], queryFn: () => get<{ items: DeadLetter[] }>('/api/admin/dead-letters') });
  const retry = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; error?: string }>(`/api/admin/dead-letters/${id}/retry`),
    onSuccess: (d) => {
      if (d.ok) toast.success('Retried successfully');
      else toast.error(d.error ?? 'Retry failed');
      void qc.invalidateQueries({ queryKey: ['admin', 'dead-letters'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Retry failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/admin/dead-letters/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'dead-letters'] }) });
  return (
    <SectionCard title="Dead letters" description="Queue jobs that failed every retry. Retry them after fixing the cause, or discard them.">
      <ul className="divide-y text-sm">
        {(rows.data?.items ?? []).map((d) => (
          <li key={d.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{d.queue}</Badge>
              <span className="text-xs text-muted">
                {d.attempts} attempts · {formatRelative(d.createdAt)} {d.retriedAt && <Badge className="bg-success/15 text-success">retried</Badge>}
              </span>
              <div className="ml-auto flex gap-1">
                <Button size="sm" onClick={() => retry.mutate(d.id)} loading={retry.isPending && retry.variables === d.id}>
                  <Play className="h-3.5 w-3.5" /> Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {d.error && <div className="mt-1 text-xs text-danger">{d.error}</div>}
            <pre className="mt-1 max-h-24 overflow-auto rounded bg-surface-2 p-2 text-[11px] text-muted">{d.body}</pre>
          </li>
        ))}
        {rows.data?.items.length === 0 && <li className="py-6 text-center text-muted">No dead letters. Queues are healthy.</li>}
      </ul>
    </SectionCard>
  );
}

// --- Backups --------------------------------------------------------------------------

type Backup = { id: string; status: string; trigger: string; filename: string | null; sizeBytes: number | null; tableCounts: Record<string, number> | null; error: string | null; createdAt: string; completedAt: string | null };

export function AdminBackups() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => get<{ items: Backup[]; enabled: boolean; retention: number }>('/api/admin/backups') });
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
  const run = useMutation({
    mutationFn: () => post<{ backup: Backup }>('/api/admin/backups'),
    onSuccess: (d) => {
      toast[d.backup.status === 'completed' ? 'success' : 'error'](d.backup.status === 'completed' ? `Backup completed (${formatBytes(d.backup.sizeBytes ?? 0)})` : d.backup.error ?? 'Backup failed');
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Backup failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/admin/backups/${id}`), onSuccess: refresh });
  const settings = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch('/api/admin/settings', body),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
  const restore = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set('file', restoreFile!);
      form.set('confirm', 'RESTORE');
      return api<{ counts: Record<string, number> }>('/api/admin/backups/restore', { method: 'POST', body: form });
    },
    onSuccess: () => {
      toast.success('Backup restored. Reloading…');
      setTimeout(() => window.location.reload(), 1200);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Restore failed'),
  });
  return (
    <>
      <SectionCard
        title="Backups"
        description="Logical JSON dumps of every table, stored in R2 under backups/. Cloudflare D1 also keeps 30 days of point-in-time history (Time Travel) independently."
        actions={
          <Button size="sm" variant="primary" onClick={() => run.mutate()} loading={run.isPending}>
            <HardDrive className="h-4 w-4" /> Back up now
          </Button>
        }
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
            <span>Nightly automatic backups (03:00 UTC)</span>
            <Switch checked={data.data?.enabled ?? false} onCheckedChange={(v) => settings.mutate({ backupsEnabled: v })} />
          </div>
          <Field label="Keep the latest">
            <Select value={String(data.data?.retention ?? 14)} onChange={(e) => settings.mutate({ backupRetentionCount: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} backups
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ul className="divide-y text-sm">
          {(data.data?.items ?? []).map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Badge className={b.status === 'completed' ? 'bg-success/15 text-success' : b.status === 'failed' ? 'bg-danger/15 text-danger' : ''}>{b.status}</Badge>
              <span className="min-w-0 flex-1 truncate">
                {b.filename ?? 'backup'} <span className="text-xs text-muted">· {b.trigger} · {formatFullDate(b.createdAt)}</span>
                {b.error && <span className="text-xs text-danger"> · {b.error}</span>}
              </span>
              <span className="text-xs text-muted">{b.sizeBytes ? formatBytes(b.sizeBytes) : ''}</span>
              {b.status === 'completed' && (
                <Button size="sm" variant="ghost" onClick={() => downloadUrl(`/api/admin/backups/${b.id}/download`)}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(b.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
          {data.data?.items.length === 0 && <li className="py-6 text-center text-muted">No backups yet.</li>}
        </ul>
      </SectionCard>
      <SectionCard title="Restore" description="Replaces every table with the contents of a backup file. Attachments and raw messages in R2 are untouched.">
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-secondary cursor-pointer">
            <Upload className="h-4 w-4" /> {restoreFile ? restoreFile.name : 'Choose backup .json'}
            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button variant="danger" disabled={!restoreFile} onClick={() => setConfirmRestore(true)}>
            <RefreshCw className="h-4 w-4" /> Restore
          </Button>
        </div>
      </SectionCard>
      <ConfirmDialog open={confirmRestore} onOpenChange={setConfirmRestore} title="Restore this backup?" description="All current data (users, mail, settings) will be replaced. This cannot be undone." confirmLabel="Replace everything" danger loading={restore.isPending} onConfirm={() => restore.mutate()} />
    </>
  );
}
