import { isValidEmail, normalizeEmail, parseAddressList } from '@shared/address';
import type { Address } from '@shared/types';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useContactSearch } from '../lib/queries';
import { cn } from '../lib/utils';
import { Avatar } from './ui';

type Props = {
  label: string;
  value: Address[];
  onChange: (value: Address[]) => void;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
  placeholder?: string;
};

export function RecipientInput({ label, value, onChange, autoFocus, trailing, placeholder }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useContactSearch(text.trim());
  const suggestions = (search.data?.items ?? []).filter((c) => !value.some((v) => v.email === c.email)).slice(0, 8);

  useEffect(() => setHighlight(0), [text]);

  function commit(raw: string) {
    const parsed = parseAddressList(raw);
    if (parsed.length === 0) {
      const email = normalizeEmail(raw);
      if (!email) return;
      onChange([...value, { email, name: null }]);
    } else {
      onChange([...value, ...parsed.filter((p) => !value.some((v) => v.email === p.email))]);
    }
    setText('');
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') && (text.trim() || (open && suggestions.length))) {
      e.preventDefault();
      if (open && suggestions[highlight] && e.key !== ',' && e.key !== ';') {
        const s = suggestions[highlight]!;
        onChange([...value, { email: s.email, name: s.name }]);
        setText('');
        setOpen(false);
      } else commit(text);
      return;
    }
    if (e.key === 'Backspace' && !text && value.length) {
      e.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % suggestions.length);
    }
    if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    }
    if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="relative flex min-h-9 items-start gap-2 border-b py-1.5">
      <button type="button" className="w-10 shrink-0 pt-1 text-left text-sm text-muted" onClick={() => inputRef.current?.focus()}>
        {label}
      </button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {value.map((a, i) => {
          const invalid = !isValidEmail(a.email);
          return (
            <span key={`${a.email}-${i}`} className={cn('chip h-6 gap-1.5 pl-0.5 pr-1', invalid && 'border-danger text-danger')} title={a.email}>
              <Avatar email={a.email} name={a.name} size={18} />
              <span className="max-w-48 truncate">{a.name || a.email}</span>
              <button type="button" className="rounded-full p-0.5 hover:bg-[var(--hover)]" aria-label={`Remove ${a.email}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
            if (text.trim()) commit(text);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (/[,;<>]/.test(pasted) || pasted.split(/\s+/).length > 1) {
              e.preventDefault();
              commit(pasted);
            }
          }}
          placeholder={value.length ? '' : placeholder}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-faint"
          aria-label={`${label} recipients`}
          autoComplete="off"
        />
      </div>
      {trailing}
      {open && suggestions.length > 0 && (
        <ul className="menu absolute left-10 top-full z-50 mt-1 w-80 py-1" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn('menu-item w-full text-left', i === highlight && 'bg-[var(--hover)]')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange([...value, { email: s.email, name: s.name }]);
                  setText('');
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              >
                <Avatar email={s.email} name={s.name} size={24} />
                <span className="min-w-0">
                  {s.name && <span className="block truncate text-sm">{s.name}</span>}
                  <span className="block truncate text-xs text-muted">{s.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
