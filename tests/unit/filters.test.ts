import { describe, expect, it } from 'vitest';
import type { Filter } from '../../src/worker/db/schema';
import { evaluateCondition, runFilters, type FilterInput } from '../../src/worker/mail/inbound/filters';
import type { ParsedMail } from '../../src/worker/mail/providers/types';

function mail(over: Partial<ParsedMail> = {}): ParsedMail {
  return {
    messageId: '<m1@x>',
    inReplyTo: null,
    references: null,
    from: { email: 'alice@corp.test', name: 'Alice' },
    to: [{ email: 'you@example.com', name: null }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Quarterly invoice',
    date: new Date(),
    text: 'Please find the invoice attached.',
    html: null,
    headers: { 'list-id': '<news.corp.test>' },
    attachments: [{ filename: 'inv.pdf', contentType: 'application/pdf', content: new Uint8Array([1]), disposition: 'attachment' }],
    sizeBytes: 80_000,
    ...over,
  };
}

function input(over: Partial<FilterInput> = {}): FilterInput {
  const parsed = over.mail ?? mail();
  return { mail: parsed, recipient: 'you@example.com', bodyText: parsed.text ?? '', ...over };
}

function filter(over: Partial<Filter>): Filter {
  return {
    id: 'f1',
    userId: 'u1',
    mailboxId: null,
    name: 'test',
    matchType: 'all',
    conditions: [],
    actions: {},
    sortOrder: 0,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('filter engine', () => {
  it('matches from contains / domain equals / attachment / size', () => {
    const i = input();
    expect(evaluateCondition(i, { field: 'from', operator: 'contains', value: 'alice' })).toBe(true);
    expect(evaluateCondition(i, { field: 'from', operator: 'equals', value: '@corp.test' })).toBe(true);
    expect(evaluateCondition(i, { field: 'from', operator: 'equals', value: 'other@x.test' })).toBe(false);
    expect(evaluateCondition(i, { field: 'has_attachment', value: 'true' })).toBe(true);
    expect(evaluateCondition(i, { field: 'size_gt', value: '10kb' })).toBe(true);
    expect(evaluateCondition(i, { field: 'subject', operator: 'matches', value: 'invoice$' })).toBe(true);
  });

  it('merges actions in sort order and lets neverSpam win', () => {
    const outcome = runFilters(input(), [
      filter({
        id: 'a',
        sortOrder: 2,
        conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
        actions: { markSpam: true, forwardTo: 'later@example.com' },
      }),
      filter({
        id: 'b',
        sortOrder: 1,
        conditions: [{ field: 'from', operator: 'contains', value: 'alice' }],
        actions: { star: true, labelIds: ['l1'], neverSpam: true, forwardTo: 'first@example.com' },
      }),
    ]);
    expect(outcome.matched.map((f) => f.id)).toEqual(['b', 'a']);
    expect(outcome.actions.star).toBe(true);
    expect(outcome.actions.neverSpam).toBe(true);
    expect(outcome.actions.markSpam).toBe(false);
    expect(outcome.actions.forwardTo).toBe('later@example.com');
    expect(outcome.actions.labelIds).toEqual(['l1']);
  });

  it('ignores disabled filters and empty condition lists', () => {
    const outcome = runFilters(input(), [
      filter({ enabled: false, conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }], actions: { star: true } }),
      filter({ conditions: [], actions: { markRead: true } }),
    ]);
    expect(outcome.matched).toHaveLength(0);
  });
});
