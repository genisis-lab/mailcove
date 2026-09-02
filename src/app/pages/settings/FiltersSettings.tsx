import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FilterActions, FilterCondition } from '@shared/types';
import { Ban, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { del, patch, post } from '../../lib/api';
import { useApp } from '../../lib/app-state';
import { keys, useBlocked, useFilters } from '../../lib/queries';
import type { Filter } from '../../lib/types';
import { Badge, Button, Dialog, Field, IconButton, Input, SectionCard, Select, Switch } from './shared';

const FIELDS: Array<{ id: FilterCondition['field']; label: string }> = [
  { id: 'from', label: 'From' },
  { id: 'to', label: 'To' },
  { id: 'subject', label: 'Subject' },
  { id: 'body', label: 'Body contains' },
  { id: 'list_id', label: 'Mailing list id' },
  { id: 'header', label: 'Header' },
  { id: 'has_attachment', label: 'Has attachment' },
  { id: 'size_gt', label: 'Size larger than' },
  { id: 'size_lt', label: 'Size smaller than' },
];

const OPERATORS: Array<{ id: NonNullable<FilterCondition['operator']>; label: string }> = [
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: "doesn't contain" },
  { id: 'equals', label: 'is exactly' },
  { id: 'starts_with', label: 'starts with' },
  { id: 'ends_with', label: 'ends with' },
  { id: 'matches', label: 'matches regex' },
];

function describe(filter: Filter): string {
  return filter.conditions
    .map((c) => {
      const f = FIELDS.find((x) => x.id === c.field)?.label ?? c.field;
      if (c.field === 'has_attachment') return 'has attachment';
      if (c.field.startsWith('size')) return `${f} ${c.value}`;
      return `${f} ${OPERATORS.find((o) => o.id === (c.operator ?? 'contains'))?.label} “${c.value}”`;
    })
    .join(filter.matchType === 'any' ? ' or ' : ' and ');
}

function describeActions(a: FilterActions, labelName: (id: string) => string): string[] {
  const out: string[] = [];
  if (a.skipInbox) out.push('Skip inbox');
  if (a.markRead) out.push('Mark read');
  if (a.star) out.push('Star');
  if (a.markImportant) out.push('Important');
  if (a.labelIds?.length) out.push(`Label: ${a.labelIds.map(labelName).join(', ')}`);
  if (a.forwardTo) out.push(`Forward to ${a.forwardTo}`);
  if (a.markSpam) out.push('Spam');
  if (a.neverSpam) out.push('Never spam');
  if (a.trash) out.push('Delete');
  if (a.category) out.push(`Category: ${a.category}`);
  return out;
}

export function FiltersSettings() {
  const { me } = useApp();
  const qc = useQueryClient();
  const filters = useFilters();
  const blocked = useBlocked();
  const [editing, setEditing] = useState<Filter | 'new' | null>(null);
  const [blockInput, setBlockInput] = useState('');
  const labelName = (id: string) => me?.labels.find((l) => l.id === id)?.name ?? 'label';

  const toggle = useMutation({
    mutationFn: (f: Filter) => patch(`/api/filters/${f.id}`, { enabled: !f.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.filters }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/filters/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.filters }),
  });
  const addBlock = useMutation({
    mutationFn: () => post('/api/blocked', { pattern: blockInput }),
    onSuccess: () => {
      setBlockInput('');
      void qc.invalidateQueries({ queryKey: keys.blocked });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not block'),
  });
  const unblock = useMutation({
    mutationFn: (id: string) => del(`/api/blocked/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.blocked }),
  });

  return (
    <>
      <SectionCard
        title="Filters"
        description="Rules run on every incoming message, top to bottom."
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Create filter
          </Button>
        }
      >
        <ul className="divide-y">
          {(filters.data?.items ?? []).map((f) => (
            <li key={f.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <Switch checked={f.enabled} onCheckedChange={() => toggle.mutate(f)} />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(f)}>
                <div className="text-sm font-medium">{f.name || describe(f)}</div>
                {f.name && <div className="text-xs text-muted">{describe(f)}</div>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {describeActions(f.actions, labelName).map((a) => (
                    <Badge key={a}>{a}</Badge>
                  ))}
                </div>
              </button>
              <IconButton label="Delete filter" size="sm" onClick={() => remove.mutate(f.id)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
          {filters.data?.items.length === 0 && <li className="py-6 text-center text-sm text-muted">No filters yet.</li>}
        </ul>
      </SectionCard>

      <SectionCard title="Blocked senders" description="Mail from these addresses or domains goes straight to Spam.">
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (blockInput.trim()) addBlock.mutate();
          }}
        >
          <Input value={blockInput} onChange={(e) => setBlockInput(e.target.value)} placeholder="spammer@example.com or @example.com" />
          <Button type="submit" variant="primary" loading={addBlock.isPending}>
            <Ban className="h-4 w-4" /> Block
          </Button>
        </form>
        <ul className="divide-y">
          {(blocked.data?.items ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono text-xs">{b.pattern}</span>
              <Button size="sm" variant="ghost" onClick={() => unblock.mutate(b.id)}>
                Unblock
              </Button>
            </li>
          ))}
          {blocked.data?.items.length === 0 && <li className="py-4 text-center text-sm text-muted">Nobody is blocked.</li>}
        </ul>
      </SectionCard>

      {editing && <FilterDialog filter={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function FilterDialog({ filter, onClose }: { filter: Filter | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useApp();
  const [name, setName] = useState(filter?.name ?? '');
  const [matchType, setMatchType] = useState<'all' | 'any'>(filter?.matchType ?? 'all');
  const [mailboxId, setMailboxId] = useState<string>(filter?.mailboxId ?? '');
  const [conditions, setConditions] = useState<FilterCondition[]>(filter?.conditions ?? [{ field: 'from', operator: 'contains', value: '' }]);
  const [actions, setActions] = useState<FilterActions>(filter?.actions ?? {});

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name || null, matchType, mailboxId: mailboxId || null, conditions, actions, enabled: filter?.enabled ?? true };
      return filter ? patch(`/api/filters/${filter.id}`, body) : post('/api/filters', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.filters });
      toast.success(filter ? 'Filter updated' : 'Filter created');
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save filter'),
  });

  const setAction = <K extends keyof FilterActions>(k: K, v: FilterActions[K]) => setActions((a) => ({ ...a, [k]: v }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={filter ? 'Edit filter' : 'Create filter'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={conditions.some((c) => c.field !== 'has_attachment' && !c.value)}>
            {filter ? 'Save' : 'Create filter'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Newsletters" />
          </Field>
          <Field label="Applies to">
            <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
              <option value="">All my mailboxes</option>
              {me?.mailboxes.filter((m) => m.permission === 'full_access').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="font-medium">When</span>
            <Select value={matchType} onChange={(e) => setMatchType(e.target.value as 'all' | 'any')} className="h-8 w-40 text-xs">
              <option value="all">all conditions match</option>
              <option value="any">any condition matches</option>
            </Select>
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={c.field} onChange={(e) => setConditions((list) => list.map((x, j) => (j === i ? { ...x, field: e.target.value as FilterCondition['field'] } : x)))} className="h-8 w-44 text-xs">
                  {FIELDS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
                {c.field === 'header' && <Input value={c.header ?? ''} onChange={(e) => setConditions((list) => list.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)))} placeholder="X-Header-Name" className="h-8 w-40 text-xs" />}
                {!['has_attachment', 'size_gt', 'size_lt'].includes(c.field) && (
                  <Select value={c.operator ?? 'contains'} onChange={(e) => setConditions((list) => list.map((x, j) => (j === i ? { ...x, operator: e.target.value as FilterCondition['operator'] } : x)))} className="h-8 w-36 text-xs">
                    {OPERATORS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
                {c.field !== 'has_attachment' && (
                  <Input value={c.value ?? ''} onChange={(e) => setConditions((list) => list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={c.field.startsWith('size') ? '5MB' : 'value'} className="h-8 min-w-40 flex-1 text-xs" />
                )}
                <IconButton label="Remove condition" size="sm" onClick={() => setConditions((list) => list.filter((_, j) => j !== i))} disabled={conditions.length === 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setConditions((list) => [...list, { field: 'subject', operator: 'contains', value: '' }])}>
            <Plus className="h-3.5 w-3.5" /> Add condition
          </Button>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Then</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['skipInbox', 'Skip the inbox (archive)'],
                ['markRead', 'Mark as read'],
                ['star', 'Star it'],
                ['markImportant', 'Mark as important'],
                ['markSpam', 'Move to spam'],
                ['neverSpam', 'Never send to spam'],
                ['trash', 'Delete it'],
              ] as Array<[keyof FilterActions, string]>
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(actions[key])} onChange={(e) => setAction(key, e.target.checked as never)} className="accent-[var(--accent)]" />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Apply labels">
              <div className="flex flex-wrap gap-1.5 rounded-lg border p-2">
                {(me?.labels ?? []).map((l) => {
                  const on = actions.labelIds?.includes(l.id) ?? false;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setAction('labelIds', on ? (actions.labelIds ?? []).filter((x) => x !== l.id) : [...(actions.labelIds ?? []), l.id])}
                      className="label-pill border"
                      style={on ? { background: l.color, color: '#fff', borderColor: l.color } : { borderColor: l.color, color: l.color }}
                    >
                      {l.name}
                    </button>
                  );
                })}
                {(me?.labels.length ?? 0) === 0 && <span className="text-xs text-faint">No labels yet</span>}
              </div>
            </Field>
            <div className="space-y-3">
              <Field label="Forward to">
                <Input type="email" value={actions.forwardTo ?? ''} onChange={(e) => setAction('forwardTo', e.target.value || undefined)} placeholder="someone@example.com" />
              </Field>
              <Field label="Categorize as">
                <Select value={actions.category ?? ''} onChange={(e) => setAction('category', (e.target.value || undefined) as FilterActions['category'])}>
                  <option value="">Don&apos;t change</option>
                  <option value="primary">Primary</option>
                  <option value="social">Social</option>
                  <option value="promotions">Promotions</option>
                  <option value="updates">Updates</option>
                  <option value="forums">Forums</option>
                </Select>
              </Field>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
