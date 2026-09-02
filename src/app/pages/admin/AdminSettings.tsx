import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input, SectionCard, Select, Switch } from '../../components/ui';
import { api, del, get, patch } from '../../lib/api';
import { keys } from '../../lib/queries';
import { formatBytes } from '../../lib/utils';
import { Row } from '../SettingsPage';

type Settings = {
  appName: string;
  logoKey: string | null;
  accentColor: string;
  allowSignups: boolean;
  trashRetentionDays: number;
  spamRetentionDays: number;
  maxAttachmentBytes: number;
  maxMessageBytes: number;
  defaultUndoSendSeconds: number;
  requireTwoFactorForAdmins: boolean;
  backupsEnabled: boolean;
  backupRetentionCount: number;
  publicApiEnabled: boolean;
  inboundCategorization: boolean;
};

const ACCENTS = ['#4f46e5', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#0f766e', '#334155'];

export function AdminSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => get<{ settings: Settings }>('/api/admin/settings') });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (query.data && !form) setForm(query.data.settings);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => patch('/api/admin/settings', body),
    onSuccess: () => {
      toast.success('Settings saved');
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.config });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  const storage = useQuery({ queryKey: ['admin', 'storage'], queryFn: () => get<{ byMailbox: Array<{ address: string; count: number; bytes: number }>; olderThanYear: { count: number; bytes: number } }>('/api/admin/settings/storage') });

  async function uploadLogo(file: File) {
    const fd = new FormData();
    fd.set('file', file);
    try {
      await api('/api/admin/settings/logo', { method: 'POST', body: fd });
      toast.success('Logo updated');
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.config });
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  if (!form) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const commit = (k: keyof Settings) => save.mutate({ [k]: form[k] });

  return (
    <>
      <SectionCard title="Branding" description="How this instance presents itself to users.">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            {query.data?.settings.logoKey ? <img src={`/api/branding/logo?v=${query.data.settings.logoKey}`} alt="" className="h-16 w-16 rounded-2xl object-contain" /> : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-accent-foreground"><Inbox className="h-7 w-7" /></span>}
            <label className="btn btn-secondary h-8 cursor-pointer text-xs">
              <Upload className="h-3.5 w-3.5" /> Logo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
            </label>
            {query.data?.settings.logoKey && (
              <button className="text-xs text-muted hover:text-danger" onClick={() => del('/api/admin/settings/logo').then(() => { void qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); void qc.invalidateQueries({ queryKey: keys.me }); void qc.invalidateQueries({ queryKey: keys.config }); })}>
                Remove
              </button>
            )}
          </div>
          <div className="space-y-4">
            <Field label="Application name">
              <div className="flex gap-2">
                <Input value={form.appName} onChange={(e) => set('appName', e.target.value)} maxLength={60} />
                <Button onClick={() => commit('appName')} loading={save.isPending}>
                  Save
                </Button>
              </div>
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted">Accent color</span>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => (
                  <button key={c} aria-label={c} className="h-7 w-7 rounded-full ring-offset-2 ring-offset-surface" style={{ background: c, boxShadow: form.accentColor === c ? '0 0 0 2px var(--text)' : undefined }} onClick={() => { set('accentColor', c); save.mutate({ accentColor: c }); document.documentElement.style.setProperty('--accent', c); }} />
                ))}
                <input type="color" value={form.accentColor} onChange={(e) => { set('accentColor', e.target.value); document.documentElement.style.setProperty('--accent', e.target.value); }} onBlur={() => commit('accentColor')} className="h-7 w-10 cursor-pointer rounded border bg-transparent" aria-label="Custom accent color" />
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Access">
        <div className="divide-y">
          <Row label="Open sign-ups" hint="Let anyone create an account (they still need an admin to assign a mailbox).">
            <Switch checked={form.allowSignups} onCheckedChange={(v) => { set('allowSignups', v); save.mutate({ allowSignups: v }); }} />
          </Row>
          <Row label="Public API" hint="Allow API keys to be created and used.">
            <Switch checked={form.publicApiEnabled} onCheckedChange={(v) => { set('publicApiEnabled', v); save.mutate({ publicApiEnabled: v }); }} />
          </Row>
          <Row label="Inbox categorization" hint="Classify incoming mail into Primary, Social, Promotions, Updates and Forums.">
            <Switch checked={form.inboundCategorization} onCheckedChange={(v) => { set('inboundCategorization', v); save.mutate({ inboundCategorization: v }); }} />
          </Row>
        </div>
      </SectionCard>

      <SectionCard title="Limits & retention">
        <div className="divide-y">
          <Row label="Trash retention" hint="Conversations in Trash are deleted after this many days.">
            <Select value={String(form.trashRetentionDays)} onChange={(e) => { set('trashRetentionDays', Number(e.target.value)); save.mutate({ trashRetentionDays: Number(e.target.value) }); }} className="w-32">
              {[7, 14, 30, 60, 90, 365, 0].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Never' : `${n} days`}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Spam retention">
            <Select value={String(form.spamRetentionDays)} onChange={(e) => { set('spamRetentionDays', Number(e.target.value)); save.mutate({ spamRetentionDays: Number(e.target.value) }); }} className="w-32">
              {[7, 14, 30, 60, 90, 0].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Never' : `${n} days`}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Max attachment size" hint="Per file, when composing. Providers have their own total message limits (Cloudflare: 5 MB).">
            <Select value={String(form.maxAttachmentBytes)} onChange={(e) => { set('maxAttachmentBytes', Number(e.target.value)); save.mutate({ maxAttachmentBytes: Number(e.target.value) }); }} className="w-32">
              {[5, 10, 20, 25, 40].map((mb) => (
                <option key={mb} value={mb * 1024 * 1024}>
                  {mb} MB
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Max incoming message size" hint="Larger messages are rejected at SMTP time.">
            <Select value={String(form.maxMessageBytes)} onChange={(e) => { set('maxMessageBytes', Number(e.target.value)); save.mutate({ maxMessageBytes: Number(e.target.value) }); }} className="w-32">
              {[10, 25, 50].map((mb) => (
                <option key={mb} value={mb * 1024 * 1024}>
                  {mb} MB
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Default undo-send window" hint="Users can override this in their settings.">
            <Select value={String(form.defaultUndoSendSeconds)} onChange={(e) => { set('defaultUndoSendSeconds', Number(e.target.value)); save.mutate({ defaultUndoSendSeconds: Number(e.target.value) }); }} className="w-32">
              {[0, 5, 10, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Off' : `${n}s`}
                </option>
              ))}
            </Select>
          </Row>
        </div>
      </SectionCard>

      <SectionCard title="Storage" description="Largest mailboxes by stored message size (attachments and raw messages live in R2).">
        <ul className="divide-y text-sm">
          {(storage.data?.byMailbox ?? []).slice(0, 10).map((m) => (
            <li key={m.address} className="flex items-center justify-between py-2">
              <span>{m.address}</span>
              <span className="text-muted">
                {m.count.toLocaleString()} messages · {formatBytes(m.bytes)}
              </span>
            </li>
          ))}
        </ul>
        {storage.data && <p className="mt-3 text-xs text-muted">Older than one year: {storage.data.olderThanYear.count.toLocaleString()} messages, {formatBytes(storage.data.olderThanYear.bytes)}.</p>}
      </SectionCard>
    </>
  );
}
