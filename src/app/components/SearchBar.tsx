import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app-state';
import { Button, Field, Input, Popover, PopoverContent, PopoverTrigger, Select } from './ui';

export function SearchBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { me } = useApp();
  const params = new URLSearchParams(location.search);
  const [value, setValue] = useState(params.get('q') ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [adv, setAdv] = useState({ from: '', to: '', subject: '', words: '', hasAttachment: false, within: '', mailbox: 'all', folder: '' });

  useEffect(() => {
    if (!location.pathname.startsWith('/mail/search')) setValue('');
    else setValue(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.pathname, location.search]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/mail/search?q=${encodeURIComponent(q)}`);
  }

  function submitAdvanced(e: FormEvent) {
    e.preventDefault();
    const parts: string[] = [];
    if (adv.from) parts.push(`from:${quote(adv.from)}`);
    if (adv.to) parts.push(`to:${quote(adv.to)}`);
    if (adv.subject) parts.push(`subject:${quote(adv.subject)}`);
    if (adv.words) parts.push(adv.words);
    if (adv.hasAttachment) parts.push('has:attachment');
    if (adv.within) parts.push(`newer_than:${adv.within}`);
    if (adv.folder) parts.push(`in:${adv.folder}`);
    if (adv.mailbox !== 'all') parts.push(`mailbox:${adv.mailbox}`);
    const q = parts.join(' ').trim();
    setAdvancedOpen(false);
    if (q) {
      setValue(q);
      navigate(`/mail/search?q=${encodeURIComponent(q)}`);
    }
  }

  return (
    <form onSubmit={submit} className="relative w-full max-w-2xl">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        data-search-input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search mail — try from:alice has:attachment newer_than:7d"
        className="h-11 w-full rounded-full border border-transparent bg-surface-3 pl-10 pr-20 text-sm outline-none transition-[background,box-shadow] placeholder:text-faint focus:border-border-strong focus:bg-surface focus:shadow-[var(--shadow)]"
        aria-label="Search mail"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            className="icon-btn h-7 w-7"
            onClick={() => {
              setValue('');
              if (location.pathname.startsWith('/mail/search')) navigate('/mail/inbox');
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="icon-btn h-7 w-7" aria-label="Advanced search">
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[26rem] p-4">
            <form onSubmit={submitAdvanced} className="grid gap-3">
              <Field label="From">
                <Input value={adv.from} onChange={(e) => setAdv({ ...adv, from: e.target.value })} />
              </Field>
              <Field label="To">
                <Input value={adv.to} onChange={(e) => setAdv({ ...adv, to: e.target.value })} />
              </Field>
              <Field label="Subject">
                <Input value={adv.subject} onChange={(e) => setAdv({ ...adv, subject: e.target.value })} />
              </Field>
              <Field label="Has the words">
                <Input value={adv.words} onChange={(e) => setAdv({ ...adv, words: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date within">
                  <Select value={adv.within} onChange={(e) => setAdv({ ...adv, within: e.target.value })}>
                    <option value="">Any time</option>
                    <option value="1d">1 day</option>
                    <option value="7d">1 week</option>
                    <option value="1m">1 month</option>
                    <option value="6m">6 months</option>
                    <option value="1y">1 year</option>
                  </Select>
                </Field>
                <Field label="Search in">
                  <Select value={adv.folder} onChange={(e) => setAdv({ ...adv, folder: e.target.value })}>
                    <option value="">All mail</option>
                    <option value="inbox">Inbox</option>
                    <option value="archive">Archive</option>
                    <option value="sent">Sent</option>
                    <option value="drafts">Drafts</option>
                    <option value="spam">Spam</option>
                    <option value="trash">Trash</option>
                    <option value="anywhere">Everywhere incl. spam & trash</option>
                  </Select>
                </Field>
              </div>
              {me && me.mailboxes.length > 1 && (
                <Field label="Mailbox">
                  <Select value={adv.mailbox} onChange={(e) => setAdv({ ...adv, mailbox: e.target.value })}>
                    <option value="all">All mailboxes</option>
                    {me.mailboxes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.address}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={adv.hasAttachment} onChange={(e) => setAdv({ ...adv, hasAttachment: e.target.checked })} className="accent-[var(--accent)]" />
                Has attachment
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdv({ from: '', to: '', subject: '', words: '', hasAttachment: false, within: '', mailbox: 'all', folder: '' })}>
                  Reset
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Search
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </form>
  );
}

function quote(v: string): string {
  return /\s/.test(v) ? `"${v.replace(/"/g, '')}"` : v;
}
