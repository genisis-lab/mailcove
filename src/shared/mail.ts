import type { MessageStatus } from './types';

/** A queued or scheduled message can still be pulled back into Drafts. */
export function canUndoSend(status: MessageStatus): boolean {
  return status === 'queued' || status === 'scheduled';
}
