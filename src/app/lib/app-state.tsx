import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserPrefs } from '@shared/types';
import { useMe, useUpdatePrefs } from './queries';
import type { Me } from './types';

export type ComposeIntent = {
  id: string;
  mode: 'new' | 'reply' | 'reply_all' | 'forward' | 'draft';
  mailboxId?: string;
  to?: Array<{ email: string; name?: string | null }>;
  cc?: Array<{ email: string; name?: string | null }>;
  subject?: string;
  html?: string;
  replyToMessageId?: string | null;
  forwardOfMessageId?: string | null;
  draftId?: string | null;
  threadId?: string | null;
  quotedHtml?: string | null;
  minimized?: boolean;
  maximized?: boolean;
  /** Inline mode renders inside the thread instead of a floating window. */
  inline?: boolean;
};

type AppState = {
  me: Me | undefined;
  prefs: UserPrefs;
  setPref: <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  composers: ComposeIntent[];
  openCompose: (intent: Omit<ComposeIntent, 'id'> & { id?: string }) => string;
  updateCompose: (id: string, patch: Partial<ComposeIntent>) => void;
  closeCompose: (id: string) => void;
  showShortcuts: boolean;
  setShowShortcuts: (open: boolean) => void;
  selectedMailbox: string;
  setSelectedMailbox: (id: string) => void;
};

const Ctx = createContext<AppState | null>(null);

const DEFAULT_PREFS: UserPrefs = {
  density: 'default',
  readingPane: 'right',
  theme: 'system',
  undoSendSeconds: 10,
  keyboardShortcuts: true,
  conversationView: true,
  categoryTabs: false,
  showImages: 'ask',
  pageSize: 50,
  signatureOnReply: true,
  desktopNotifications: false,
  soundOnNewMail: false,
};

function readTheme(): 'light' | 'dark' | 'system' {
  try {
    const stored = localStorage.getItem('mailcove:theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'system';
}

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try {
    if (theme === 'system') localStorage.removeItem('mailcove:theme');
    else localStorage.setItem('mailcove:theme', theme);
  } catch {
    // ignore
  }
}

export function AppStateProvider({ children, authenticated }: { children: ReactNode; authenticated: boolean }) {
  const meQuery = useMe(authenticated);
  const update = useUpdatePrefs();
  const [localPrefs, setLocalPrefs] = useState<UserPrefs>({});
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(readTheme);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [composers, setComposers] = useState<ComposeIntent[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedMailbox, setSelectedMailboxState] = useState<string>(() => localStorage.getItem('mailcove:mailbox') ?? 'all');

  const prefs = useMemo<UserPrefs>(() => ({ ...DEFAULT_PREFS, ...(meQuery.data?.user.prefs ?? {}), ...localPrefs }), [meQuery.data, localPrefs]);

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => theme === 'system' && applyTheme('system');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [theme]);

  useEffect(() => {
    const server = meQuery.data?.user.prefs.theme;
    if (server && server !== theme && !localStorage.getItem('mailcove:theme')) setThemeState(server);
  }, [meQuery.data, theme]);

  useEffect(() => {
    const accent = meQuery.data?.settings.accentColor;
    if (accent) document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.classList.remove('density-compact', 'density-default', 'density-comfortable');
    document.documentElement.classList.add(`density-${prefs.density ?? 'default'}`);
  }, [meQuery.data, prefs.density]);

  const setPref = useCallback(
    <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => {
      setLocalPrefs((p) => ({ ...p, [key]: value }));
      update.mutate({ prefs: { [key]: value } as UserPrefs });
    },
    [update],
  );

  const setTheme = useCallback(
    (next: 'light' | 'dark' | 'system') => {
      setThemeState(next);
      applyTheme(next);
      if (authenticated) update.mutate({ prefs: { theme: next } });
    },
    [authenticated, update],
  );

  const openCompose = useCallback((intent: Omit<ComposeIntent, 'id'> & { id?: string }) => {
    const id = intent.id ?? crypto.randomUUID();
    setComposers((list) => {
      if (list.some((c) => c.id === id)) return list.map((c) => (c.id === id ? { ...c, ...intent, id, minimized: false } : c));
      const next = [...list, { ...intent, id }];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    return id;
  }, []);

  const updateCompose = useCallback((id: string, patch: Partial<ComposeIntent>) => {
    setComposers((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const closeCompose = useCallback((id: string) => setComposers((list) => list.filter((c) => c.id !== id)), []);

  const setSelectedMailbox = useCallback((id: string) => {
    setSelectedMailboxState(id);
    localStorage.setItem('mailcove:mailbox', id);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      me: meQuery.data,
      prefs,
      setPref,
      theme,
      setTheme,
      sidebarOpen,
      setSidebarOpen,
      composers,
      openCompose,
      updateCompose,
      closeCompose,
      showShortcuts,
      setShowShortcuts,
      selectedMailbox,
      setSelectedMailbox,
    }),
    [meQuery.data, prefs, setPref, theme, setTheme, sidebarOpen, composers, openCompose, updateCompose, closeCompose, showShortcuts, selectedMailbox, setSelectedMailbox],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
