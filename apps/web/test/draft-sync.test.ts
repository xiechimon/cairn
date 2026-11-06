import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDraftTransport,
  type DraftSnapshot,
  type DraftTransport,
} from '../src/api/drafts.js';
import { DRAFT_SAVE_DEBOUNCE_MS, type DraftStorage, DraftSync } from '../src/overlay/draft-sync.js';

const KEY = 'cairn.chief-draft';

function memoryStorage(
  seed: Record<string, string> = {},
): DraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function fakeServer() {
  const state: { content: string; updatedAt: number | null; saves: string[]; fail: boolean } = {
    content: '',
    updatedAt: null,
    saves: [],
    fail: false,
  };
  const transport: DraftTransport = {
    async load(): Promise<DraftSnapshot> {
      return { content: state.content, updatedAt: state.updatedAt };
    },
    async save(content): Promise<DraftSnapshot> {
      if (state.fail) throw new Error('offline');
      state.saves.push(content);
      state.content = content;
      state.updatedAt = content === '' ? null : (state.updatedAt ?? 0) + 1;
      return { content: state.content, updatedAt: state.updatedAt };
    },
  };
  return { state, transport };
}

function make(
  server: ReturnType<typeof fakeServer>,
  storage: DraftStorage,
  onRemote = vi.fn<(text: string) => void>(),
) {
  const sync = new DraftSync({ transport: server.transport, storage, localKey: KEY, onRemote });
  return { sync, onRemote };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('draft transport', () => {
  it('rejects a response that is not a draft snapshot instead of adopting undefined text', async () => {
    vi.useRealTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })),
    );
    await expect(createDraftTransport('team-1', 'chief').load()).rejects.toThrow('malformed');
    vi.unstubAllGlobals();
  });
});

describe('DraftSync', () => {
  it('reload: the local buffer restores the text before the server answers', () => {
    const { sync } = make(fakeServer(), memoryStorage({ [KEY]: 'typed before close' }));
    expect(sync.current()).toBe('typed before close');
  });

  it('a second device adopts the draft stored by the first', async () => {
    const server = fakeServer();
    server.state.content = '![a.png](attachment:t/a.png)\nhello';
    server.state.updatedAt = 4;
    const { sync, onRemote } = make(server, memoryStorage());
    await sync.refresh();
    expect(sync.current()).toBe('![a.png](attachment:t/a.png)\nhello');
    expect(onRemote).toHaveBeenCalledWith('![a.png](attachment:t/a.png)\nhello');
  });

  it('debounces typing into a single save of the latest text', async () => {
    const server = fakeServer();
    const { sync } = make(server, memoryStorage());
    sync.edit('h');
    sync.edit('he');
    sync.edit('hel');
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS - 1);
    expect(server.state.saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.state.saves).toEqual(['hel']);
  });

  it('clearing after a send is written immediately, not debounced', async () => {
    const server = fakeServer();
    const { sync } = make(server, memoryStorage());
    sync.edit('text');
    await sync.flush();
    sync.edit('');
    await vi.advanceTimersByTimeAsync(0);
    expect(server.state.saves).toEqual(['text', '']);
    expect(server.state.updatedAt).toBeNull();
  });

  it('a failed save keeps the local text and retries on the next refresh', async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const { sync } = make(server, storage);
    server.state.fail = true;
    sync.edit('important');
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(storage.data.get(KEY)).toBe('important');
    server.state.fail = false;
    await sync.refresh();
    expect(server.state.content).toBe('important');
  });

  it('a clean device follows another device clearing the draft after its send', async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const { sync, onRemote } = make(server, storage);
    sync.edit('shared');
    await sync.flush();
    server.state.content = '';
    server.state.updatedAt = null;
    await sync.refresh();
    expect(sync.current()).toBe('');
    expect(onRemote).toHaveBeenCalledWith('');
    expect(storage.data.has(KEY)).toBe(false);
  });

  it('two devices typing: unsent local edits are not clobbered and the last writer wins', async () => {
    const server = fakeServer();
    const a = make(server, memoryStorage());
    const b = make(server, memoryStorage());
    a.sync.edit('from A');
    await a.sync.flush();
    await b.sync.refresh();
    expect(b.sync.current()).toBe('from A');
    b.sync.edit('from A plus B');
    a.sync.edit('from A plus A');
    await b.sync.flush();
    await a.sync.flush();
    expect(server.state.content).toBe('from A plus A');
    await b.sync.refresh();
    expect(b.sync.current()).toBe('from A plus A');
  });

  it('a draft that predates server sync (no meta) is uploaded on first refresh', async () => {
    const server = fakeServer();
    const { sync } = make(server, memoryStorage({ [KEY]: 'legacy local draft' }));
    await sync.refresh();
    expect(server.state.content).toBe('legacy local draft');
  });

  it('typing while the server read is in flight is not overwritten by the read', async () => {
    const server = fakeServer();
    server.state.content = 'remote';
    server.state.updatedAt = 9;
    const { sync, onRemote } = make(server, memoryStorage());
    const pending = sync.refresh();
    sync.edit('typed meanwhile');
    await pending;
    expect(sync.current()).toBe('typed meanwhile');
    expect(onRemote).not.toHaveBeenCalled();
  });

  it('an edit made while a save is in flight is saved afterwards', async () => {
    const server = fakeServer();
    const { sync } = make(server, memoryStorage());
    sync.edit('one');
    const first = sync.flush();
    sync.edit('one two');
    await first;
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DEBOUNCE_MS);
    expect(server.state.saves).toEqual(['one', 'one two']);
  });

  it('dispose flushes pending edits with keepalive', () => {
    const server = fakeServer();
    const save = vi.spyOn(server.transport, 'save');
    const { sync } = make(server, memoryStorage());
    sync.edit('closing the tab');
    sync.dispose();
    expect(save).toHaveBeenCalledWith('closing the tab', { keepalive: true });
  });
});
