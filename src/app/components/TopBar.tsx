import { useQueryClient } from '@tanstack/react-query';
import { HelpCircle, Inbox, Keyboard, LogOut, Menu as MenuIcon, Moon, Settings, Shield, Sun, Wifi, WifiOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app-state';
import { authClient } from '../lib/auth-client';
import { SearchBar } from './SearchBar';
import { Avatar, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from './ui';

export function TopBar({ realtimeConnected }: { realtimeConnected: boolean }) {
  const { me, sidebarOpen, setSidebarOpen, theme, setTheme, setShowShortcuts } = useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    qc.clear();
    navigate('/login', { replace: true });
  }

  const appName = me?.settings.appName ?? 'Mailcove';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-3">
      <IconButton label={sidebarOpen ? 'Collapse menu' : 'Expand menu'} onClick={() => setSidebarOpen(!sidebarOpen)}>
        <MenuIcon className="h-5 w-5" />
      </IconButton>
      <Link to="/mail/inbox" className="mr-2 flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--hover)]">
        {me?.settings.logoUrl ? (
          <img src={me.settings.logoUrl} alt="" className="h-7 w-7 rounded-lg object-contain" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Inbox className="h-4 w-4" />
          </span>
        )}
        <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">{appName}</span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-center">
        <SearchBar />
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip content={realtimeConnected ? 'Live updates connected' : 'Reconnecting… (polling)'}>
          <span className="icon-btn hidden sm:inline-flex">{realtimeConnected ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-faint" />}</span>
        </Tooltip>
        <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}>
          {document.documentElement.classList.contains('dark') ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </IconButton>
        <IconButton label="Keyboard shortcuts (?)" onClick={() => setShowShortcuts(true)} className="hidden sm:inline-flex">
          <Keyboard className="h-5 w-5" />
        </IconButton>
        <IconButton label="Settings" onClick={() => navigate('/settings')}>
          <Settings className="h-5 w-5" />
        </IconButton>
        <Menu>
          <MenuTrigger asChild>
            <button className="ml-1 rounded-full ring-offset-2 ring-offset-bg focus-visible:ring-2" aria-label="Account menu">
              <Avatar name={me?.user.name} email={me?.user.email ?? ''} src={me?.user.avatarUrl} size={32} />
            </button>
          </MenuTrigger>
          <MenuContent align="end" className="w-64">
            <div className="flex items-center gap-3 px-2.5 py-2">
              <Avatar name={me?.user.name} email={me?.user.email ?? ''} src={me?.user.avatarUrl} size={40} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{me?.user.name}</div>
                <div className="truncate text-xs text-muted">{me?.user.email}</div>
              </div>
            </div>
            <MenuSeparator />
            <MenuLabel>Mailboxes</MenuLabel>
            {me?.mailboxes.slice(0, 6).map((m) => (
              <MenuItem key={m.id} onSelect={() => navigate('/settings/accounts')}>
                <span className="truncate">{m.address}</span>
                {m.type === 'shared' && <span className="chip ml-auto">shared</span>}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => navigate('/settings')}>
              <Settings className="h-4 w-4 text-muted" /> Settings
            </MenuItem>
            {me?.user.isAdmin && (
              <MenuItem onSelect={() => navigate('/admin')}>
                <Shield className="h-4 w-4 text-muted" /> Admin panel
              </MenuItem>
            )}
            <MenuItem onSelect={() => setShowShortcuts(true)}>
              <HelpCircle className="h-4 w-4 text-muted" /> Keyboard shortcuts
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={signOut}>
              <LogOut className="h-4 w-4 text-muted" /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
