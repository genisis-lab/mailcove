import { describe, expect, it } from 'vitest';
import {
  displayName,
  formatAddress,
  initials,
  isValidEmail,
  normalizeEmail,
  parseAddressList,
  splitAddress,
  stripPlusTag,
  uniqueAddresses,
} from '../../src/shared/address';

describe('address helpers', () => {
  it('validates and normalizes emails', () => {
    expect(isValidEmail('Ada@Example.COM')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(normalizeEmail(' <Ada@Example.COM> ')).toBe('ada@example.com');
  });

  it('splits plus-tags', () => {
    expect(splitAddress('user+tag@example.com')).toEqual({ localPart: 'user+tag', domain: 'example.com' });
    expect(stripPlusTag('user+tag@example.com')).toBe('user@example.com');
    expect(stripPlusTag('user@example.com')).toBe('user@example.com');
  });

  it('parses header-style address lists', () => {
    const list = parseAddressList('"Jane Doe" <jane@x.com>, bob@y.com; "A, B" <ab@z.com>');
    expect(list).toEqual([
      { email: 'jane@x.com', name: 'Jane Doe' },
      { email: 'bob@y.com', name: null },
      { email: 'ab@z.com', name: 'A, B' },
    ]);
  });

  it('formats, dedupes and initials', () => {
    expect(formatAddress({ email: 'a@b.com', name: 'Ada Lovelace' })).toBe('Ada Lovelace <a@b.com>');
    expect(formatAddress({ email: 'a@b.com', name: 'Ada, A' })).toBe('"Ada, A" <a@b.com>');
    expect(displayName({ email: 'a@b.com', name: 'Ada' })).toBe('Ada');
    expect(
      uniqueAddresses([
        { email: 'A@b.com', name: 'Ada' },
        { email: 'a@b.com', name: 'Other' },
      ]),
    ).toEqual([{ email: 'a@b.com', name: 'Ada' }]);
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada@example.com')).toBe('AD');
  });
});
