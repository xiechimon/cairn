import { expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 10 * 1024 * 1024;

async function grantRaw(s: TestServer, fileName: string, mimeType: string, size: number) {
  return req(s.app, 'POST', '/api/uploads/grant', { kind: 'attachment', fileName, mimeType, size });
}

async function uploadRaw(
  s: TestServer,
  fileName: string,
  grantMime: string,
  uploadMime: string,
  bytes: Uint8Array,
): Promise<Response> {
  const grantRes = await grantRaw(s, fileName, grantMime, bytes.byteLength);
  expect(grantRes.status).toBe(200);
  const g = (await grantRes.json()) as { uploadUrl: string; grant: string; key: string };
  const form = new FormData();
  form.set('grant', g.grant);
  form.set('file', new Blob([new Uint8Array(bytes)], { type: uploadMime }), fileName);
  const res = await s.app.request(`${g.uploadUrl}/upload`, { method: 'POST', body: form });
  if (res.status !== 201) return res;
  const out = (await res.json()) as { id: string };
  return s.app.request(`/api/attachments/${out.id}`);
}

test('grant accepts a 0-byte file and upload plus download round-trip an empty body', async () => {
  const s = bootServer();
  try {
    const res = await uploadRaw(s, 'empty.txt', 'text/plain', 'text/plain', new Uint8Array(0));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
  } finally {
    s.dispose();
  }
});

test('grant rejects a negative size', async () => {
  const s = bootServer();
  try {
    expect((await grantRaw(s, 'x.txt', 'text/plain', -1)).status).toBe(400);
  } finally {
    s.dispose();
  }
});

test.each([
  ['xlsx declared with its MIME', 'sheet.xlsx', XLSX, XLSX],
  ['xlsx declared with an empty MIME', 'sheet.xlsx', '', ''],
  ['docx with octet-stream', 'a.docx', 'application/octet-stream', 'application/octet-stream'],
  [
    'csv declared as an Excel type',
    'a.csv',
    'application/vnd.ms-excel',
    'application/vnd.ms-excel',
  ],
  ['zip', 'a.zip', 'application/zip', 'application/zip'],
])(
  '%s is accepted and served as an attachment with nosniff',
  async (_label, name, grantMime, uploadMime) => {
    const s = bootServer();
    try {
      const res = await uploadRaw(s, name, grantMime, uploadMime, new Uint8Array([80, 75, 3, 4]));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
      expect(res.headers.get('content-type')).not.toMatch(/text\/html|svg/);
    } finally {
      s.dispose();
    }
  },
);

test.each([
  ['page.html', 'text/html'],
  ['pic.svg', 'image/svg+xml'],
  ['spoof.txt', 'text/html'],
  ['spoof.xlsx', 'text/html'],
  ['script.js', 'text/javascript'],
])('%s declared %s is never served inline or as active content', async (name, mime) => {
  const s = bootServer();
  try {
    const res = await uploadRaw(
      s,
      name,
      mime,
      mime,
      new TextEncoder().encode('<script>1</script>'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-type')).not.toBe('text/html; charset=utf-8');
  } finally {
    s.dispose();
  }
});

test('an html-declared txt is stored and served as plain text', async () => {
  const s = bootServer();
  try {
    const res = await uploadRaw(s, 'spoof.txt', 'text/html', 'text/html', new Uint8Array([60]));
    expect(res.headers.get('content-type')).toBe('text/plain');
  } finally {
    s.dispose();
  }
});

test.each(['tool.exe', 'lib.dll', 'noext', 'macro.xlsm', 'data.bin'])(
  '%s is rejected at grant',
  async (name) => {
    const s = bootServer();
    try {
      expect((await grantRaw(s, name, 'application/octet-stream', 1)).status).toBe(400);
    } finally {
      s.dispose();
    }
  },
);

test('oversize is still rejected at grant', async () => {
  const s = bootServer();
  try {
    expect((await grantRaw(s, 'big.xlsx', XLSX, MAX_BYTES + 1)).status).toBe(400);
    expect((await grantRaw(s, 'ok.xlsx', XLSX, MAX_BYTES)).status).toBe(200);
  } finally {
    s.dispose();
  }
});

test('upload with a different extension than the grant is still rejected', async () => {
  const s = bootServer();
  try {
    const g = (await (await grantRaw(s, 'a.xlsx', XLSX, 1)).json()) as {
      uploadUrl: string;
      grant: string;
    };
    const form = new FormData();
    form.set('grant', g.grant);
    form.set('file', new Blob([new Uint8Array([1])], { type: XLSX }), 'a.zip');
    const res = await s.app.request(`${g.uploadUrl}/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(409);
  } finally {
    s.dispose();
  }
});
