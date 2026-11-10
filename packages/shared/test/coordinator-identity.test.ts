import { expect, test } from 'vitest';
import {
  coordinatorConversationKey,
  coordinatorTextSourceId,
  coordinatorToolSourceId,
  parseCoordinatorConversationKey,
  parseCoordinatorTextSourceId,
} from '../src/coordinator-identity.js';

test('conversation keys preserve the exact native ID inside one store namespace', () => {
  expect(parseCoordinatorConversationKey(coordinatorConversationKey('store_one', '42'))).toEqual({
    storeId: 'store_one',
    conversationId: '42',
  });
  expect(coordinatorConversationKey('store_two', '42')).not.toBe(
    coordinatorConversationKey('store_one', '42'),
  );
  expect(parseCoordinatorConversationKey('42')).toBeNull();
  expect(() => coordinatorConversationKey('another:store', '42')).toThrow('Invalid');
  expect(() => coordinatorConversationKey('store', 'NaN')).toThrow('Invalid');
});

test('native text source IDs retain producer, entry and store identity', () => {
  const id = coordinatorTextSourceId('producer', '42', 'store_one');
  expect(parseCoordinatorTextSourceId(id)).toEqual({
    storeId: 'store_one',
    stepId: 'producer',
    entryId: '42',
  });
  expect(id).toMatch(/^[A-Za-z0-9_.:-]{1,128}$/);
  expect(coordinatorTextSourceId('producer', '42', 'store_two')).not.toBe(id);
});

test('historical text source IDs retain their conservative identity', () => {
  expect(coordinatorTextSourceId('producer', '42')).toBe('producer-e42');
  expect(parseCoordinatorTextSourceId('producer-e42')).toEqual({
    storeId: null,
    stepId: 'producer',
    entryId: '42',
  });
  expect(parseCoordinatorTextSourceId('tool-call')).toBeNull();
});

test('tool call keys cannot collide across store replacement', () => {
  expect(coordinatorToolSourceId('store_one', 'call')).not.toBe(
    coordinatorToolSourceId('store_two', 'call'),
  );
});
