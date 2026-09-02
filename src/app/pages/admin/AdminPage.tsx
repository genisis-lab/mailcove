import { Activity, AlertTriangle, Database, Globe, HardDrive, LayoutDashboard, Mailbox, ScrollText, Server, Settings2, Truck, Users } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Select } from '../../components/ui';
import { cn } from '../../lib/utils';
import { AdminDashboard } from './AdminDashboard';
import { AdminDomains, AdminMailboxes } from './AdminDomains';
import { AdminAudit, AdminBackups, AdminDeadLetters, AdminDelivery, AdminUnrouted } from './AdminOps';
import { AdminProviders } from './AdminProviders';
import { AdminSettings } from './AdminSettings';
import { AdminUsers } from './AdminUsers';

const SECTIONS = [
  { id: '', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'domains', label: 'Domains', icon: Globe },
  { id: 'mailboxes', label: 'Mailboxes', icon: Mailbox },
  { id: 'providers', label: 'Providers', icon: Server },
  { id: 'unrouted', label: 'Unrouted mail', icon: AlertTriangle },
  { id: 'delivery', label: 'Delivery log', icon: Truck },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'dead-letters', label: 'Dead letters', icon: Activity },
  { id: 'backups', label: 'Backups', icon: HardDrive },
  { id: 'settings', label: 'Settings & branding', icon: Settings2 },
];

export function AdminPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Database className="h-4 w-4 text-muted" />
        <h1 className="text-base font-semibold">Admin panel</h1>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 overflow-y-auto border-r p-3 md:block">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <NavLink end={s.id === ''} to={`/admin/${s.id}`} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-[var(--hover)] hover:text-text')}>
                  <s.icon className="h-4 w-4" /> {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
            <div className="md:hidden">
              <Select value={window.location.pathname.split('/')[2] ?? ''} onChange={(e) => (window.location.href = `/admin/${e.target.value}`)}>
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <Routes>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="domains" element={<AdminDomains />} />
              <Route path="mailboxes" element={<AdminMailboxes />} />
              <Route path="providers" element={<AdminProviders />} />
              <Route path="unrouted" element={<AdminUnrouted />} />
              <Route path="delivery" element={<AdminDelivery />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="dead-letters" element={<AdminDeadLetters />} />
              <Route path="backups" element={<AdminBackups />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}
