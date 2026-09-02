import { useApp } from '../lib/app-state';
import { SHORTCUT_MAP } from '../lib/shortcuts';
import { Dialog, Kbd, Switch } from './ui';

export function ShortcutsDialog() {
  const { showShortcuts, setShowShortcuts, prefs, setPref } = useApp();
  const groups = new Map<string, typeof SHORTCUT_MAP>();
  for (const s of SHORTCUT_MAP) {
    if (s.keys === 'Enter') continue;
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }
  return (
    <Dialog open={showShortcuts} onOpenChange={setShowShortcuts} title="Keyboard shortcuts" size="lg" description="Press ? anywhere to open this list.">
      <div className="mb-4 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
        <span>Keyboard shortcuts enabled</span>
        <Switch checked={prefs.keyboardShortcuts !== false} onCheckedChange={(v) => setPref('keyboardShortcuts', v)} />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{group}</h3>
            <ul className="space-y-1.5">
              {items.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-3 text-sm">
                  <span>{s.label}</span>
                  <span className="flex items-center gap-1">
                    {s.keys.split(' ').map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-faint">then</span>}
                        <Kbd>{k === 'Escape' ? 'Esc' : k}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Composer</h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between">
              <span>Send</span>
              <span className="flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd>
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span>Bold / Italic / Underline</span>
              <span className="flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>B</Kbd>/<Kbd>I</Kbd>/<Kbd>U</Kbd>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
