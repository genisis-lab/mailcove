import { describe, expect, it } from 'vitest';
import { decodeEntities, escapeHtml, forwardSubject, htmlToText, makeSnippet, normalizeSubject, replySubject, truncateUtf8 } from '../../src/shared/text';

describe('text helpers', () => {
  it('decodes entities and escapes HTML', () => {
    expect(decodeEntities('A&amp;B &#38; &#x26;')).toBe('A&B & &');
    expect(escapeHtml(`<a "b">`)).toBe('&lt;a &quot;b&quot;&gt;');
  });

  it('converts HTML to readable text', () => {
    const text = htmlToText('<p>Hello <a href="https://x.test">there</a></p><script>alert(1)</script><br>Next');
    expect(text).toContain('Hello there (https://x.test)');
    expect(text).not.toContain('alert');
    expect(text).toContain('Next');
  });

  it('normalizes subjects and snippets', () => {
    expect(normalizeSubject('Re: Fwd: Hello')).toBe('hello');
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('Re: Hello')).toBe('Re: Hello');
    expect(forwardSubject('Hello')).toBe('Fwd: Hello');
    expect(makeSnippet('a '.repeat(200), 20).endsWith('…')).toBe(true);
  });

  it('truncates on UTF-8 byte boundaries', () => {
    const s = 'é'.repeat(10);
    const cut = truncateUtf8(s, 5);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(5);
  });
});
