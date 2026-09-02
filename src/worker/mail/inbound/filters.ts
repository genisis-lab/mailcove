import { domainOf } from '../../../shared/address';
import type { FilterActions, FilterCondition } from '../../../shared/types';
import type { Filter } from '../../db/schema';
import type { ParsedMail } from '../providers/types';

export type FilterInput = {
  mail: ParsedMail;
  recipient: string;
  bodyText: string;
};

export type FilterOutcome = {
  actions: FilterActions;
  matched: Filter[];
};

function fieldValue(input: FilterInput, condition: FilterCondition): string | number | boolean {
  const { mail } = input;
  switch (condition.field) {
    case 'from':
      return `${mail.from.name ?? ''} <${mail.from.email}>`.toLowerCase();
    case 'to':
      return [...mail.to, ...mail.cc, { email: input.recipient, name: null }]
        .map((a) => `${a.name ?? ''} <${a.email}>`)
        .join(', ')
        .toLowerCase();
    case 'subject':
      return mail.subject.toLowerCase();
    case 'body':
      return input.bodyText.toLowerCase();
    case 'has_attachment':
      return mail.attachments.some((a) => a.disposition === 'attachment');
    case 'size_gt':
    case 'size_lt':
      return mail.sizeBytes;
    case 'list_id':
      return (mail.headers['list-id'] ?? '').toLowerCase();
    case 'header':
      return (mail.headers[(condition.header ?? '').toLowerCase()] ?? '').toLowerCase();
    default:
      return '';
  }
}

export function evaluateCondition(input: FilterInput, condition: FilterCondition): boolean {
  const value = fieldValue(input, condition);
  const expected = (condition.value ?? '').trim().toLowerCase();

  if (condition.field === 'has_attachment') {
    const want = expected === '' || expected === 'true' || expected === 'yes';
    return value === want;
  }
  if (condition.field === 'size_gt') return typeof value === 'number' && value > parseSize(expected);
  if (condition.field === 'size_lt') return typeof value === 'number' && value < parseSize(expected);

  const haystack = String(value);
  if (!expected) return false;
  switch (condition.operator ?? 'contains') {
    case 'contains':
      return haystack.includes(expected);
    case 'not_contains':
      return !haystack.includes(expected);
    case 'equals':
      if (condition.field === 'from') return domainOrAddressEquals(input.mail.from.email, expected);
      return haystack === expected || haystack.includes(`<${expected}>`);
    case 'starts_with':
      return haystack.startsWith(expected);
    case 'ends_with':
      return haystack.endsWith(expected);
    case 'matches':
      try {
        return new RegExp(condition.value ?? '', 'i').test(haystack);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function domainOrAddressEquals(email: string, expected: string): boolean {
  if (expected.startsWith('@')) return domainOf(email) === expected.slice(1);
  return email === expected;
}

function parseSize(value: string): number {
  const m = value.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!m) return Number.parseFloat(value) || 0;
  const n = Number.parseFloat(m[1]!);
  const unit = (m[2] ?? 'b').toLowerCase();
  return n * (unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1);
}

export function evaluateFilter(input: FilterInput, filter: Filter): boolean {
  if (!filter.enabled || filter.conditions.length === 0) return false;
  const results = filter.conditions.map((c) => evaluateCondition(input, c));
  return filter.matchType === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** Applies every matching filter in order and merges their actions. */
export function runFilters(input: FilterInput, filters: Filter[]): FilterOutcome {
  const merged: FilterActions = {};
  const matched: Filter[] = [];
  for (const filter of [...filters].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!evaluateFilter(input, filter)) continue;
    matched.push(filter);
    const a = filter.actions;
    if (a.skipInbox) merged.skipInbox = true;
    if (a.markRead) merged.markRead = true;
    if (a.star) merged.star = true;
    if (a.markSpam) merged.markSpam = true;
    if (a.neverSpam) merged.neverSpam = true;
    if (a.trash) merged.trash = true;
    if (a.markImportant) merged.markImportant = true;
    if (a.category) merged.category = a.category;
    if (a.forwardTo) merged.forwardTo = a.forwardTo;
    if (a.labelIds?.length) merged.labelIds = [...new Set([...(merged.labelIds ?? []), ...a.labelIds])];
  }
  if (merged.neverSpam) merged.markSpam = false;
  return { actions: merged, matched };
}
