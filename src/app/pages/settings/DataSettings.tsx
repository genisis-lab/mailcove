import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Plus, Send, Tag, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Editor, type EditorHandle } from '../../components/Editor';
import { api, del, patch, post } from '../../lib/api';
import { useApp } from '../../lib/app-state';
import { keys, useFilters, useTemplates } from '../../lib/queries';
import type { Filter, Label, Template } from '../../lib/types';
import { downloadUrl } from '../../lib/utils';
import { Button, Dialog, Field, IconButton, Input, SectionCard, Select } from './shared';

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b'];

export function LabelsSettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => post('/api/labels', { name }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create label'),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Label> }) => patch(`/api/labels/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.me }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/labels/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
  return (
    <SectionCard title="Labels" description="Labels apply to conversations across all your mailboxes.">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label name" maxLength={60} />
        <Button type="submit" variant="primary" loading={create.isPending}>
          <Plus className="h-4 w-4" /> Create
        </Button>
      </form>
      <ul className="divide-y">
        {(me?.labels ?? []).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Tag className="h-4 w-4" style={{ color: l.color }} />
            <Input defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && e.target.value.trim() && update.mutate({ id: l.id, body: { name: e.target.value.trim() } })} className="h-8 w-48 text-sm" />
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} aria-label={c} onClick={() => update.mutate({ id: l.id, body: { color: c } })} className="h-4 w-4 rounded-full ring-offset-1 ring-offset-surface" style={{ background: c, boxShadow: l.color === c ? '0 0 0 2px var(--text)' : undefined }} />
              ))}
            </div>
            <Select value={l.visibility} onChange={(e) => update.mutate({ id: l.id, body: { visibility: e.target.value as Label['visibility'] } })} className="h-8 w-40 text-xs">
              <option value="show">Show in menu</option>
              <option value="show_if_unread">Show if unread</option>
              <option value="hide">Hide</option>
            </Select>
            <IconButton label="Delete label" size="sm" className="ml-auto" onClick={() => remove.mutate(l.id)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </li>
        ))}
        {(me?.labels.length ?? 0) === 0 && <li className="py-6 text-center text-sm text-muted">No labels yet.</li>}
      </ul>
    </SectionCard>
  );
}

export function TemplatesSettings() {
  const qc = useQueryClient();
  const templates = useTemplates();
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.templates }),
  });
  return (
    <>
      <SectionCard
        title="Templates"
        description="Reusable snippets you can insert from the composer."
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> New template
          </Button>
        }
      >
        <ul className="divide-y">
          {(templates.data?.items ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <FileText className="h-4 w-4 text-muted" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(t)}>
                <div className="text-sm font-medium">{t.name}</div>
                {t.subject && <div className="truncate text-xs text-muted">Subject: {t.subject}</div>}
              </button>
              <IconButton label="Delete template" size="sm" onClick={() => remove.mutate(t.id)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
          {templates.data?.items.length === 0 && <li className="py-6 text-center text-sm text-muted">No templates yet.</li>}
        </ul>
      </SectionCard>
      {editing && <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateDialog({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const editorRef = useRef<EditorHandle>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, subject: subject || null, bodyHtml: editorRef.current?.getHtml() ?? '' };
      return template ? patch(`/api/templates/${template.id}`, body) : post('/api/templates', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.templates });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={template ? 'Edit template' : 'New template'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Subject (optional)" hint="Used when the composer subject is empty.">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <div className="rounded-lg border px-2 pb-1">
          <Editor ref={editorRef} initialHtml={template?.bodyHtml ?? ''} minHeight={160} placeholder="Template body…" />
        </div>
      </div>
    </Dialog>
  );
}

export function ImportExportSettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const [mailboxId, setMailboxId] = useState<string>(me?.mailboxes.find((m) => m.permission === 'full_access')?.id ?? '');
  const [exportMailbox, setExportMailbox] = useState('all');
  const [files, setFiles] = useState<File[]>([]);
  const importMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set('mailboxId', mailboxId);
      for (const f of files) form.append('file', f);
      return api<{ imported: number; failed: number }>('/api/import', { method: 'POST', body: form });
    },
    onSuccess: (data) => {
      toast.success(`Imported ${data.imported} message${data.imported === 1 ? '' : 's'}${data.failed ? `, ${data.failed} failed` : ''}`);
      setFiles([]);
      void qc.invalidateQueries({ queryKey: ['threads'] });
      void qc.invalidateQueries({ queryKey: keys.counts });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });
  return (
    <>
      <SectionCard title="Export" description="Download your mail as an mbox archive that any mail client can open.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Mailbox" className="min-w-56">
            <Select value={exportMailbox} onChange={(e) => setExportMailbox(e.target.value)}>
              <option value="all">All mailboxes</option>
              {me?.mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" onClick={() => downloadUrl(`/api/export/mbox${exportMailbox !== 'all' ? `?mailbox=${exportMailbox}` : ''}`)}>
            <Download className="h-4 w-4" /> Download .mbox
          </Button>
        </div>
      </SectionCard>
      <SectionCard title="Import" description="Upload .eml or .mbox files. Messages are threaded and filtered like new mail, without notifications.">
        <div className="space-y-3">
          <Field label="Import into">
            <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
              {me?.mailboxes.filter((m) => m.permission === 'full_access').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted hover:bg-surface-2">
            <Upload className="h-6 w-6" />
            {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected` : 'Choose .eml or .mbox files'}
            <input type="file" multiple accept=".eml,.mbox,message/rfc822,application/mbox" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          <Button variant="primary" disabled={!files.length || !mailboxId} loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
            Import {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

/** Dedicated forwarding page — wraps a catch-all filter so mail can be relayed off-box. */
export function ForwardingSettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const filters = useFilters();
  const forwards = (filters.data?.items ?? []).filter((f: Filter) => Boolean(f.actions.forwardTo));
  const [mailboxId, setMailboxId] = useState(me?.mailboxes[0]?.id ?? '');
  const [target, setTarget] = useState('');

  const create = useMutation({
    mutationFn: () =>
      post('/api/filters', {
        name: `Forward to ${target}`,
        mailboxId: mailboxId || null,
        matchType: 'all',
        conditions: [{ field: 'from', operator: 'matches', value: '.' }],
        actions: { forwardTo: target.trim() },
      }),
    onSuccess: () => {
      setTarget('');
      toast.success('Forwarding rule created');
      void qc.invalidateQueries({ queryKey: keys.filters });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create rule'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/filters/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.filters }),
  });

  return (
    <SectionCard
      title="Forwarding"
      description="Relay incoming mail to another address. Mailcove still keeps a copy. Loop protection skips messages already marked as forwarded."
    >
      <ul className="divide-y">
        {forwards.map((f: Filter) => (
          <li key={f.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Send className="h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">
                {f.name || 'Forward'} → {f.actions.forwardTo}
              </div>
              <div className="text-xs text-muted">{f.enabled ? 'Active' : 'Paused'}{f.mailboxId ? ` · ${me?.mailboxes.find((m) => m.id === f.mailboxId)?.address ?? 'one mailbox'}` : ' · all mailboxes'}</div>
            </div>
            <IconButton label="Remove" onClick={() => remove.mutate(f.id)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </li>
        ))}
        {forwards.length === 0 && <li className="py-4 text-sm text-muted">No forwarding rules yet. Incoming mail stays in Mailcove only.</li>}
      </ul>
      <form
        className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (target.trim()) create.mutate();
        }}
      >
        <Field label="Mailbox" className="min-w-52">
          <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            <option value="">All mailboxes</option>
            {me?.mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.address}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forward to" className="min-w-64 flex-1">
          <Input type="email" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="backup@example.com" />
        </Field>
        <Button type="submit" variant="primary" loading={create.isPending} disabled={!target.trim()}>
          Add rule
        </Button>
      </form>
    </SectionCard>
  );
}
