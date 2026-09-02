import type { Category, ThreadFolder } from './types';

export type ParsedSearch = {
  text: string[];
  from: string[];
  to: string[];
  subject: string[];
  filename: string[];
  labels: string[];
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  isSnoozed?: boolean;
  isImportant?: boolean;
  in?: ThreadFolder | 'anywhere' | 'sent' | 'drafts' | 'all';
  category?: Category;
  before?: Date;
  after?: Date;
  larger?: number;
  smaller?: number;
  mailbox?: string;
};

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/i;

export function parseSize(value: string): number | undefined {
  const m = value.match(SIZE_RE);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1]!);
  const unit = (m[2] ?? 'b').toLowerCase();
  const mult = unit.startsWith('g') ? 1024 ** 3 : unit.startsWith('m') ? 1024 ** 2 : unit.startsWith('k') ? 1024 : 1;
  return Math.round(n * mult);
}

function parseDate(value: string, now = new Date()): Date | undefined {
  const rel = value.match(/^(\d+)([dwmy])$/i);
  if (rel) {
    const n = Number.parseInt(rel[1]!, 10);
    const d = new Date(now);
    switch (rel[2]!.toLowerCase()) {
      case 'd':
        d.setDate(d.getDate() - n);
        break;
      case 'w':
        d.setDate(d.getDate() - n * 7);
        break;
      case 'm':
        d.setMonth(d.getMonth() - n);
        break;
      case 'y':
        d.setFullYear(d.getFullYear() - n);
        break;
    }
    return d;
  }
  const normalized = value.replace(/\//g, '-');
  const d = new Date(normalized.length <= 10 ? `${normalized}T00:00:00` : normalized);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Tokenizes a Gmail-style query: `from:bob subject:"status report" has:attachment is:unread older_than:7d`. */
export function parseSearchQuery(input: string, now = new Date()): ParsedSearch {
  const out: ParsedSearch = { text: [], from: [], to: [], subject: [], filename: [], labels: [] };
  const tokens: string[] = [];
  const re = /(-?[a-z_]+:)?("[^"]*"|\S+)/gi;
  for (const m of input.matchAll(re)) {
    const key = m[1]?.toLowerCase() ?? '';
    let value = m[2] ?? '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!key) {
      if (value.trim()) tokens.push(value);
      continue;
    }
    const op = key.slice(0, -1);
    const v = value.trim();
    switch (op) {
      case 'from':
        out.from.push(v.toLowerCase());
        break;
      case 'to':
      case 'cc':
      case 'bcc':
        out.to.push(v.toLowerCase());
        break;
      case 'subject':
        out.subject.push(v);
        break;
      case 'filename':
        out.filename.push(v);
        break;
      case 'label':
      case 'l':
        out.labels.push(v.toLowerCase());
        break;
      case 'has':
        if (v === 'attachment') out.hasAttachment = true;
        break;
      case 'is':
        if (v === 'unread') out.isUnread = true;
        if (v === 'read') out.isUnread = false;
        if (v === 'starred') out.isStarred = true;
        if (v === 'snoozed') out.isSnoozed = true;
        if (v === 'important') out.isImportant = true;
        break;
      case 'in':
        if (['inbox', 'archive', 'spam', 'trash', 'anywhere', 'sent', 'drafts', 'all'].includes(v)) out.in = v as ParsedSearch['in'];
        break;
      case 'category':
        if (['primary', 'social', 'promotions', 'updates', 'forums'].includes(v)) out.category = v as Category;
        break;
      case 'before':
      case 'older':
        out.before = parseDate(v, now);
        break;
      case 'after':
      case 'newer':
        out.after = parseDate(v, now);
        break;
      case 'older_than':
        out.before = parseDate(v, now);
        break;
      case 'newer_than':
        out.after = parseDate(v, now);
        break;
      case 'larger':
      case 'size':
        out.larger = parseSize(v);
        break;
      case 'smaller':
        out.smaller = parseSize(v);
        break;
      case 'mailbox':
      case 'account':
        out.mailbox = v;
        break;
      default:
        tokens.push(`${key}${value}`);
    }
  }
  out.text = tokens;
  return out;
}

/** Escapes a phrase for FTS5 (`"` doubled) and wraps it in quotes. */
export function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** Builds an FTS5 MATCH expression from the parsed query, or null when no text filters exist. */
export function buildFtsMatch(q: ParsedSearch): string | null {
  const parts: string[] = [];
  q.text.forEach((term, index) => {
    const cleaned = term.replace(/[*]/g, '').trim();
    if (!cleaned) return;
    const phrase = ftsPhrase(cleaned);
    parts.push(index === q.text.length - 1 && !term.includes(' ') ? `${phrase}*` : phrase);
  });
  for (const f of q.from) if (f.trim()) parts.push(`from_text : ${ftsPhrase(f.replace(/^@/, ''))}`);
  for (const t of q.to) if (t.trim()) parts.push(`to_text : ${ftsPhrase(t.replace(/^@/, ''))}`);
  for (const s of q.subject) if (s.trim()) parts.push(`subject : ${ftsPhrase(s)}`);
  return parts.length ? parts.join(' AND ') : null;
}

export function hasAnyFilter(q: ParsedSearch): boolean {
  return Boolean(
    q.text.length ||
      q.from.length ||
      q.to.length ||
      q.subject.length ||
      q.filename.length ||
      q.labels.length ||
      q.hasAttachment !== undefined ||
      q.isUnread !== undefined ||
      q.isStarred ||
      q.isSnoozed ||
      q.isImportant ||
      q.in ||
      q.category ||
      q.before ||
      q.after ||
      q.larger ||
      q.smaller ||
      q.mailbox,
  );
}
