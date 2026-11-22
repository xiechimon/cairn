import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { attachmentExtOf, PAGE_CAPTURE_REQUEST, PAGE_CAPTURE_RESULT } from '@cairn/shared';
import { thumbnailKeyOf } from './attachment-gc.js';
import { containedAttachmentPath, writeAttachmentFile } from './attachments.js';

export const PAGE_CAPTURE_REPLY_MS = 15_000;
const THUMBNAIL_MAX_BYTES = 1024 * 1024;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export type CapturePage = (html: string) => Promise<Buffer | null>;

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: { data: unknown }) => void): void;
}

export function parentPortOf(proc: NodeJS.Process): ParentPort | undefined {
  return (proc as unknown as { parentPort?: ParentPort }).parentPort;
}

export function capturePageOver(port: ParentPort, replyMs = PAGE_CAPTURE_REPLY_MS): CapturePage {
  const waiting = new Map<string, (image: Buffer | null) => void>();
  port.on('message', ({ data }) => {
    if (data === null || typeof data !== 'object') return;
    const { type, id, image } = data as { type?: unknown; id?: unknown; image?: unknown };
    if (type !== PAGE_CAPTURE_RESULT || typeof id !== 'string') return;
    const settle = waiting.get(id);
    if (settle === undefined) return;
    settle(image instanceof Uint8Array ? Buffer.from(image) : null);
  });
  return (html) =>
    new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => settle(null), replyMs);
      const settle = (image: Buffer | null) => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(image);
      };
      waiting.set(id, settle);
      port.postMessage({ type: PAGE_CAPTURE_REQUEST, id, html });
    });
}

export interface ThumbnailSource {
  id: string;
  teamId: string;
  storageKey: string;
  scope: string;
  status: string;
}

function isJpeg(image: Buffer): boolean {
  return (
    image.length <= THUMBNAIL_MAX_BYTES && image.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)
  );
}

export interface PageThumbnails {
  thumbnail(row: ThumbnailSource): Promise<Buffer | null>;
}

export function createPageThumbnails(deps: {
  attachmentsDir: string;
  capture: CapturePage | undefined;
}): PageThumbnails {
  const inFlight = new Map<string, Promise<Buffer | null>>();
  const failed = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  const captureAndStore = async (row: ThumbnailSource, capture: CapturePage) => {
    const html = readFileSync(containedAttachmentPath(deps.attachmentsDir, row.storageKey), 'utf8');
    const image = await capture(html);
    if (image === null || !isJpeg(image)) {
      failed.add(row.id);
      return null;
    }
    writeAttachmentFile(deps.attachmentsDir, thumbnailKeyOf(row), image);
    return image;
  };

  return {
    async thumbnail(row) {
      if (row.scope !== 'deliverable' || row.status !== 'ready') return null;
      if (attachmentExtOf(row.storageKey) !== 'html') return null;
      const path = containedAttachmentPath(deps.attachmentsDir, thumbnailKeyOf(row));
      if (existsSync(path)) return readFileSync(path);
      const capture = deps.capture;
      if (capture === undefined || failed.has(row.id)) return null;
      const running = inFlight.get(row.id);
      if (running !== undefined) return running;
      const next = queue.then(() => captureAndStore(row, capture));
      const settled = next.catch(() => {
        failed.add(row.id);
        return null;
      });
      queue = settled;
      inFlight.set(row.id, settled);
      void settled.finally(() => inFlight.delete(row.id));
      return settled;
    },
  };
}
