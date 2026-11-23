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

  it('size = 0 passes the local preflight and asks for a grant', async () => {
    const fetchMock = stubFetch();
    await attachFile({ file: pngFile(0), scope: 'spec' }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('extension outside the allowlist (.exe) = rejected (reason=mime, zero fetch calls)', async () => {
    const fetchMock = stubFetch();
    const exe = new File([new Uint8Array(10)], 'a.exe', { type: 'application/x-msdownload' });
    const err = await attachFile({ file: exe, scope: 'message' }).catch((e) => e);
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

describe('attachFile session recovery', () => {
  const grantPath = '/api/uploads/grant';
  const uploadPath = '/api/uploads/upload';
  const probePath = '/api/auth/session';

  it.each([
    { outcome: 'the session is confirmed', verdict: 204, retryStatus: 201, error: null },
    { outcome: 'the session is signed out', verdict: 401, retryStatus: null, error: 'session expired' },
    { outcome: 'the retry is unauthorized', verdict: 204, retryStatus: 401, error: 'grant rejected' },
  ])('recovers a multipart upload 401 when $outcome', async ({ verdict, retryStatus, error }) => {
    vi.stubGlobal('window', { location: new URL('http://localhost/app') });
    const file = pngFile(64);
    let uploads = 0;
    let probes = 0;
    const fetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === grantPath) {
        return Response.json({
          uploadUrl: '/api/uploads',
          grant: 'fixture-grant',
          key: 'team-1/att-9.png',
          attachmentId: 'att-9',
        });
      }
      if (path === probePath) return new Response(null, { status: ++probes === 1 ? verdict : 401 });
      if (path === uploadPath) {
        if (++uploads === 1) return new Response('session expired', { status: 401 });
        return new Response('grant rejected', { status: retryStatus ?? 500 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = attachFile({ file, scope: 'message' });
    if (error === null) await expect(result).resolves.toMatchObject({ attachmentId: 'att-9' });
    else {
      await expect(result).rejects.toMatchObject({
        reason: 'upload',
        message: `upload failed: 401 ${error}`,
      });
    }
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      grantPath,
      uploadPath,
      probePath,
      ...(retryStatus === null ? [] : [uploadPath]),
      ...(retryStatus === 401 ? [probePath] : []),
    ]);
    for (const [, init] of fetchMock.mock.calls.filter(([path]) => path === uploadPath)) {
      expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
      expect(new Headers(init?.headers).has('content-type')).toBe(false);
      const form = init?.body;
      expect(form).toBeInstanceOf(FormData);
      if (!(form instanceof FormData)) throw new Error('Expected a multipart upload');
      expect(form.get('grant')).toBe('fixture-grant');
      const sentFile = form.get('file');
      expect(sentFile).toMatchObject({ name: file.name, type: file.type });
      expect(sentFile).toBeInstanceOf(File);
      if (!(sentFile instanceof File)) throw new Error('Expected a multipart file');
      expect(await sentFile.arrayBuffer()).toEqual(await file.arrayBuffer());
    }
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
