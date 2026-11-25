import type { ChiefStreamItem } from '../fixtures/records.js';
import type { ChannelMirror, ThinkingGroup } from './thread-activity.js';

export type ChiefRowClass = 'message' | 'card' | 'exception-alert' | 'status';

type ChiefRowKind = (ChiefStreamItem | ChannelMirror | ThinkingGroup)['kind'];

export const CHIEF_ROW_CLASS: Readonly<Record<ChiefRowKind, ChiefRowClass | 'hidden'>> = {
  user: 'message',
  robot: 'message',
  'daily-report': 'message',
  'chat-block': 'message',
  'channel-mirror': 'message',
  handoff: 'message',
  stopped: 'status',
  question: 'card',
  takeover: 'card',
  'secret-request': 'card',
  'task-card': 'card',
  error: 'exception-alert',
  'runner-offline': 'exception-alert',
  note: 'status',
  thinking: 'status',
  'thinking-group': 'status',
  streaming: 'status',
  'thread-report': 'hidden',
  'thread-message': 'hidden',
  'report-ack': 'hidden',
};

export function chiefRowRenders(kind: string): boolean {
  const rowClass = (CHIEF_ROW_CLASS as Readonly<Record<string, ChiefRowClass | 'hidden'>>)[kind];
  return rowClass !== undefined && rowClass !== 'hidden';
}
