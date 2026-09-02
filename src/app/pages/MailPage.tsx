import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import type { Category } from '@shared/types';
import { Mail } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ThreadList, type ListAction } from '../components/ThreadList';
import { ThreadView } from '../components/ThreadView';
import { EmptyState } from '../components/ui';
import { useApp } from '../lib/app-state';
import { useCounts, useThreadAction, useThreads, type ThreadActionInput, type ThreadListParams } from '../lib/queries';
import { useShortcuts } from '../lib/shortcuts';
import type { ThreadItem } from '../lib/types';
import { cn } from '../lib/utils';

const VALID_VIEWS = new Set(['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'scheduled', 'all', 'spam', 'trash']);

export function MailPage() {
  const params = useParams<{ view?: string; labelId?: string; threadId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { me, prefs, selectedMailbox } = useApp();
  const counts = useCounts(Boolean(me));

  const labelId = params.labelId ?? null;
  const isSearch = window.location.pathname.startsWith('/mail/search');
  const view = labelId ? 'label' : isSearch ? 'search' : VALID_VIEWS.has(params.view ?? '') ? params.view! : 'inbox';
  const q = isSearch ? searchParams.get('q') ?? '' : '';
  const [category, setCategory] = useState<Category | null>(null);
  const showCategories = view === 'inbox' && prefs.categoryTabs === true && me?.settings.inboundCategorization !== false;

  const listParams = useMemo<ThreadListParams>(
    () => ({ view, mailbox: selectedMailbox, label: labelId, category: showCategories ? category ?? 'primary' : null, q: q || null, limit: prefs.pageSize ?? 50 }),
    [view, selectedMailbox, labelId, category, q, prefs.pageSize, showCategories],
  );
  const threadsQuery = useThreads(listParams, Boolean(me));
  const action = useThreadAction(listParams);
  const threads = useMemo(() => threadsQuery.data?.pages.flatMap((p) => p.items) ?? [], [threadsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dragging, setDragging] = useState<ThreadItem | null>(null);
  const activeId = params.threadId ?? null;
  const readingPane = prefs.readingPane ?? 'right';
  const basePath = labelId ? `/mail/label/${labelId}` : isSearch ? '/mail/search' : `/mail/${view}`;
  const suffix = isSearch && q ? `?q=${encodeURIComponent(q)}` : '';

  useEffect(() => {
    setSelected(new Set());
    setFocusedIndex(-1);
  }, [view, labelId, q, selectedMailbox, category]);

  const openThread = useCallback((thread: ThreadItem) => navigate(`${basePath}/${thread.id}${suffix}`), [navigate, basePath, suffix]);
  const closeThread = useCallback(() => navigate(`${basePath}${suffix}`), [navigate, basePath, suffix]);

  const runAction: ListAction = useCallback(
    (input, targetThreads) => {
      const ids = input.ids ?? [...selected];
      if (ids.length === 0) return;
      const labelText = input.action === 'add_label' ? 'Label added' : input.action === 'remove_label' ? 'Label removed' : null;
      const messages: Partial<Record<ThreadActionInput['action'], string>> = {
        archive: `${ids.length > 1 ? `${ids.length} conversations` : 'Conversation'} archived`,
        trash: `${ids.length > 1 ? `${ids.length} conversations` : 'Conversation'} moved to Trash`,
        spam: 'Reported as spam',
        not_spam: 'Moved to Inbox',
        inbox: 'Moved to Inbox',
        snooze: 'Snoozed',
        delete_forever: 'Deleted forever',
      };
      const undoable: Partial<Record<ThreadActionInput['action'], ThreadActionInput['action']>> = { archive: 'inbox', trash: 'inbox', spam: 'not_spam', snooze: 'unsnooze', inbox: 'archive' };
      action.mutate(
        { ...input, ids },
        {
          onSuccess: () => {
            const msg = labelText ?? messages[input.action];
            if (msg) {
              const undoAction = undoable[input.action];
              toast.success(msg, {
                action: undoAction ? { label: 'Undo', onClick: () => action.mutate({ ids, action: undoAction }) } : undefined,
              });
            }
            if (activeId && ids.includes(activeId) && ['archive', 'trash', 'spam', 'delete_forever', 'snooze'].includes(input.action)) closeThread();
          },
          onError: (e) => toast.error(e instanceof Error ? e.message : 'Action failed'),
        },
      );
      setSelected(new Set());
      void targetThreads;
    },
    [selected, action, activeId, closeThread],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAll = useCallback((all: boolean) => setSelected(all ? new Set(threads.map((t) => t.id)) : new Set()), [threads]);

  const activeIndex = activeId ? threads.findIndex((t) => t.id === activeId) : -1;
  const navigateThread = useCallback(
    (dir: 1 | -1) => {
      const idx = activeIndex === -1 ? focusedIndex : activeIndex;
      const next = threads[idx + dir];
      if (next) openThread(next);
    },
    [activeIndex, focusedIndex, threads, openThread],
  );

  // List keyboard navigation (Gmail-style)
  useShortcuts(
    {
      next: () => {
        if (activeId && readingPane === 'off') return navigateThread(1);
        setFocusedIndex((i) => Math.min(threads.length - 1, i + 1));
        if (activeId) navigateThread(1);
      },
      prev: () => {
        if (activeId && readingPane === 'off') return navigateThread(-1);
        setFocusedIndex((i) => Math.max(0, i - 1));
        if (activeId) navigateThread(-1);
      },
      open: () => {
        const t = threads[focusedIndex];
        if (t) openThread(t);
      },
      back: closeThread,
      select: () => {
        const t = threads[focusedIndex];
        if (t) toggleSelect(t.id);
      },
      selectAll: () => selectAll(true),
      archive: () => runAction({ action: 'archive', ids: targetIds() }),
      trash: () => runAction({ action: view === 'trash' ? 'delete_forever' : 'trash', ids: targetIds() }),
      spam: () => runAction({ action: 'spam', ids: targetIds() }),
      star: () => {
        const ids = targetIds();
        const t = threads.find((x) => x.id === ids[0]);
        runAction({ action: t && t.starredCount > 0 ? 'unstar' : 'star', ids });
      },
      toggleRead: () => {
        const ids = targetIds();
        const t = threads.find((x) => x.id === ids[0]);
        runAction({ action: t && t.unreadCount > 0 ? 'read' : 'unread', ids });
      },
      escape: () => {
        if (selected.size) setSelected(new Set());
        else if (activeId) closeThread();
      },
      reply: () => document.querySelector<HTMLButtonElement>('[aria-label="Reply (r)"]')?.click(),
      replyAll: () => document.querySelector<HTMLButtonElement>('button:has(> svg.lucide-reply-all)')?.click(),
      forward: () => document.querySelector<HTMLButtonElement>('button:has(> svg.lucide-forward)')?.click(),
    },
    prefs.keyboardShortcuts !== false,
  );

  function targetIds(): string[] {
    if (selected.size) return [...selected];
    if (activeId) return [activeId];
    const t = threads[focusedIndex];
    return t ? [t.id] : [];
  }

  // Drag threads onto labels / views in the sidebar.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as { thread?: ThreadItem } | undefined)?.thread ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    const thread = (e.active.data.current as { thread?: ThreadItem } | undefined)?.thread;
    setDragging(null);
    if (!thread || !e.over) return;
    const ids = selected.has(thread.id) ? [...selected] : [thread.id];
    const data = e.over.data.current as { type: 'label'; labelId: string } | { type: 'view'; view: string } | undefined;
    if (!data) return;
    if (data.type === 'label') runAction({ action: 'add_label', labelId: data.labelId, ids });
    else if (data.view === 'trash') runAction({ action: 'trash', ids });
    else if (data.view === 'spam') runAction({ action: 'spam', ids });
    else if (data.view === 'inbox') runAction({ action: view === 'spam' ? 'not_spam' : 'inbox', ids });
    else if (data.view === 'all') runAction({ action: 'archive', ids });
  }

  const showList = readingPane !== 'off' || !activeId;
  const showThread = Boolean(activeId);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className={cn('flex h-full min-h-0', readingPane === 'bottom' && 'flex-col')}>
        {showList && (
          <div className={cn('min-h-0 min-w-0', showThread && readingPane === 'right' && 'hidden w-[42%] shrink-0 border-r lg:block', showThread && readingPane === 'bottom' && 'h-[45%] shrink-0 border-b', (!showThread || readingPane === 'off') && 'flex-1')}>
            <ThreadList
              view={view}
              threads={threads}
              loading={threadsQuery.isLoading}
              fetchingMore={threadsQuery.isFetchingNextPage}
              hasMore={Boolean(threadsQuery.hasNextPage)}
              onLoadMore={() => void threadsQuery.fetchNextPage()}
              onRefresh={() => {
                void threadsQuery.refetch();
                void counts.refetch();
              }}
              selected={selected}
              onToggleSelect={toggleSelect}
              onSelectAll={selectAll}
              activeId={activeId}
              focusedIndex={focusedIndex}
              onOpen={openThread}
              onAction={runAction}
              category={category}
              onCategoryChange={setCategory}
              categoryCounts={showCategories ? counts.data?.categories : undefined}
              compact={prefs.density === 'compact'}
              headerExtra={
                isSearch && q ? (
                  <span className="ml-2 truncate text-xs text-muted">
                    Results for <span className="font-medium text-text">{q}</span>
                  </span>
                ) : null
              }
            />
          </div>
        )}
        {showThread ? (
          <div className="min-h-0 min-w-0 flex-1">
            <ThreadView key={activeId} threadId={activeId!} view={view} onClose={closeThread} onNavigate={navigateThread} hasPrev={activeIndex > 0} hasNext={activeIndex >= 0 && activeIndex < threads.length - 1} />
          </div>
        ) : (
          readingPane !== 'off' && (
            <div className="hidden min-w-0 flex-1 lg:block">
              <EmptyState icon={<Mail />} title="Select a conversation" description={`${threads.length ? 'Choose something from the list' : 'Nothing here yet'} — or press c to compose.`} />
            </div>
          )
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pointer-events-none rounded-lg border bg-surface px-3 py-2 text-sm shadow-[var(--shadow-lg)]">
            {selected.has(dragging.id) && selected.size > 1 ? `${selected.size} conversations` : dragging.subject || '(no subject)'}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
