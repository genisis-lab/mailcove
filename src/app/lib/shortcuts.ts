import { useEffect, useRef } from 'react';

export type ShortcutHandlers = Partial<Record<ShortcutName, () => void>>;

export type ShortcutName =
  | 'compose'
  | 'search'
  | 'next'
  | 'prev'
  | 'open'
  | 'back'
  | 'archive'
  | 'trash'
  | 'reply'
  | 'replyAll'
  | 'forward'
  | 'star'
  | 'toggleRead'
  | 'select'
  | 'selectAll'
  | 'snooze'
  | 'label'
  | 'spam'
  | 'help'
  | 'gotoInbox'
  | 'gotoStarred'
  | 'gotoSent'
  | 'gotoDrafts'
  | 'gotoAll'
  | 'gotoSnoozed'
  | 'gotoTrash'
  | 'undo'
  | 'escape';

/** Key → shortcut. Two-key sequences are keyed by "g then x". */
export const SHORTCUT_MAP: Array<{ keys: string; name: ShortcutName; label: string; group: string }> = [
  { keys: 'c', name: 'compose', label: 'Compose', group: 'Actions' },
  { keys: '/', name: 'search', label: 'Search mail', group: 'Navigation' },
  { keys: 'j', name: 'next', label: 'Next conversation', group: 'Navigation' },
  { keys: 'k', name: 'prev', label: 'Previous conversation', group: 'Navigation' },
  { keys: 'o', name: 'open', label: 'Open conversation', group: 'Navigation' },
  { keys: 'Enter', name: 'open', label: 'Open conversation', group: 'Navigation' },
  { keys: 'u', name: 'back', label: 'Back to list', group: 'Navigation' },
  { keys: 'e', name: 'archive', label: 'Archive', group: 'Actions' },
  { keys: '#', name: 'trash', label: 'Delete', group: 'Actions' },
  { keys: 'r', name: 'reply', label: 'Reply', group: 'Actions' },
  { keys: 'a', name: 'replyAll', label: 'Reply all', group: 'Actions' },
  { keys: 'f', name: 'forward', label: 'Forward', group: 'Actions' },
  { keys: 's', name: 'star', label: 'Toggle star', group: 'Actions' },
  { keys: 'I', name: 'toggleRead', label: 'Mark read / unread', group: 'Actions' },
  { keys: 'x', name: 'select', label: 'Select conversation', group: 'Selection' },
  { keys: '*a', name: 'selectAll', label: 'Select all', group: 'Selection' },
  { keys: 'b', name: 'snooze', label: 'Snooze', group: 'Actions' },
  { keys: 'l', name: 'label', label: 'Label as', group: 'Actions' },
  { keys: '!', name: 'spam', label: 'Report spam', group: 'Actions' },
  { keys: 'z', name: 'undo', label: 'Undo last action', group: 'Actions' },
  { keys: 'g i', name: 'gotoInbox', label: 'Go to Inbox', group: 'Jump' },
  { keys: 'g s', name: 'gotoStarred', label: 'Go to Starred', group: 'Jump' },
  { keys: 'g t', name: 'gotoSent', label: 'Go to Sent', group: 'Jump' },
  { keys: 'g d', name: 'gotoDrafts', label: 'Go to Drafts', group: 'Jump' },
  { keys: 'g a', name: 'gotoAll', label: 'Go to All mail', group: 'Jump' },
  { keys: 'g b', name: 'gotoSnoozed', label: 'Go to Snoozed', group: 'Jump' },
  { keys: 'g #', name: 'gotoTrash', label: 'Go to Trash', group: 'Jump' },
  { keys: '?', name: 'help', label: 'Keyboard shortcuts', group: 'Help' },
  { keys: 'Escape', name: 'escape', label: 'Close / deselect', group: 'Navigation' },
];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"], [role="dialog"] input, [role="dialog"] textarea'));
}

export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const pending = useRef<string | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        ref.current.escape?.();
        pending.current = null;
        return;
      }
      if (isEditable(e.target)) return;
      const key = e.key;
      if (pending.current) {
        const combo = `${pending.current} ${key}`;
        pending.current = null;
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        const match = SHORTCUT_MAP.find((s) => s.keys === combo || s.keys === `${combo.replace(' ', '')}`);
        if (match && ref.current[match.name]) {
          e.preventDefault();
          ref.current[match.name]?.();
        }
        return;
      }
      if (key === 'g' || key === '*') {
        pending.current = key;
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        pendingTimer.current = setTimeout(() => (pending.current = null), 1200);
        return;
      }
      const match = SHORTCUT_MAP.find((s) => s.keys === key);
      if (!match) return;
      const handler = ref.current[match.name];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
