import type { Address } from './types';

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().replace(/^<|>$/g, '');
}

export function splitAddress(email: string): { localPart: string; domain: string } {
  const at = email.lastIndexOf('@');
  if (at === -1) return { localPart: email, domain: '' };
  return { localPart: email.slice(0, at), domain: email.slice(at + 1) };
}

/** `user+tag@example.com` → `user@example.com` */
export function stripPlusTag(email: string): string {
  const { localPart, domain } = splitAddress(email);
  const plus = localPart.indexOf('+');
  if (plus === -1) return email;
  return `${localPart.slice(0, plus)}@${domain}`;
}

export function domainOf(email: string): string {
  return splitAddress(normalizeEmail(email)).domain;
}

/**
 * Parses a header-style address list: `"Jane Doe" <jane@x.com>, bob@y.com`.
 * Tolerant of unquoted display names and stray whitespace.
 */
export function parseAddressList(input: string | null | undefined): Address[] {
  if (!input) return [];
  const out: Address[] = [];
  let buf = '';
  let inQuotes = false;
  let depth = 0;
  const flush = () => {
    const parsed = parseSingleAddress(buf);
    if (parsed) out.push(parsed);
    buf = '';
  };
  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      if (ch === '<') depth++;
      if (ch === '>') depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === ';') && depth === 0) {
        flush();
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}

export function parseSingleAddress(raw: string): Address | null {
  const value = raw.trim();
  if (!value) return null;
  const angle = value.match(/^(.*?)<([^<>]+)>\s*$/);
  if (angle) {
    const email = normalizeEmail(angle[2] ?? '');
    if (!isValidEmail(email)) return null;
    const name = (angle[1] ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
    return { email, name: name || null };
  }
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) return null;
  return { email, name: null };
}

export function formatAddress(address: Address): string {
  if (!address.name) return address.email;
  const needsQuotes = /[",;<>@()\\]/.test(address.name);
  const name = needsQuotes ? `"${address.name.replace(/"/g, '\\"')}"` : address.name;
  return `${name} <${address.email}>`;
}

export function displayName(address: Address | null | undefined, fallback = ''): string {
  if (!address) return fallback;
  return address.name?.trim() || address.email || fallback;
}

export function uniqueAddresses(list: Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of list) {
    const key = normalizeEmail(a.email);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: key, name: a.name ?? null });
  }
  return out;
}

export function initials(nameOrEmail: string): string {
  const cleaned = nameOrEmail.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return cleaned.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || cleaned[0]!.toUpperCase();
}
