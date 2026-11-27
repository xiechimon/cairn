import assert from 'node:assert/strict';
import test from 'node:test';
import coordinatorTurnFailure from './journeys/coordinator-turn-failure.mjs';

test('coordinatorTurnFailure waits for coordinator message persistence before reloading in remote-server mode', async () => {
  const events = [];
  let persisted = false;
  let visibleAfterReload = true;
  let timer = null;

  const responseFor = (method, url, ok) => ({
    request: () => ({ method: () => method }),
    url: () => url,
    ok: () => ok,
  });

  const makeMockWindow = () => {
    let waiter = null;
    const notify = () => {
      if (!waiter || !persisted) return;
      const nonMatching = [
        responseFor('GET', 'http://127.0.0.1:4321/api/teams/t1/chief/threads', true),
        responseFor('POST', 'http://127.0.0.1:4321/api/todos', true),
        responseFor('POST', 'http://127.0.0.1:4321/api/teams/t1/chief/threads', false),
      ];
      for (const candidate of nonMatching) {
        assert.equal(
          waiter.predicate(candidate),
          false,
          `unexpected match for ${candidate.request().method()} ${candidate.url()} ok=${candidate.ok()}`,
        );
      }
      const match = responseFor('POST', 'http://127.0.0.1:4321/api/teams/t1/chief/threads', true);
      if (waiter.predicate(match)) {
        const done = waiter.resolve;
        waiter = null;
        done(match);
      }
    };

    return {
      url: () => 'http://127.0.0.1:4321/app',
      evaluate: async () => null,
      goto: async () => {},
      getByTestId: () => ({
        click: async () => {},
        first: () => ({ click: async () => {} }),
      }),
      getByText: () => ({
        first: () => ({
          waitFor: async () => {
            if (!visibleAfterReload) {
              throw new Error('optimistic message disappeared after reload before persistence');
            }
          },
        }),
      }),
      keyboard: {
        type: async () => {},
        press: async (key) => {
          assert.equal(key, 'Enter');
          timer = setTimeout(() => {
            events.push('post-resolved');
            persisted = true;
            notify();
          }, 40);
        },
      },
      waitForResponse: (predicate) =>
        new Promise((resolve) => {
          waiter = { predicate, resolve };
          notify();
        }),
      reload: async () => {
        events.push('reload-called');
        if (!persisted) visibleAfterReload = false;
      },
      screenshot: async () => {},
    };
  };

  try {
    await coordinatorTurnFailure({
      window: makeMockWindow(),
      mode: 'remote-server',
      evidenceDir: '.',
    });
    assert.deepEqual(events, ['post-resolved', 'reload-called']);
  } finally {
    if (timer) clearTimeout(timer);
  }
});
