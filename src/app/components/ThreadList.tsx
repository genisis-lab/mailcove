import { useDraggable } from '@dnd-kit/core';
import type { Category } from '@shared/types';
import {
  AlertOctagon,
  Archive,
  ArchiveRestore,
  Clock,
  Inbox,
  Mail,
  MailOpen,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Search,
  Star,
  Tag,
  Trash2,
  Users,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useApp } from '../lib/app-state';
import type { ThreadActionInput } from '../lib/queries';
import type { ThreadItem } from '../lib/types';
import { cn, formatBytes, formatListDate } from '../lib/utils';
import { LabelMenu, SnoozeMenu } from './ActionMenus';
import { Badge, Checkbox, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, Tooltip } from './ui';

export type ListAction = (input: Omit<ThreadActionInput, 'ids'> & { ids?: string[] }, threads?: ThreadItem[]) => void;

type Props = {
  view: string;
  threads: ThreadItem[];
  total?: number;
  loading: boolean;
  fetchingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  selected: Set<string>;
  onToggleSelect: (id: string, shift?: boolean) => void;
  onSelectAll: (all: boolean) => void;
  activeId: string | null;
  focusedIndex: number;
  onOpen: (thread: ThreadItem) => void;
  onAction: ListAction;
  category: Category | null;
  onCategoryChange: (c: Category | null) => void;
  categoryCounts?: Record<Category, number>;
  compact: boolean;
  headerExtra?: ReactNode;
};

const CATEGORY_TABS: Array<{ id: Category; label: string }> = [
  { id: 'primary', label: 'Primary' },
  { id: 'social', label: 'Social' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'updates', label: 'Updates' },
  { id: 'forums', label: 'Forums' },
];

const EMPTY_COPY: Record<string, { title: string; description: string; icon: ReactNode }> = {
  inbox: { title: 'Your inbox is empty', description: 'New mail lands here the moment it arrives. Enjoy the quiet.', icon: <Inbox /> },
  starred: { title: 'No starred conversations', description: 'Star messages you want to find again quickly.', icon: <Star /> },
  snoozed: { title: 'Nothing snoozed', description: 'Snoozed conversations reappear in your inbox at the time you choose.', icon: <Clock /> },
  sent: { title: 'No sent mail yet', description: 'Messages you send will show up here.', icon: <Mail /> },
  drafts: { title: 'No drafts', description: 'Drafts are saved automatically while you write.', icon: <Mail /> },
  scheduled: { title: 'Nothing scheduled', description: 'Use “Schedule send” in the composer to send later.', icon: <Clock /> },
  all: { title: 'No mail yet', description: 'Every conversation except spam and trash lives here.', icon: <Archive /> },
  spam: { title: 'No spam', description: 'Suspicious mail is filed here and deleted after 30 days.', icon: <AlertOctagon /> },
  trash: { title: 'Trash is empty', description: 'Deleted conversations stay here for 30 days.', icon: <Trash2 /> },
  label: { title: 'No conversations with this label', description: 'Drag conversations here or use “Label as”.', icon: <Tag /> },
  search: { title: 'No results', description: 'Try different words or operators like from:, subject:, has:attachment, newer_than:7d.', icon: <Search /> },
};

export function ThreadList(props: Props) {
  const { threads, selected, view, loading } = props;
  const sentinel = useRef<HTMLDivElement>(null);
  const allSelected = threads.length > 0 && threads.every((t) => selected.has(t.id));
  const someSelected = selected.size > 0 && !allSelected;
  const selectedThreads = useMemo(() => threads.filter((t) => selected.has(t.id)), [threads, selected]);

  const { hasMore, fetchingMore, onLoadMore } = props;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && !fetchingMore && onLoadMore(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, fetchingMore, onLoadMore]);

  const empty = EMPTY_COPY[view] ?? EMPTY_COPY.inbox!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <div className="flex items-center pl-1 pr-2">
          <Checkbox checked={allSelected} indeterminate={someSelected} onCheckedChange={(v) => props.onSelectAll(v)} label="Select all" />
        </div>
        {selected.size === 0 ? (
          <>
            <IconButton label="Refresh" onClick={props.onRefresh}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </IconButton>
            {props.headerExtra}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted">
              {threads.length > 0 && (
                <span>
                  {threads.length.toLocaleString()}
                  {props.hasMore ? '+' : ''} conversation{threads.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </>
        ) : (
          <BulkToolbar view={view} selectedThreads={selectedThreads} onAction={props.onAction} onClear={() => props.onSelectAll(false)} />
        )}
      </div>

      {view === 'inbox' && props.categoryCounts && (
        <div className="flex shrink-0 items-stretch border-b px-2">
          {CATEGORY_TABS.map((tab) => {
            const active = (props.category ?? 'primary') === tab.id;
            const count = props.categoryCounts?.[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                onClick={() => props.onCategoryChange(tab.id === 'primary' ? null : tab.id)}
                className={cn('relative flex h-11 min-w-28 items-center gap-2 px-4 text-sm text-muted transition-colors hover:bg-[var(--hover)]', active && 'font-medium text-accent')}
              >
                {tab.label}
                {count > 0 && !active && <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">{count}</span>}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-accent" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Conversations">
        {loading && threads.length === 0 && (
          <div className="space-y-px p-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex h-10 items-center gap-3 px-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        )}
        {!loading && threads.length === 0 && <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />}
        {threads.map((thread, index) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            view={view}
            selected={selected.has(thread.id)}
            active={props.activeId === thread.id}
            focused={props.focusedIndex === index}
            compact={props.compact}
            onToggleSelect={props.onToggleSelect}
            onOpen={props.onOpen}
            onAction={props.onAction}
          />
        ))}
        <div ref={sentinel} className="h-1" />
        {props.fetchingMore && (
          <div className="flex justify-center py-3 text-xs text-muted">
            <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading more…
          </div>
        )}
      </div>
    </div>
  );
}

function BulkToolbar({ view, selectedThreads, onAction, onClear }: { view: string; selectedThreads: ThreadItem[]; onAction: ListAction; onClear: () => void }) {
  const ids = selectedThreads.map((t) => t.id);
  const act = (input: Omit<ThreadActionInput, 'ids'>) => onAction({ ...input, ids }, selectedThreads);
  const anyUnread = selectedThreads.some((t) => t.unreadCount > 0);
  return (
    <div className="flex flex-1 items-center gap-0.5 fade-in">
      {view !== 'archive' && view !== 'trash' && view !== 'spam' && (
        <IconButton label="Archive (e)" onClick={() => act({ action: 'archive' })}>
          <Archive className="h-4 w-4" />
        </IconButton>
      )}
      {(view === 'trash' || view === 'spam' || view === 'all') && (
        <IconButton label="Move to inbox" onClick={() => act({ action: view === 'spam' ? 'not_spam' : 'inbox' })}>
          <ArchiveRestore className="h-4 w-4" />
        </IconButton>
      )}
      {view !== 'spam' && view !== 'trash' && (
        <IconButton label="Report spam (!)" onClick={() => act({ action: 'spam' })}>
          <AlertOctagon className="h-4 w-4" />
        </IconButton>
      )}
      <IconButton label={view === 'trash' ? 'Delete forever' : 'Delete (#)'} onClick={() => act({ action: view === 'trash' ? 'delete_forever' : 'trash' })}>
        <Trash2 className="h-4 w-4" />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton label={anyUnread ? 'Mark as read' : 'Mark as unread'} onClick={() => act({ action: anyUnread ? 'read' : 'unread' })}>
        {anyUnread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
      </IconButton>
      <SnoozeMenu
        trigger={
          <button className="icon-btn" aria-label="Snooze (b)">
            <Clock className="h-4 w-4" />
          </button>
        }
        onSnooze={(until) => act({ action: 'snooze', until: until.toISOString() })}
      />
      <LabelMenu
        threads={selectedThreads}
        trigger={
          <button className="icon-btn" aria-label="Label as (l)">
            <Tag className="h-4 w-4" />
          </button>
        }
        onToggle={(labelId, apply) => act({ action: apply ? 'add_label' : 'remove_label', labelId })}
      />
      <Menu>
        <MenuTrigger asChild>
          <button className="icon-btn" aria-label="More">
            <MoreVertical className="h-4 w-4" />
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => act({ action: 'star' })}>Add star</MenuItem>
          <MenuItem onSelect={() => act({ action: 'unstar' })}>Remove star</MenuItem>
          <MenuItem onSelect={() => act({ action: 'important' })}>Mark as important</MenuItem>
          <MenuItem onSelect={() => act({ action: 'not_important' })}>Mark as not important</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => act({ action: 'category', category: 'primary' })}>Move to Primary</MenuItem>
          <MenuItem onSelect={() => act({ action: 'category', category: 'social' })}>Move to Social</MenuItem>
          <MenuItem onSelect={() => act({ action: 'category', category: 'promotions' })}>Move to Promotions</MenuItem>
          <MenuItem onSelect={() => act({ action: 'category', category: 'updates' })}>Move to Updates</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onClear}>Clear selection</MenuItem>
        </MenuContent>
      </Menu>
      <span className="ml-auto text-xs text-muted">{ids.length} selected</span>
    </div>
  );
}

type RowProps = {
  thread: ThreadItem;
  view: string;
  selected: boolean;
  active: boolean;
  focused: boolean;
  compact: boolean;
  onToggleSelect: (id: string, shift?: boolean) => void;
  onOpen: (thread: ThreadItem) => void;
  onAction: ListAction;
};

export const ThreadRow = memo(function ThreadRow({ thread, view, selected, active, focused, compact, onToggleSelect, onOpen, onAction }: RowProps) {
  const { me } = useApp();
  const unread = thread.unreadCount > 0;
  const starred = thread.starredCount > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: thread.id, data: { type: 'thread', thread } });
  const act = (input: Omit<ThreadActionInput, 'ids'>) => onAction({ ...input, ids: [thread.id] }, [thread]);

  const participants = useMemo(() => {
    const myAddresses = new Set((me?.mailboxes ?? []).map((m) => m.address));
    const names = thread.participants
      .filter((p) => !myAddresses.has(p.email) || thread.participants.length === 1)
      .map((p) => (p.name?.split(/\s+/)[0] || p.email.split('@')[0]) ?? p.email);
    const unique = [...new Set(names)];
    if (unique.length === 0) return thread.lastDirection === 'outbound' ? 'me' : '(unknown)';
    if (view === 'sent' || view === 'drafts' || view === 'scheduled') return `To: ${unique.slice(0, 3).join(', ')}`;
    if (thread.participants.some((p) => myAddresses.has(p.email)) && thread.sentCount > 0) unique.push('me');
    return unique.length > 3 ? `${unique.slice(0, 2).join(', ')} … ${unique[unique.length - 1]}` : unique.join(', ');
  }, [thread, me, view]);

  const dateLabel = thread.snoozedUntil && view === 'snoozed' ? `Snoozed · ${formatListDate(thread.snoozedUntil)}` : formatListDate(thread.lastMessageAt);
  const showMailbox = (me?.mailboxes.length ?? 0) > 1;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      data-thread-id={thread.id}
      data-unread={unread}
      data-selected={selected}
      data-active={active}
      className={cn('thread-row group', focused && 'ring-1 ring-inset ring-accent/60', isDragging && 'opacity-50', compact ? 'text-[13px]' : '')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-no-open]')) return;
        onOpen(thread);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(thread);
      }}
    >
      <div className="flex items-center gap-2" data-no-open>
        <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(thread.id)} label="Select conversation" className="opacity-60 group-hover:opacity-100 data-[state=checked]:opacity-100" />
        <button
          className={cn('icon-btn h-6 w-6', starred ? 'text-warning' : 'text-faint opacity-60 group-hover:opacity-100')}
          aria-label={starred ? 'Unstar' : 'Star'}
          onClick={(e) => {
            e.stopPropagation();
            act({ action: starred ? 'unstar' : 'star' });
          }}
        >
          <Star className="h-4 w-4" fill={starred ? 'currentColor' : 'none'} />
        </button>
        {thread.isImportant && <span className="hidden h-2 w-2 rounded-sm bg-warning sm:block" title="Important" />}
      </div>

      <div className={cn('w-44 shrink-0 truncate', !unread && 'text-muted', compact && 'w-36')} title={participants}>
        {thread.mailboxAddress && showMailbox && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent/60 align-middle" title={thread.mailboxAddress} />}
        {participants}
        {thread.messageCount > 1 && <span className="ml-1 text-xs font-normal text-faint">{thread.messageCount}</span>}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {thread.labels.slice(0, 3).map((l) => (
          <Badge key={l.id} color={l.color} className="shrink-0">
            {l.name}
          </Badge>
        ))}
        {thread.draftCount > 0 && view !== 'drafts' && <span className="shrink-0 text-xs font-medium text-danger">Draft</span>}
        {thread.scheduledCount > 0 && view !== 'scheduled' && <span className="shrink-0 text-xs font-medium text-accent">Scheduled</span>}
        <span className="truncate">
          <span className={cn(unread ? 'text-text' : 'text-text')}>{thread.subject || '(no subject)'}</span>
          <span className="font-normal text-muted"> — {thread.snippet}</span>
        </span>
        {thread.attachments.length > 0 && !compact && (
          <span className="ml-2 hidden shrink-0 items-center gap-1 md:flex">
            {thread.attachments.slice(0, 2).map((a) => (
              <Tooltip key={a.id} content={`${a.filename} · ${formatBytes(a.sizeBytes)}`}>
                <span className="chip max-w-32 truncate font-normal">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{a.filename}</span>
                </span>
              </Tooltip>
            ))}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {thread.hasAttachments && compact && <Paperclip className="h-3.5 w-3.5 text-faint" />}
        <span className={cn('w-20 text-right text-xs tabular-nums group-hover:hidden', unread ? 'text-text' : 'text-muted')}>{dateLabel}</span>
        <div className="hidden items-center group-hover:flex" data-no-open>
          {view !== 'trash' && view !== 'spam' && (
            <IconButton label="Archive" size="sm" onClick={() => act({ action: 'archive' })}>
              <Archive className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label={view === 'trash' ? 'Delete forever' : 'Delete'} size="sm" onClick={() => act({ action: view === 'trash' ? 'delete_forever' : 'trash' })}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
          <IconButton label={unread ? 'Mark as read' : 'Mark as unread'} size="sm" onClick={() => act({ action: unread ? 'read' : 'unread' })}>
            {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
          </IconButton>
          <SnoozeMenu
            trigger={
              <button className="icon-btn h-7 w-7" aria-label="Snooze">
                <Clock className="h-4 w-4" />
              </button>
            }
            onSnooze={(until) => act({ action: 'snooze', until: until.toISOString() })}
          />
        </div>
      </div>
      {thread.mailboxAddress && showMailbox && <span className="sr-only">{thread.mailboxAddress}</span>}
      {thread.participants.length > 2 && <Users className="sr-only" />}
    </div>
  );
});
