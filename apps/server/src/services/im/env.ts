import type { ImEnv } from './types.js';

function socketText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return null;
}

export const liveImEnv: ImEnv = {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  connectSocket: (url, handlers) => {
    const ws = new WebSocket(url);
    ws.onopen = () => handlers.onOpen?.();
    ws.onmessage = (event) => {
      const text = socketText(event.data);
      if (text !== null) handlers.onMessage(text);
    };
    ws.onclose = (event) => handlers.onClose(event.code, event.reason);
    ws.onerror = () => handlers.onError?.();
    return {
      send: (text) => ws.send(text),
      close: () => ws.close(),
    };
  },
};
