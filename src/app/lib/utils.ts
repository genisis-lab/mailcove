import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Gmail-style list timestamps: time today, "Mon", "Sep 2", or "9/2/25". */
export function formatListDate(value: string | Date, now = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 6 && diffDays > 0) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

export function formatFullDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(value: string | Date, now = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function initialsOf(nameOrEmail: string): string {
  const s = nameOrEmail.trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return s.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || s[0]!.toUpperCase();
}

const AVATAR_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#0ea5e9', '#10b981'];

export function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function readableTextColor(hex: string): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return '#fff';
  const r = Number.parseInt(m.slice(0, 2), 16);
  const g = Number.parseInt(m.slice(2, 4), 16);
  const b = Number.parseInt(m.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#111' : '#fff';
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : plural}`;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function downloadUrl(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
