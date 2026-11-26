// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/runtime/exports.ts
import { randomId } from '../lib/random-id.js';
export interface PreviewSnapshot {
  dataUrl: string;
  w: number;
  h: number;
}

export type PreviewSnapshotResult =
  | { ok: true; snapshot: PreviewSnapshot }
  | { ok: false; reason: 'loading' | 'post-message-error' | 'render-error' | 'timeout' };

export function requestPreviewSnapshot(
  iframe: HTMLIFrameElement,
  options: { full?: boolean; timeout?: number } = {},
): Promise<PreviewSnapshotResult> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve({ ok: false, reason: 'loading' });
  const id = `snap-${randomId()}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: PreviewSnapshotResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(result);
    };
    function onMessage(event: MessageEvent) {
      if (event.source !== win) return;
      const data = event.data as {
        type?: unknown;
        id?: unknown;
        dataUrl?: unknown;
        w?: unknown;
        h?: unknown;
      } | null;
      if (data?.type !== 'od:snapshot:result' || data.id !== id) return;
      if (
        typeof data.dataUrl === 'string' &&
        data.dataUrl.startsWith('data:image/png;base64,') &&
        typeof data.w === 'number' &&
        typeof data.h === 'number' &&
        data.w > 0 &&
        data.h > 0
      )
        finish({ ok: true, snapshot: { dataUrl: data.dataUrl, w: data.w, h: data.h } });
      else finish({ ok: false, reason: 'render-error' });
    }
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(
      () => finish({ ok: false, reason: 'timeout' }),
      options.timeout ?? 8000,
    );
    try {
      win.postMessage({ type: 'od:snapshot', id, ...(options.full ? { full: true } : {}) }, '*');
    } catch {
      finish({ ok: false, reason: 'post-message-error' });
    }
  });
}
