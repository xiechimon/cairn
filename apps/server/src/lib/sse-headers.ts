import type { Context } from 'hono';
import { type SSEStreamingApi, streamSSE } from 'hono/streaming';

export function openSseStream(c: Context, run: (stream: SSEStreamingApi) => Promise<void>) {
  const res = streamSSE(c, run);
  res.headers.set('Cache-Control', 'no-cache, no-transform');
  res.headers.set('X-Accel-Buffering', 'no');
  return res;
}
