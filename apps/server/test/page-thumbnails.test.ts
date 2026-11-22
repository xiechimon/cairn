import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_CAPTURE_REQUEST, PAGE_CAPTURE_RESULT } from '@cairn/shared';
import { expect, test } from 'vitest';
import { attachment } from '../src/db/schema.js';
import { sweepAttachments } from '../src/services/attachment-gc.js';
import { capturePageOver } from '../src/services/page-thumbnails.js';
import { bootServer } from './helpers.js';

const PAGE = '<h1>Costly benchmark</h1>';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function seedPage(s: ReturnType<typeof bootServer>, id = 'page-1') {
  const storageKey = `${s.team.id}/${id}.html`;
  mkdirSync(join(s.attachmentsDir, s.team.id), { recursive: true });
  writeFileSync(join(s.attachmentsDir, storageKey), PAGE);
  s.db
    .insert(attachment)
    .values({
      id,
      teamId: s.team.id,
      createdBy: s.user.id,
      fileName: 'costly.html',
      mimeType: 'text/html',
      sizeBytes: PAGE.length,
      storageKey,
      grantId: 'deliverable:step:1',
      scope: 'deliverable',
      status: 'ready',
      createdAt: 1,
    })
    .run();
  return id;
}

test('a published page is captured once by the desktop app and every later view gets the stored image', async () => {
  const captured: string[] = [];
  const s = bootServer({
    capturePage: async (html) => {
      captured.push(html);
      return JPEG;
    },
  });
  try {
    const id = seedPage(s);
    const [first, second] = await Promise.all([
      s.app.request(`/api/attachments/${id}/thumbnail`),
      s.app.request(`/api/attachments/${id}/thumbnail`),
    ]);
    const third = await s.app.request(`/api/attachments/${id}/thumbnail`);
    for (const response of [first, second, third]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);
    }
    expect(captured).toEqual([PAGE]);
  } finally {
    s.dispose();
  }
});

test('without the desktop app there is no thumbnail, so the card falls back to text', async () => {
  const s = bootServer();
  try {
    const response = await s.app.request(`/api/attachments/${seedPage(s)}/thumbnail`);
    expect(response.status).toBe(404);
  } finally {
    s.dispose();
  }
});

test('a desktop app that never answers fails the capture at the reply deadline and is not asked again', async () => {
  const port = Object.assign(new EventEmitter(), { sent: [] as unknown[] });
  const portLike = {
    postMessage: (message: unknown) => port.sent.push(message),
    on: (event: 'message', listener: (message: { data: unknown }) => void) =>
      port.on(event, listener),
  };
  const s = bootServer({ capturePage: capturePageOver(portLike, 30) });
  try {
    const id = seedPage(s);
    expect((await s.app.request(`/api/attachments/${id}/thumbnail`)).status).toBe(404);
    expect((await s.app.request(`/api/attachments/${id}/thumbnail`)).status).toBe(404);
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toMatchObject({ type: PAGE_CAPTURE_REQUEST, html: PAGE });
    port.emit('message', {
      data: { type: PAGE_CAPTURE_RESULT, id: (port.sent[0] as { id: string }).id, image: JPEG },
    });
    expect((await s.app.request(`/api/attachments/${id}/thumbnail`)).status).toBe(404);
  } finally {
    s.dispose();
  }
});

test('reaping a page attachment removes its stored thumbnail', async () => {
  const s = bootServer({ capturePage: async () => JPEG });
  try {
    const id = seedPage(s);
    expect((await s.app.request(`/api/attachments/${id}/thumbnail`)).status).toBe(200);
    const thumb = join(s.attachmentsDir, s.team.id, `${id}.thumb.jpg`);
    expect(existsSync(thumb)).toBe(true);
    s.db.update(attachment).set({ status: 'failed' }).run();
    sweepAttachments(
      { db: s.db, attachmentsDir: s.attachmentsDir, logger: { info: () => {}, debug: () => {} } },
      Date.now() + 2 * 24 * 60 * 60 * 1000,
    );
    expect(existsSync(thumb)).toBe(false);
  } finally {
    s.dispose();
  }
});
