import {
  DELIVERABLE_LIMITS,
  PAGE_CAPTURE_REQUEST,
  PAGE_CAPTURE_SIZE,
  PAGE_PREVIEW_CSP,
} from '@cairn/shared';
import type { BrowserWindow as ElectronBrowserWindow, NativeImage, Session } from 'electron';
import type { CaptureSurface } from './page-capture.js';

const CAPTURE_PARTITION = 'cairn-page-capture';
const CAPTURE_SCHEME = 'cairn-page-capture';
const JPEG_QUALITY = 80;

export function pageCaptureRequestOf(data: unknown): { id: string; html: string } | null {
  if (data === null || typeof data !== 'object') return null;
  const { type, id, html } = data as { type?: unknown; id?: unknown; html?: unknown };
  if (type !== PAGE_CAPTURE_REQUEST || typeof id !== 'string' || typeof html !== 'string') {
    return null;
  }
  if (id.length === 0 || id.length > 64) return null;
  if (Buffer.byteLength(html, 'utf8') > DELIVERABLE_LIMITS.maxPageBytes) return null;
  return { id, html };
}

interface CaptureElectron {
  BrowserWindow: typeof ElectronBrowserWindow;
  session: { fromPartition(partition: string): Session };
}

export function offscreenCaptureSurfaces(electron: CaptureElectron): () => CaptureSurface {
  const pages = new Map<string, string>();
  let captureSession: Session | null = null;
  const sessionOf = (): Session => {
    if (captureSession !== null) return captureSession;
    const ses = electron.session.fromPartition(CAPTURE_PARTITION);
    ses.setPermissionRequestHandler((_contents, _permission, decide) => decide(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, decide) =>
      decide({ cancel: !details.url.startsWith(`${CAPTURE_SCHEME}:`) }),
    );
    ses.protocol.handle(CAPTURE_SCHEME, (request) => {
      const html = pages.get(new URL(request.url).pathname);
      if (html === undefined) return new Response(null, { status: 404 });
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': PAGE_PREVIEW_CSP,
        },
      });
    });
    captureSession = ses;
    return ses;
  };
  let serial = 0;
  return () => {
    serial += 1;
    const key = `page-${serial}`;
    const window = new electron.BrowserWindow({
      ...PAGE_CAPTURE_SIZE,
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        javascript: false,
        contextIsolation: true,
        nodeIntegration: false,
        webgl: false,
        spellcheck: false,
        disableDialogs: true,
        navigateOnDragDrop: false,
        session: sessionOf(),
      },
    });
    const contents = window.webContents;
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    return {
      async load(html) {
        pages.set(key, html);
        await contents.loadURL(`${CAPTURE_SCHEME}:${key}`);
      },
      nextFrame: () =>
        new Promise((resolve) => {
          const onPaint = (_event: unknown, _dirty: unknown, image: NativeImage) => {
            if (image.isEmpty()) {
              contents.invalidate();
              return;
            }
            contents.off('paint', onPaint);
            resolve(image.toJPEG(JPEG_QUALITY));
          };
          contents.on('paint', onPaint);
          contents.invalidate();
        }),
      destroy() {
        pages.delete(key);
        if (!window.isDestroyed()) window.destroy();
      },
    };
  };
}
