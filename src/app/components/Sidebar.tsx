import { useDroppable } from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  Archive,
  ChevronDown,
  Clock,
  FileText,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Shield,
  Star,
  Tag,
  Trash2,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useApp } from '../lib/app-state';
import { del, patch, post } from '../lib/api';
import { keys, useCounts } from '../lib/queries';
import type { Label } from '../lib/types';
import { cn } from '../lib/utils';
import { Button, Dialog, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Select } from './ui';

const SYSTEM_VIEWS: Array<{ view: string; label: string; icon: typeof Inbox; count?: (c: NonNullable<ReturnType<typeof useCounts>['data']>) => number | null; muted?: boolean }> = [
  { view: 'inbox', label: 'Inbox', icon: Inbox, count: (c) => c.inboxUnread },
  { view: 'starred', label: 'Starred', icon: Star },
  { view: 'snoozed', label: 'Snoozed', icon: Clock },
  { view: 'sent', label: 'Sent', icon: Send },
  { view: 'drafts', label: 'Drafts', icon: FileText, count: (c) => c.drafts, muted: true },
  { view: 'scheduled', label: 'Scheduled', icon: Clock, count: (c) => c.scheduled, muted: true },
  { view: 'all', label: 'All mail', icon: Archive },
  { view: 'spam', label: 'Spam', icon: AlertOctagon, count: (c) => c.spamUnread },
  { view: 'trash', label: 'Trash', icon: Trash2 },
];

const LABEL_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b'];

export function Sidebar() {
  const { me, sidebarOpen, openCompose, selectedMailbox, setSelectedMailbox } = useApp();
  const counts = useCounts(Boolean(me));
  const [showMore, setShowMore] = useState(false);
  const [labelDialog, setLabelDialog] = useState<{ open: boolean; label?: Label | null }>({ open: false });

  const labels = useMemo(() => (me?.labels ?? []).filter((l) => l.visibility !== 'hide' || (counts.data?.labels[l.id]?.unread ?? 0) > 0), [me?.labels, counts.data]);
  const primary = SYSTEM_VIEWS.slice(0, 5);
  const secondary = SYSTEM_VIEWS.slice(5);

  return (
    <aside
      className={cn(
        'z-40 flex w-64 shrink-0 flex-col overflow-hidden transition-[width,transform] duration-200 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:top-14 max-lg:bg-bg max-lg:shadow-xl lg:relative',
        sidebarOpen ? 'translate-x-0 lg:w-64' : 'max-lg:-translate-x-full lg:w-[72px]',
      )}
    >
      <div className="px-3 pb-2 pt-1">
        <Button variant="primary" size="lg" className={cn('h-12 shadow-md hover:shadow-lg', sidebarOpen ? 'w-full justify-start rounded-2xl px-5' : 'w-12 rounded-2xl px-0')} onClick={() => openCompose({ mode: 'new' })} aria-label="Compose">
          <Pencil className="h-4 w-4" />
          {sidebarOpen && <span>Compose</span>}
        </Button>
      </div>

      {me && me.mailboxes.length > 1 && sidebarOpen && (
        <div className="px-3 pb-2">
          <Select value={selectedMailbox} onChange={(e) => setSelectedMailbox(e.target.value)} className="h-9 text-xs" aria-label="Mailbox">
            <option value="all">All mailboxes</option>
            {me.mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.address}
              </option>
            ))}
          </Select>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto pb-4 pr-3">
        <ul className="space-y-px">
          {primary.map((item) => (
            <NavItem key={item.view} item={item} count={counts.data && item.count ? item.count(counts.data) : null} collapsed={!sidebarOpen} />
          ))}
          <li>
            <button className={cn('nav-item text-muted', !sidebarOpen && 'justify-center pl-0 pr-0')} onClick={() => setShowMore((v) => !v)}>
              <ChevronDown className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')} />
              {sidebarOpen && <span>{showMore ? 'Less' : 'More'}</span>}
            </button>
          </li>
          {showMore && secondary.map((item) => <NavItem key={item.view} item={item} count={counts.data && item.count ? item.count(counts.data) : null} collapsed={!sidebarOpen} />)}
        </ul>

        <div className="mt-4">
          <div className={cn('mb-1 flex items-center justify-between pl-6 pr-1', !sidebarOpen && 'justify-center pl-0')}>
            {sidebarOpen && <span className="text-xs font-semibold uppercase tracking-wide text-faint">Labels</span>}
            <button className="icon-btn h-7 w-7" aria-label="Create label" onClick={() => setLabelDialog({ open: true, label: null })}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <ul className="space-y-px">
            {labels.map((label) => (
              <LabelItem key={label.id} label={label} count={counts.data?.labels[label.id]} collapsed={!sidebarOpen} onEdit={() => setLabelDialog({ open: true, label })} />
            ))}
            {labels.length === 0 && sidebarOpen && <li className="px-6 py-2 text-xs text-faint">No labels yet. Create one to organize threads.</li>}
          </ul>
        </div>

        {me?.user.isAdmin && (
          <div className="mt-4">
            <NavLink to="/admin" className={cn('nav-item', !sidebarOpen && 'justify-center pl-0 pr-0')}>
              <Shield className="h-4 w-4" />
              {sidebarOpen && <span>Admin</span>}
            </NavLink>
          </div>
        )}
      </nav>

      {sidebarOpen && me && (
        <div className="border-t px-6 py-3 text-xs text-faint">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            {me.mailboxes.length} {me.mailboxes.length === 1 ? 'mailbox' : 'mailboxes'}
          </div>
        </div>
      )}

      <LabelDialog state={labelDialog} onClose={() => setLabelDialog({ open: false })} />
    </aside>
  );
}

function NavItem({ item, count, collapsed }: { item: (typeof SYSTEM_VIEWS)[number]; count: number | null; collapsed: boolean }) {
  const Icon = item.icon;
  const { setNodeRef, isOver } = useDroppable({ id: `view:${item.view}`, data: { type: 'view', view: item.view } });
  const droppable = ['inbox', 'spam', 'trash', 'all'].includes(item.view);
  return (
    <li ref={droppable ? setNodeRef : undefined}>
      <NavLink to={`/mail/${item.view}`} className={cn('nav-item relative', collapsed && 'justify-center pl-0 pr-0', isOver && droppable && 'ring-2 ring-accent/60')} title={item.label}>
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && count ? <span className={cn('text-xs font-semibold', item.muted && 'font-normal text-muted')}>{count.toLocaleString()}</span> : null}
        {collapsed && count ? <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-accent" /> : null}
      </NavLink>
    </li>
  );
}

function LabelItem({ label, count, collapsed, onEdit }: { label: Label; count?: { total: number; unread: number }; collapsed: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setNodeRef, isOver } = useDroppable({ id: `label:${label.id}`, data: { type: 'label', labelId: label.id } });
  const remove = useMutation({
    mutationFn: () => del(`/api/labels/${label.id}`),
    onSuccess: () => {
      toast.success(`Deleted label “${label.name}”`);
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: ['threads'] });
      navigate('/mail/inbox');
    },
  });
  return (
    <li ref={setNodeRef} className="group relative">
      <NavLink to={`/mail/label/${label.id}`} className={cn('nav-item', collapsed && 'justify-center pl-0 pr-0', isOver && 'ring-2 ring-accent/60')} title={label.name}>
        <Tag className="h-4 w-4 shrink-0" style={{ color: label.color }} />
        {!collapsed && <span className="flex-1 truncate">{label.name}</span>}
        {!collapsed && count?.unread ? <span className="text-xs font-semibold group-hover:hidden">{count.unread}</span> : null}
      </NavLink>
      {!collapsed && (
        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn absolute right-1 top-0.5 hidden h-7 w-7 group-hover:inline-flex data-[state=open]:inline-flex" aria-label={`Options for ${label.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={onEdit}>Edit</MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => remove.mutate()}>
              Remove label
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </li>
  );
}

function LabelDialog({ state, onClose }: { state: { open: boolean; label?: Label | null }; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = state.label ?? null;
  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState(editing?.color ?? LABEL_COLORS[8]!);
  const [visibility, setVisibility] = useState<Label['visibility']>(editing?.visibility ?? 'show');
  const [key, setKey] = useState(editing?.id ?? 'new');
  if ((editing?.id ?? 'new') !== key) {
    setKey(editing?.id ?? 'new');
    setName(editing?.name ?? '');
    setColor(editing?.color ?? LABEL_COLORS[8]!);
    setVisibility(editing?.visibility ?? 'show');
  }
  const save = useMutation({
    mutationFn: () => (editing ? patch(`/api/labels/${editing.id}`, { name, color, visibility }) : post('/api/labels', { name, color, visibility })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: ['threads'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save label'),
  });
  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Edit label' : 'New label'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
        </Field>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted">Color</span>
          <div className="flex flex-wrap gap-2">
            {LABEL_COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={cn('h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition-shadow', color === c && 'ring-2 ring-text')} style={{ background: c }} />
            ))}
          </div>
        </div>
        <Field label="Show in menu">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value as Label['visibility'])}>
            <option value="show">Always</option>
            <option value="show_if_unread">Only when unread</option>
            <option value="hide">Hide</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
