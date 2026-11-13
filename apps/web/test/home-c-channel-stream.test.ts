import { describe, expect, it } from 'vitest';
import { mapChiefStream } from '../src/api/mappers.js';
import { channelStream } from '../src/board/home-c.js';

const FALLBACK = 'Owner, what would you like to do in cairn?';

describe('a project channel conversation', () => {
  it('a channel the owner has written in shows its own rows, turn errors included', () => {
    const stream = [
      ...mapChiefStream([
        { id: 'a0', role: 'assistant', content: 'Hi Owner.', createdAt: 1 },
        { id: 'u1', role: 'user', content: 'Fold turns first', createdAt: 2 },
      ]),
      { kind: 'error' as const, text: 'no_model' },
    ];
    expect(channelStream(stream, FALLBACK, false).map((item) => item.kind)).toEqual([
      'robot',
      'user',
      'error',
    ]);
  });

  it('a new channel shows the greeting the model wrote', () => {
    const stream = mapChiefStream([
      { id: 'a0', role: 'assistant', content: 'Hi Owner, two tasks wait on you.', createdAt: 1 },
    ]);
    const shown = channelStream(stream, FALLBACK, false);
    expect(shown.map((item) => ('markdown' in item ? item.markdown : item.kind))).toEqual([
      'Hi Owner, two tasks wait on you.',
    ]);
  });

  it('while the greeting turn runs the channel shows the running row, not the fallback', () => {
    const stream = [{ kind: 'streaming' as const, label: '处理中...' }];
    expect(channelStream(stream, FALLBACK, false)).toEqual(stream);
  });

  it('a failed greeting turn shows the fixed greeting and no error row', () => {
    const shown = channelStream([{ kind: 'error' as const, text: 'no_model' }], FALLBACK, false);
    expect(shown).toEqual([{ kind: 'robot', markdown: FALLBACK, seconds: '' }]);
  });

  it('a channel with no greeting turn at all shows the fixed greeting', () => {
    expect(channelStream([], FALLBACK, true)).toEqual([
      { kind: 'robot', markdown: FALLBACK, seconds: '' },
    ]);
  });

  it('a finished greeting whose message has not arrived yet shows nothing, not the fallback', () => {
    expect(channelStream([], FALLBACK, false)).toEqual([]);
  });
});
