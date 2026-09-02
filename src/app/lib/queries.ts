import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Category } from '@shared/types';
import { del, get, patch, post, upload } from './api';
import type {
  ApiKey,
  AppConfig,
  ComposePayload,
  Contact,
  Filter,
  Me,
  Message,
  Session,
  Template,
  ThreadDetail,
  ThreadItem,
  ViewCounts,
} from './types';

export const keys = {
  config: ['config'] as const,
  me: ['me'] as const,
  counts: ['counts'] as const,
  threads: (params: ThreadListParams) => ['threads', params] as const,
  thread: (id: string) => ['thread', id] as const,
  drafts: ['drafts'] as const,
  contacts: (q: string) => ['contacts', q] as const,
  filters: ['filters'] as const,
  templates: ['templates'] as const,
  blocked: ['blocked'] as const,
  apiKeys: ['api-keys'] as const,
  sessions: ['sessions'] as const,
  webhooks: ['outgoing-webhooks'] as const,
  mailboxes: ['mailboxes'] as const,
  pushSubscriptions: ['push-subscriptions'] as const,
};

export type ThreadListParams = {
  view: string;
  mailbox?: string;
  label?: string | null;
  category?: Category | null;
  q?: string | null;
  limit?: number;
};

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => get<AppConfig>('/api/config'), staleTime: 60_000 });
}

export function useMe(enabled = true) {
  return useQuery({ queryKey: keys.me, queryFn: () => get<Me>('/api/me'), enabled, retry: false, staleTime: 30_000 });
}

export function useCounts(enabled = true) {
  return useQuery({ queryKey: keys.counts, queryFn: () => get<ViewCounts>('/api/me/counts'), enabled, staleTime: 15_000, refetchInterval: 60_000 });
}

export type ThreadPage = { items: ThreadItem[]; nextCursor: string | null };

export function useThreads(params: ThreadListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.threads(params),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      search.set('view', params.view);
      if (params.mailbox && params.mailbox !== 'all') search.set('mailbox', params.mailbox);
      if (params.label) search.set('label', params.label);
      if (params.category) search.set('category', params.category);
      if (params.q) search.set('q', params.q);
      search.set('limit', String(params.limit ?? 50));
      if (pageParam) search.set('cursor', pageParam);
      return get<ThreadPage>(`/api/threads?${search.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function useThread(id: string | null | undefined) {
  return useQuery({ queryKey: keys.thread(id ?? ''), queryFn: () => get<ThreadDetail>(`/api/threads/${id}`), enabled: Boolean(id), staleTime: 5_000 });
}

export type ThreadActionInput = {
  ids: string[];
  action:
    | 'archive'
    | 'inbox'
    | 'trash'
    | 'spam'
    | 'not_spam'
    | 'read'
    | 'unread'
    | 'star'
    | 'unstar'
    | 'snooze'
    | 'unsnooze'
    | 'delete_forever'
    | 'add_label'
    | 'remove_label'
    | 'important'
    | 'not_important'
    | 'category';
  labelId?: string | null;
  until?: string | null;
  category?: Category | null;
};

/** Actions that remove a thread from the current list view (used for optimistic updates). */
export const REMOVING_ACTIONS: Record<string, Set<ThreadActionInput['action']>> = {
  inbox: new Set(['archive', 'trash', 'spam', 'snooze']),
  starred: new Set(['unstar', 'trash', 'spam']),
  snoozed: new Set(['unsnooze', 'trash', 'spam', 'archive']),
  sent: new Set(['trash', 'spam']),
  drafts: new Set(['trash', 'delete_forever']),
  scheduled: new Set(['trash']),
  all: new Set(['trash', 'spam']),
  spam: new Set(['not_spam', 'delete_forever', 'trash']),
  trash: new Set(['inbox', 'delete_forever', 'not_spam']),
  label: new Set(['trash', 'spam', 'remove_label']),
  search: new Set(['delete_forever']),
};

export function useThreadAction(params?: ThreadListParams) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ThreadActionInput) => post<{ updated: string[]; removed: string[] }>('/api/threads/actions', input),
    onMutate: async (input) => {
      if (!params) return;
      const key = keys.threads(params);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InfiniteData<ThreadPage>>(key);
      const removing = REMOVING_ACTIONS[params.view]?.has(input.action) ?? false;
      qc.setQueryData<InfiniteData<ThreadPage>>(key, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items
              .filter((t) => !(removing && input.ids.includes(t.id)))
              .map((t) => {
                if (!input.ids.includes(t.id)) return t;
                switch (input.action) {
                  case 'read':
                    return { ...t, unreadCount: 0 };
                  case 'unread':
                    return { ...t, unreadCount: Math.max(1, t.unreadCount) };
                  case 'star':
                    return { ...t, starredCount: Math.max(1, t.starredCount) };
                  case 'unstar':
                    return { ...t, starredCount: 0 };
                  case 'important':
                    return { ...t, isImportant: true };
                  case 'not_important':
                    return { ...t, isImportant: false };
                  default:
                    return t;
                }
              }),
          })),
        };
      });
      return { previous, key };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: (_data, _err, input) => {
      void qc.invalidateQueries({ queryKey: ['threads'] });
      void qc.invalidateQueries({ queryKey: keys.counts });
      for (const id of input.ids) void qc.invalidateQueries({ queryKey: keys.thread(id) });
    },
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ComposePayload) => post<{ message: Message; undoUntil: string | null }>('/api/messages/send', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['threads'] });
      void qc.invalidateQueries({ queryKey: keys.counts });
      void qc.invalidateQueries({ queryKey: keys.drafts });
    },
  });
}

export function useUndoSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => post<{ draft: Message }>(`/api/messages/${messageId}/undo`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['threads'] });
      void qc.invalidateQueries({ queryKey: keys.counts });
    },
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ComposePayload) => post<{ draft: Message }>('/api/drafts', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.drafts });
      void qc.invalidateQueries({ queryKey: keys.counts });
    },
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/api/drafts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['threads'] });
      void qc.invalidateQueries({ queryKey: keys.drafts });
      void qc.invalidateQueries({ queryKey: keys.counts });
    },
  });
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: ({ file, inline }: { file: File; inline?: boolean }) =>
      upload<{ id: string; filename: string; contentType: string; sizeBytes: number; contentId: string | null; url: string }>('/api/uploads', file, inline ? { inline: '1' } : {}),
  });
}

export function useContactSearch(q: string) {
  return useQuery({
    queryKey: keys.contacts(q),
    queryFn: () => get<{ items: Contact[] }>(`/api/contacts?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 1,
    staleTime: 30_000,
  });
}

export function useFilters() {
  return useQuery({ queryKey: keys.filters, queryFn: () => get<{ items: Filter[] }>('/api/filters') });
}

export function useTemplates() {
  return useQuery({ queryKey: keys.templates, queryFn: () => get<{ items: Template[] }>('/api/templates') });
}

export function useBlocked() {
  return useQuery({ queryKey: keys.blocked, queryFn: () => get<{ items: Array<{ id: string; pattern: string; createdAt: string }> }>('/api/blocked') });
}

export function useApiKeys() {
  return useQuery({ queryKey: keys.apiKeys, queryFn: () => get<{ items: ApiKey[]; scopes: string[] }>('/api/api-keys') });
}

export function useSessions() {
  return useQuery({ queryKey: keys.sessions, queryFn: () => get<Session[]>('/api/me/sessions') });
}

export function useUpdatePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; locale?: string; prefs?: Me['user']['prefs'] }) => patch('/api/me', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function invalidateMail(qc: ReturnType<typeof useQueryClient>, threadId?: string) {
  void qc.invalidateQueries({ queryKey: ['threads'] });
  void qc.invalidateQueries({ queryKey: keys.counts });
  if (threadId) void qc.invalidateQueries({ queryKey: keys.thread(threadId) });
}
