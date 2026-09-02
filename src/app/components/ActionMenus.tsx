import { addDays, addHours, nextMonday, nextSaturday, set, startOfTomorrow } from 'date-fns';
import { Check, Clock, Plus, Tag } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useApp } from '../lib/app-state';
import type { ThreadItem } from '../lib/types';
import { Button, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui';

function fmt(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function snoozePresets(now = new Date()): Array<{ label: string; when: Date; hint: string }> {
  const laterToday = set(addHours(now, 3), { minutes: 0, seconds: 0, milliseconds: 0 });
  const tomorrow = set(startOfTomorrow(), { hours: 8, minutes: 0, seconds: 0, milliseconds: 0 });
  const weekend = set(nextSaturday(now), { hours: 8, minutes: 0, seconds: 0, milliseconds: 0 });
  const nextWeek = set(nextMonday(now), { hours: 8, minutes: 0, seconds: 0, milliseconds: 0 });
  const presets = [
    { label: 'Later today', when: laterToday, hint: fmt(laterToday) },
    { label: 'Tomorrow', when: tomorrow, hint: fmt(tomorrow) },
    { label: 'This weekend', when: weekend, hint: fmt(weekend) },
    { label: 'Next week', when: nextWeek, hint: fmt(nextWeek) },
  ];
  return presets.filter((p) => p.when.getTime() > now.getTime() + 5 * 60_000);
}

export function SnoozeMenu({ trigger, onSnooze }: { trigger: ReactNode; onSnooze: (until: Date) => void }) {
  const [custom, setCustom] = useState('');
  const presets = snoozePresets();
  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent align="end" className="w-64">
        <MenuLabel>Snooze until…</MenuLabel>
        {presets.map((p) => (
          <MenuItem key={p.label} onSelect={() => onSnooze(p.when)}>
            <Clock className="h-4 w-4 text-muted" />
            <span className="flex-1">{p.label}</span>
            <span className="text-xs text-faint">{p.hint}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Pick date & time</div>
          <div className="flex gap-2">
            <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 text-xs" min={new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 16)} />
            <Button
              size="sm"
              variant="primary"
              disabled={!custom}
              onClick={() => {
                const d = new Date(custom);
                if (!Number.isNaN(d.getTime())) onSnooze(d);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </MenuContent>
    </Menu>
  );
}

export function LabelMenu({ trigger, threads, onToggle, onCreate }: { trigger: ReactNode; threads: Array<Pick<ThreadItem, 'id' | 'labels'>>; onToggle: (labelId: string, apply: boolean) => void; onCreate?: () => void }) {
  const { me } = useApp();
  const [filter, setFilter] = useState('');
  const labels = (me?.labels ?? []).filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()));
  const appliedCount = (labelId: string) => threads.filter((t) => t.labels.some((l) => l.id === labelId)).length;
  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent align="end" className="w-64">
        <div className="px-1.5 pb-1" onKeyDown={(e) => e.stopPropagation()}>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Label as…" className="h-8 text-xs" autoFocus />
        </div>
        {labels.map((label) => {
          const count = appliedCount(label.id);
          const all = count === threads.length && threads.length > 0;
          const some = count > 0 && !all;
          return (
            <MenuItem key={label.id} onSelect={() => onToggle(label.id, !all)}>
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${all || some ? 'border-accent bg-accent text-accent-foreground' : 'border-border-strong'}`}>
                {all && <Check className="h-3 w-3" strokeWidth={3} />}
                {some && <span className="block h-0.5 w-2 rounded bg-current" />}
              </span>
              <Tag className="h-3.5 w-3.5" style={{ color: label.color }} />
              <span className="truncate">{label.name}</span>
            </MenuItem>
          );
        })}
        {labels.length === 0 && <div className="px-2.5 py-2 text-xs text-faint">No labels match.</div>}
        {onCreate && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={onCreate}>
              <Plus className="h-4 w-4 text-muted" /> Create new label
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

export function schedulePresets(now = new Date()): Array<{ label: string; when: Date }> {
  const tomorrowMorning = set(startOfTomorrow(), { hours: 8, minutes: 0, seconds: 0, milliseconds: 0 });
  const tomorrowAfternoon = set(startOfTomorrow(), { hours: 13, minutes: 0, seconds: 0, milliseconds: 0 });
  const monday = set(nextMonday(now), { hours: 8, minutes: 0, seconds: 0, milliseconds: 0 });
  const inTwoDays = set(addDays(now, 2), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 });
  return [
    { label: 'Tomorrow morning', when: tomorrowMorning },
    { label: 'Tomorrow afternoon', when: tomorrowAfternoon },
    { label: 'In two days', when: inTwoDays },
    { label: 'Monday morning', when: monday },
  ];
}
