import type { ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import type { Phase } from '../fixtures/records.js';

export function replyDeliveryOf(phase: Phase): ThreadReplyDelivery | null {
  switch (phase) {
    case 'confirm':
    case 'review':
      return 'revision';
    case 'failed':
      return 'restart';
    case 'building':
    case 'needs_input':
    case 'done':
      return 'steer';
    default:
      return null;
  }
}
