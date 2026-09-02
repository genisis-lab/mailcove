import { describe, expect, it } from 'vitest';
import { splitMbox } from '../../src/worker/mail/mbox';
import { parseRawMail } from '../../src/worker/mail/parse';

const RAW = [
  'From: Alice Example <alice@corp.test>',
  'To: You <you@example.com>',
  'Subject: Hello from MIME',
  'Message-ID: <abc@corp.test>',
  'Date: Wed, 02 Sep 2026 12:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'This is the body.',
  '',
].join('\r\n');

describe('parseRawMail', () => {
  it('parses a minimal RFC 5322 message', async () => {
    const mail = await parseRawMail(new TextEncoder().encode(RAW));
    expect(mail.from).toEqual({ email: 'alice@corp.test', name: 'Alice Example' });
    expect(mail.to[0]?.email).toBe('you@example.com');
    expect(mail.subject).toBe('Hello from MIME');
    expect(mail.messageId).toMatch(/abc@corp.test/);
    expect(mail.text).toContain('This is the body.');
    expect(mail.sizeBytes).toBeGreaterThan(20);
  });

  it('splits mbox archives on From lines', () => {
    const buf = new TextEncoder().encode('From a@b Sun Sep 1\nFirst\nFrom c@d Sun Sep 2\nSecond\n');
    const parts = splitMbox(buf).map((p) => new TextDecoder().decode(p).trim());
    expect(parts).toEqual(['First', 'Second']);
  });
});
