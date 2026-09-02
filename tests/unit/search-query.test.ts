import { describe, expect, it } from 'vitest';
import { buildFtsMatch, ftsPhrase, hasAnyFilter, parseSearchQuery, parseSize } from '../../src/shared/search-query';

describe('Gmail-style search query', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('parses operators and quoted phrases', () => {
    const q = parseSearchQuery('from:bob subject:"status report" has:attachment is:unread older_than:7d larger:2mb invoice', now);
    expect(q.from).toEqual(['bob']);
    expect(q.subject).toEqual(['status report']);
    expect(q.hasAttachment).toBe(true);
    expect(q.isUnread).toBe(true);
    expect(q.text).toEqual(['invoice']);
    expect(q.larger).toBe(2 * 1024 * 1024);
    expect(q.before?.toISOString().startsWith('2026-08-26')).toBe(true);
  });

  it('parses sizes and in:/category:', () => {
    expect(parseSize('1.5gb')).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseSearchQuery('in:spam category:promotions').in).toBe('spam');
    expect(parseSearchQuery('is:read').isUnread).toBe(false);
  });

  it('builds FTS MATCH expressions', () => {
    expect(ftsPhrase('say "hi"')).toBe('"say ""hi"""');
    const q = parseSearchQuery('from:ada quarterly report');
    expect(buildFtsMatch(q)).toContain('from_text :');
    expect(buildFtsMatch(q)).toMatch(/"quarterly"/);
    expect(buildFtsMatch({ text: [], from: [], to: [], subject: [], filename: [], labels: [] })).toBeNull();
  });

  it('detects empty vs active filters', () => {
    expect(hasAnyFilter(parseSearchQuery(''))).toBe(false);
    expect(hasAnyFilter(parseSearchQuery('is:starred'))).toBe(true);
  });
});
