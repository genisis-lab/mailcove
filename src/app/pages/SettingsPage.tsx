import { Bell, Database, FileText, Filter, KeyRound, Mailbox, Palette, Send, Settings2, Shield, Tag, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { SectionCard, Select, Switch } from '../components/ui';
import { useApp } from '../lib/app-state';
import { currentPushEndpoint, pushSupported, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { cn } from '../lib/utils';
import { AccountsSettings } from './settings/AccountsSettings';
import { FiltersSettings } from './settings/FiltersSettings';
import { ForwardingSettings, ImportExportSettings, LabelsSettings, TemplatesSettings } from './settings/DataSettings';
import { ApiKeysSettings, SecuritySettings, WebhooksSettings } from './settings/SecuritySettings';

const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'accounts', label: 'Mailboxes', icon: Mailbox },
  { id: 'filters', label: 'Filters & blocking', icon: Filter },
  { id: 'forwarding', label: 'Forwarding', icon: Send },
  { id: 'labels', label: 'Labels', icon: Tag },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'data', label: 'Import & export', icon: Database },
];

export function SettingsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <h1 className="text-base font-semibold">Settings</h1>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 overflow-y-auto border-r p-3 md:block">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <NavLink to={`/settings/${s.id}`} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-[var(--hover)] hover:text-text')}>
                  <s.icon className="h-4 w-4" /> {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
            <div className="md:hidden">
              <Select value={window.location.pathname.split('/')[2] ?? 'general'} onChange={(e) => (window.location.href = `/settings/${e.target.value}`)}>
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <Routes>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<GeneralSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="accounts" element={<AccountsSettings />} />
              <Route path="filters" element={<FiltersSettings />} />
              <Route path="forwarding" element={<ForwardingSettings />} />
              <Route path="labels" element={<LabelsSettings />} />
              <Route path="templates" element={<TemplatesSettings />} />
              <Route path="notifications" element={<NotificationSettings />} />
              <Route path="security" element={<SecuritySettings />} />
              <Route path="api-keys" element={<ApiKeysSettings />} />
              <Route path="webhooks" element={<WebhooksSettings />} />
              <Route path="data" element={<ImportExportSettings />} />
              <Route path="*" element={<Navigate to="general" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralSettings() {
  const { prefs, setPref, me } = useApp();
  return (
    <>
      <SectionCard title="Reading" description="How conversations behave.">
        <div className="divide-y">
          <Row label="Conversation view" hint="Group replies into a single thread.">
            <Switch checked={prefs.conversationView !== false} onCheckedChange={(v) => setPref('conversationView', v)} />
          </Row>
          <Row label="Inbox categories" hint="Show Primary, Social, Promotions, Updates and Forums tabs.">
            <Switch checked={prefs.categoryTabs === true} onCheckedChange={(v) => setPref('categoryTabs', v)} disabled={me?.settings.inboundCategorization === false} />
          </Row>
          <Row label="External images" hint="Ask before loading remote images to block tracking pixels.">
            <Select value={prefs.showImages ?? 'ask'} onChange={(e) => setPref('showImages', e.target.value as 'always' | 'ask')} className="w-44">
              <option value="ask">Ask before showing</option>
              <option value="always">Always show</option>
            </Select>
          </Row>
          <Row label="Conversations per page">
            <Select value={String(prefs.pageSize ?? 50)} onChange={(e) => setPref('pageSize', Number(e.target.value))} className="w-28">
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Row>
        </div>
      </SectionCard>
      <SectionCard title="Sending" description="Defaults when composing.">
        <div className="divide-y">
          <Row label="Undo send" hint="How long to hold a message so you can cancel it.">
            <Select value={String(prefs.undoSendSeconds ?? me?.settings.defaultUndoSendSeconds ?? 10)} onChange={(e) => setPref('undoSendSeconds', Number(e.target.value))} className="w-36">
              {[0, 5, 10, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Off' : `${n} seconds`}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Signature on replies" hint="Insert your mailbox signature when replying or forwarding.">
            <Switch checked={prefs.signatureOnReply !== false} onCheckedChange={(v) => setPref('signatureOnReply', v)} />
          </Row>
          <Row label="Keyboard shortcuts" hint="Gmail-style keys: c, j/k, e, #, r, /, ? for help.">
            <Switch checked={prefs.keyboardShortcuts !== false} onCheckedChange={(v) => setPref('keyboardShortcuts', v)} />
          </Row>
        </div>
      </SectionCard>
    </>
  );
}

function AppearanceSettings() {
  const { prefs, setPref, theme, setTheme } = useApp();
  return (
    <SectionCard title="Appearance">
      <div className="divide-y">
        <Row label="Theme">
          <Select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')} className="w-36">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Row>
        <Row label="Density" hint="Row height in the conversation list.">
          <Select value={prefs.density ?? 'default'} onChange={(e) => setPref('density', e.target.value as 'default' | 'comfortable' | 'compact')} className="w-36">
            <option value="comfortable">Comfortable</option>
            <option value="default">Default</option>
            <option value="compact">Compact</option>
          </Select>
        </Row>
        <Row label="Reading pane" hint="Where conversations open.">
          <Select value={prefs.readingPane ?? 'right'} onChange={(e) => setPref('readingPane', e.target.value as 'right' | 'bottom' | 'off')} className="w-44">
            <option value="right">Right of the list</option>
            <option value="bottom">Below the list</option>
            <option value="off">No split (full width)</option>
          </Select>
        </Row>
      </div>
    </SectionCard>
  );
}

function NotificationSettings() {
  const { prefs, setPref, me } = useApp();
  const pushAvailable = (me?.settings.pushAvailable ?? false) && pushSupported();
  return (
    <SectionCard title="Notifications" description="Get told about new mail even when this tab is in the background.">
      <div className="divide-y">
        <Row label="Desktop notifications" hint="Browser notifications while the app is open.">
          <Switch
            checked={prefs.desktopNotifications === true}
            onCheckedChange={async (v) => {
              if (v && 'Notification' in window && Notification.permission !== 'granted') {
                const p = await Notification.requestPermission();
                if (p !== 'granted') return toast.error('Notification permission was denied');
              }
              setPref('desktopNotifications', v);
            }}
          />
        </Row>
        <Row label="Push notifications" hint={pushAvailable ? 'Delivered by the browser even when no tab is open.' : 'Not available: the server has no VAPID keys or this browser lacks Web Push.'}>
          <PushToggle enabled={pushAvailable} />
        </Row>
      </div>
    </SectionCard>
  );
}

function PushToggle({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void currentPushEndpoint().then((e) => setOn(Boolean(e)));
  }, []);
  return (
    <Switch
      checked={on}
      disabled={!enabled}
      onCheckedChange={async (v) => {
        try {
          if (v) {
            const key = await fetch('/api/push/vapid', { credentials: 'include' }).then((r) => r.json() as Promise<{ publicKey: string | null }>);
            if (!key.publicKey) return toast.error('Push is not configured on the server');
            const ok = await subscribeToPush(key.publicKey);
            if (!ok) return toast.error('Could not enable push notifications');
            setOn(true);
            toast.success('Push notifications enabled on this device');
          } else {
            await unsubscribeFromPush();
            setOn(false);
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed');
        }
      }}
      label="Push notifications"
    />
  );
}
