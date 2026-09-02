import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ComposerHost } from '../components/Composer';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { Spinner } from '../components/ui';
import { useApp } from '../lib/app-state';
import { onRealtime, useRealtime } from '../lib/realtime';
import { useShortcuts } from '../lib/shortcuts';
import { cn } from '../lib/utils';
import { MailPage } from './MailPage';

const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AdminPage = lazy(() => import('./admin/AdminPage').then((m) => ({ default: m.AdminPage })));

export function MailApp() {
  const { me, sidebarOpen, setSidebarOpen, openCompose, prefs, setShowShortcuts } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const realtime = useRealtime(Boolean(me));

  // Toast + optional desktop notification for brand-new mail while the tab is open.
  useEffect(() => {
    return onRealtime((event) => {
      if (event.type !== 'message.new') return;
      const from = event.from.name || event.from.email;
      toast(`${from}`, {
        description: event.subject || '(no subject)',
        action: { label: 'Open', onClick: () => navigate(`/mail/inbox/${event.threadId}`) },
      });
      if (prefs.desktopNotifications && document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(from, { body: event.subject || '(no subject)', tag: `mailcove-${event.threadId}`, icon: '/icon-192.png' });
          n.onclick = () => {
            window.focus();
            navigate(`/mail/inbox/${event.threadId}`);
          };
        } catch {
          // ignore
        }
      }
    });
  }, [navigate, prefs.desktopNotifications]);

  useShortcuts(
    {
      compose: () => openCompose({ mode: 'new' }),
      help: () => setShowShortcuts(true),
      gotoInbox: () => navigate('/mail/inbox'),
      gotoStarred: () => navigate('/mail/starred'),
      gotoSent: () => navigate('/mail/sent'),
      gotoDrafts: () => navigate('/mail/drafts'),
      gotoAll: () => navigate('/mail/all'),
      gotoSnoozed: () => navigate('/mail/snoozed'),
      gotoTrash: () => navigate('/mail/trash'),
      search: () => document.querySelector<HTMLInputElement>('[data-search-input]')?.focus(),
    },
    prefs.keyboardShortcuts !== false,
  );

  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  if (!me) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <TopBar realtimeConnected={realtime.connected} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
        <main className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', 'lg:pr-3 lg:pb-3')}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface lg:rounded-2xl lg:border lg:shadow-sm">
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center">
                  <Spinner />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Navigate to="/mail/inbox" replace />} />
                <Route path="/mail" element={<Navigate to="/mail/inbox" replace />} />
                <Route path="/mail/label/:labelId/:threadId?" element={<MailPage />} />
                <Route path="/mail/search/:threadId?" element={<MailPage />} />
                <Route path="/mail/:view/:threadId?" element={<MailPage />} />
                <Route path="/settings/*" element={<SettingsPage />} />
                <Route path="/admin/*" element={me.user.isAdmin ? <AdminPage /> : <Navigate to="/mail/inbox" replace />} />
                <Route path="*" element={<Navigate to="/mail/inbox" replace />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
      <ComposerHost />
      <ShortcutsDialog />
    </div>
  );
}
