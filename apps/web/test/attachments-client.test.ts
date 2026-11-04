import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentError, attachFile } from '../src/api/attachments.js';
import { attachmentFailureTitle } from '../src/overlay/attachment-paste.js';

const MAX = 10 * 1024 * 1024;

function pngFile(size: number, name = 'a.png'): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

function stubFetch(grantOk = true, uploadOk = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/grant')) {
      return grantOk
        ? new Response(
            JSON.stringify({
              uploadUrl: '/api/uploads',
              grant: 'g-1',
              key: 'team-1/att-9.png',
              attachmentId: 'att-9',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response('bad grant', { status: 400 });
    }
    return uploadOk ? new Response('{}', { status: 200 }) : new Response('boom', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attachFile local preflight (FM5: rejected means no request sent)', () => {
  it('size exactly 10MiB = passes (goes through grant+upload, returns a token)', async () => {
    const fetchMock = stubFetch();
    const r = await attachFile({ file: pngFile(MAX), scope: 'message' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.token).toBe('![a.png](attachment:team-1/att-9.png)');
    expect(r.attachmentId).toBe('att-9');
    expect(r.key).toBe('team-1/att-9.png');
  });

  it('size = 10MiB + 1 = rejected (reason=size, zero fetch calls)', async () => {
    const fetchMock = stubFetch();
    const err = await attachFile({ file: pngFile(MAX + 1), scope: 'message' }).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentError);
    expect((err as AttachmentError).reason).toBe('size');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('size = 0 = rejected (reason=size)', async () => {
    const fetchMock = stubFetch();
    const err = await attachFile({ file: pngFile(0), scope: 'spec' }).catch((e) => e);
    expect((err as AttachmentError).reason).toBe('size');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mime outside the whitelist (application/zip) = rejected (reason=mime, zero fetch calls)', async () => {
    const fetchMock = stubFetch();
    const zip = new File([new Uint8Array(10)], 'a.zip', { type: 'application/zip' });
    const err = await attachFile({ file: zip, scope: 'message' }).catch((e) => e);
    expect((err as AttachmentError).reason).toBe('mime');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('filename with path traversal = rejected (reason=invalid-name)', async () => {
    const fetchMock = stubFetch();
    const bad = new File([new Uint8Array(10)], '../a.png', { type: 'image/png' });
    const err = await attachFile({ file: bad, scope: 'message' }).catch((e) => e);
    expect((err as AttachmentError).reason).toBe('invalid-name');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('attachFile network failure classification (FM12)', () => {
  it('grant 400 → reason=grant, upload not attempted', async () => {
    const fetchMock = stubFetch(false, true);
    const err = await attachFile({ file: pngFile(64), scope: 'message' }).catch((e) => e);
    expect((err as AttachmentError).reason).toBe('grant');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('upload 500 → reason=upload', async () => {
    const fetchMock = stubFetch(true, false);
    const err = await attachFile({ file: pngFile(64), scope: 'message' }).catch((e) => e);
    expect((err as AttachmentError).reason).toBe('upload');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('attachmentFailureTitle — toast copy mapping (zh keys = en dictionary keys)', () => {
  it('size → size-limit copy', () => {
    expect(attachmentFailureTitle(new AttachmentError('size', 'x'))).toBe('附件超过 10MB 上限');
  });

  it('mime → unsupported-type copy', () => {
    expect(attachmentFailureTitle(new AttachmentError('mime', 'x'))).toBe('不支持该文件类型');
  });

  it('grant / upload / invalid-name → upload-failure copy', () => {
    expect(attachmentFailureTitle(new AttachmentError('grant', 'x'))).toBe('附件上传失败');
    expect(attachmentFailureTitle(new AttachmentError('upload', 'x'))).toBe('附件上传失败');
    expect(attachmentFailureTitle(new AttachmentError('invalid-name', 'x'))).toBe('附件上传失败');
  });

  it('non-AttachmentError (unknown exception) → upload-failure copy, not swallowed, does not crash', () => {
    expect(attachmentFailureTitle(new Error('network down'))).toBe('附件上传失败');
    expect(attachmentFailureTitle(undefined)).toBe('附件上传失败');
  });
});
