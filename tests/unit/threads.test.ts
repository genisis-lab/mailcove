import { describe, expect, it } from 'vitest';
import { extractMessageIds, normalizeMessageId } from '../../src/worker/mail/threads';
import { canUndoSend } from '../../src/shared/mail';

describe('threading ids', () => {
  it('extracts Message-IDs from In-Reply-To and References', () => {
    expect(extractMessageIds('<a@x>', ' <b@x> <c@x> ')).toEqual(['<a@x>', '<b@x>', '<c@x>']);
    expect(extractMessageIds('bare-id@x')).toEqual(['<bare-id@x>']);
    expect(extractMessageIds(null, undefined, '')).toEqual([]);
  });

  it('normalizes a Message-ID', () => {
    expect(normalizeMessageId(' a@x ')).toBe('<a@x>');
    expect(normalizeMessageId('<a@x>')).toBe('<a@x>');
    expect(normalizeMessageId('')).toBeNull();
  });
});

describe('undo-send state machine', () => {
  it('only queued or scheduled messages can be cancelled', () => {
    expect(canUndoSend('queued')).toBe(true);
    expect(canUndoSend('scheduled')).toBe(true);
    expect(canUndoSend('sending')).toBe(false);
    expect(canUndoSend('sent')).toBe(false);
    expect(canUndoSend('cancelled')).toBe(false);
    expect(canUndoSend('draft')).toBe(false);
  });
});
