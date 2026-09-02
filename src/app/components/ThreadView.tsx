import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Archive, ArchiveRestore, ArrowLeft, ChevronLeft, ChevronRight, Clock, Mail, MailOpen, MoreVertical, Printer, Tag, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useApp } from '../lib/app-state';
import { useThread, useThreadAction } from '../lib/queries';
import type { Message } from '../lib/types';
import { cn, formatFullDate } from '../lib/utils';
import { LabelMenu, SnoozeMenu } from './ActionMenus';
import { InlineComposer } from './Composer';
import { MessageItem } from './MessageItem';
import { Badge, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton } from './ui';

type Props = {
  threadId: string;
  view: string;
  onClose: () => void;
  onNavigate?: (direction: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onAfterAction?: () => void;
};

export function ThreadView({ threadId, view, onClose, onNavigate, hasPrev, hasNext, onAfterAction }: Props) {
  const { data, isLoading, isError } = useThread(threadId);
  const { me, prefs } = useApp();
  const qc = useQueryClient();
  const action = useThreadAction();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [inlineReply, setInlineReply] = useState<{ mode: 'reply' | 'reply_all' | 'forward'; message: Message } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const thread = data?.thread;
  const messages = useMemo(() => (data?.messages ?? []).filter((m) => !m.trashedAt || view === 'trash'), [data, view]);

  // Expand unread messages and the last message; collapse the rest (Gmail behaviour).
  useEffect(() => {
    if (!messages.length) return;
    const next = new Set<string>();
    for (const m of messages) if (!m.isRead || m.isDraft) next.add(m.id);
    next.add(messages[messages.length - 1]!.id);
    setExpanded(next);
    setInlineReply(null);
    setShowAll(messages.length <= 4);
  }, [threadId, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark as read shortly after opening.
  useEffect(() => {
    if (!thread || thread.unreadCount === 0) return;
    const t = setTimeout(() => action.mutate({ ids: [thread.id], action: 'read' }), 600);
    return () => clearTimeout(t);
  }, [thread?.id, thread?.unreadCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (input: Parameters<typeof action.mutate>[0], message?: string, leave = true) => {
    action.mutate(input, {
      onSuccess: () => {
        if (message) toast.success(message);
        if (leave) {
          onAfterAction?.();
          onClose();
        }
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Action failed'),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p>This conversation is no longer available.</p>
        <button className="btn btn-secondary" onClick={onClose}>
          Back
        </button>
      </div>
    );
  }

  const unread = thread.unreadCount > 0;
  const starred = thread.starredCount > 0;
  const visibleMessages = showAll || messages.length <= 4 ? messages : [messages[0]!, ...messages.slice(-2)];
  const hiddenCount = messages.length - visibleMessages.length;

  return (
    <div className="flex h-full min-h-0 flex-col fade-in">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <IconButton label="Back to list (u)" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        {thread.folder !== 'archive' && thread.folder !== 'trash' && thread.folder !== 'spam' && (
          <IconButton label="Archive (e)" onClick={() => run({ ids: [thread.id], action: 'archive' }, 'Conversation archived')}>
            <Archive className="h-4 w-4" />
          </IconButton>
        )}
        {(thread.folder === 'archive' || thread.folder === 'trash') && (
          <IconButton label="Move to inbox" onClick={() => run({ ids: [thread.id], action: 'inbox' }, 'Moved to Inbox')}>
            <ArchiveRestore className="h-4 w-4" />
          </IconButton>
        )}
        {thread.folder !== 'spam' ? (
          <IconButton label="Report spam (!)" onClick={() => run({ ids: [thread.id], action: 'spam' }, 'Reported as spam')}>
            <AlertOctagon className="h-4 w-4" />
          </IconButton>
        ) : (
          <IconButton label="Not spam" onClick={() => run({ ids: [thread.id], action: 'not_spam' }, 'Moved to Inbox')}>
            <ArchiveRestore className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label={thread.folder === 'trash' ? 'Delete forever' : 'Delete (#)'} onClick={() => run({ ids: [thread.id], action: thread.folder === 'trash' ? 'delete_forever' : 'trash' }, thread.folder === 'trash' ? 'Deleted forever' : 'Moved to Trash')}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton label={unread ? 'Mark as read' : 'Mark as unread'} onClick={() => run({ ids: [thread.id], action: unread ? 'read' : 'unread' }, undefined, !unread)}>
          {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </IconButton>
        <SnoozeMenu
          trigger={
            <button className="icon-btn" aria-label="Snooze (b)">
              <Clock className="h-4 w-4" />
            </button>
          }
          onSnooze={(until) => run({ ids: [thread.id], action: 'snooze', until: until.toISOString() }, `Snoozed until ${formatFullDate(until)}`)}
        />
        <LabelMenu
          threads={[thread]}
          trigger={
            <button className="icon-btn" aria-label="Label as (l)">
              <Tag className="h-4 w-4" />
            </button>
          }
          onToggle={(labelId, apply) => run({ ids: [thread.id], action: apply ? 'add_label' : 'remove_label', labelId }, undefined, false)}
        />
        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn" aria-label="More">
              <MoreVertical className="h-4 w-4" />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => run({ ids: [thread.id], action: starred ? 'unstar' : 'star' }, undefined, false)}>{starred ? 'Remove star' : 'Add star'}</MenuItem>
            <MenuItem onSelect={() => run({ ids: [thread.id], action: thread.isImportant ? 'not_important' : 'important' }, undefined, false)}>{thread.isImportant ? 'Mark not important' : 'Mark as important'}</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => window.print()}>
              <Printer className="h-4 w-4 text-muted" /> Print all
            </MenuItem>
            <MenuItem onSelect={() => setExpanded(new Set(messages.map((m) => m.id)))}>Expand all</MenuItem>
            <MenuItem onSelect={() => setExpanded(new Set([messages[messages.length - 1]!.id]))}>Collapse all</MenuItem>
          </MenuContent>
        </Menu>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted">
          {onNavigate && (
            <>
              <IconButton label="Newer (k)" size="sm" disabled={!hasPrev} onClick={() => onNavigate(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <IconButton label="Older (j)" size="sm" disabled={!hasNext} onClick={() => onNavigate(1)}>
                <ChevronRight className="h-4 w-4" />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-2 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold leading-snug">{thread.subject || '(no subject)'}</h1>
            {thread.labels.map((l) => (
              <Badge key={l.id} color={l.color}>
                <button className="flex items-center gap-1" onClick={() => run({ ids: [thread.id], action: 'remove_label', labelId: l.id }, undefined, false)} title="Remove label">
                  {l.name} <span aria-hidden>×</span>
                </button>
              </Badge>
            ))}
            {thread.folder === 'spam' && <Badge className="bg-danger/15 text-danger">Spam</Badge>}
            {thread.folder === 'trash' && <Badge className="bg-danger/15 text-danger">Trash</Badge>}
            {thread.snoozedUntil && (
              <Badge className="bg-warning/15 text-warning">
                <Clock className="mr-1 h-3 w-3" /> Snoozed until {formatFullDate(thread.snoozedUntil)}
              </Badge>
            )}
          </div>
          {(me?.mailboxes.length ?? 0) > 1 && <p className="mt-1 text-xs text-muted">in {thread.mailboxAddress}</p>}
        </div>

        <div className={cn('mx-2 mb-4 overflow-hidden rounded-xl border sm:mx-4', prefs.density === 'compact' && 'text-[13px]')}>
          {visibleMessages.map((m, i) => (
            <div key={m.id}>
              {hiddenCount > 0 && i === 1 && (
                <button className="flex w-full items-center justify-center gap-2 border-b bg-surface-2 py-2 text-xs text-muted hover:text-text" onClick={() => setShowAll(true)}>
                  <span className="rounded-full border bg-surface px-2 py-0.5 font-medium">{hiddenCount}</span> older message{hiddenCount === 1 ? '' : 's'}
                </button>
              )}
              <MessageItem
                message={m}
                thread={thread}
                expanded={expanded.has(m.id)}
                isLast={i === visibleMessages.length - 1 && !inlineReply}
                onToggle={() =>
                  setExpanded((set) => {
                    const next = new Set(set);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
                onReply={(mode) => setInlineReply({ mode, message: m })}
              />
            </div>
          ))}
          {inlineReply && (
            <InlineComposer
              key={`${inlineReply.mode}-${inlineReply.message.id}`}
              mode={inlineReply.mode}
              message={inlineReply.message}
              thread={thread}
              onClose={() => setInlineReply(null)}
              onSent={() => {
                setInlineReply(null);
                void qc.invalidateQueries({ queryKey: ['thread', thread.id] });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

