import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { attachment } from '../src/db/schema.js';
import { attachmentDownloadDisposition } from '../src/lib/attachment-disposition.js';
import { bootServer } from './helpers.js';

function storeAttachment(
  s: ReturnType<typeof bootServer>,
  input: { id: string; fileName: string; mimeType: string; ext: string; bytes: Buffer },
): void {
  const storageKey = `${s.team.id}/${input.id}.${input.ext}`;
  mkdirSync(join(s.attachmentsDir, s.team.id), { recursive: true });
  writeFileSync(join(s.attachmentsDir, storageKey), input.bytes);
  s.db
    .insert(attachment)
    .values({
      id: input.id,
      teamId: s.team.id,
      createdBy: s.user.id,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      storageKey,
      grantId: `${input.id}-grant`,
      scope: 'message',
      status: 'ready',
      createdAt: 1,
    })
    .run();
}

function dispositionParameters(header: string): {
  type: string;
  filename: string | null;
  extended: string | null;
} {
  const parts = header.split(';').map((part) => part.trim());
  const parameters = parts.slice(1);
  const quoted = parameters.find((part) => part.startsWith('filename="'));
  const extended = parameters.find((part) => part.startsWith("filename*=UTF-8''"));
  return {
    type: parts[0] ?? '',
    filename: quoted === undefined ? null : quoted.slice('filename="'.length, -1),
    extended:
      extended === undefined
        ? null
        : decodeURIComponent(extended.slice("filename*=UTF-8''".length)),
  };
}

test.each([
  ['report.txt', 'text/plain', 'txt', 'report.txt', 'report.txt'],
  ['quarterly report.md', 'text/markdown', 'md', 'quarterly report.md', 'quarterly report.md'],
  ['季度报告 2024.pdf', 'application/pdf', 'pdf', '季度报告 2024.pdf', '_ 2024.pdf'],
  ['다이어그램.png', 'image/png', 'png', '다이어그램.png', '_.png'],
])(
  'download=1 names the file after the stored name %s',
  async (fileName, mimeType, ext, expectedExtended, expectedAscii) => {
    const s = bootServer();
    try {
      const bytes = Buffer.from('attachment body');
      storeAttachment(s, { id: 'download-name', fileName, mimeType, ext, bytes });
      const response = await s.app.request('/api/attachments/download-name?download=1');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(mimeType);
      expect(response.headers.get('content-length')).toBe(String(bytes.length));
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
      const header = response.headers.get('content-disposition') ?? '';
      const parameters = dispositionParameters(header);
      expect(parameters.type).toBe('attachment');
      expect(parameters.filename).toBe(expectedAscii);
      expect(parameters.extended).toBe(expectedExtended);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      s.dispose();
    }
  },
);

test('download=1 cannot break out of the header', async () => {
  const s = bootServer();
  try {
    const fileName = 'evil"\r\nX-Injected: 1\\name.txt';
    storeAttachment(s, {
      id: 'download-injection',
      fileName,
      mimeType: 'text/plain',
      ext: 'txt',
      bytes: Buffer.from('x'),
    });
    const response = await s.app.request('/api/attachments/download-injection?download=1');
    expect(response.status).toBe(200);
    const header = response.headers.get('content-disposition') ?? '';
    expect(header).not.toMatch(/\p{Cc}/u);
    expect(response.headers.get('x-injected')).toBeNull();
    const parameters = dispositionParameters(header);
    expect(parameters.type).toBe('attachment');
    expect(parameters.filename).toBe('evil_X-Injected: 1_name.txt');
    expect(parameters.extended).toBe('evil"X-Injected: 1\\name.txt');
    expect(header.split(';')).toHaveLength(3);
  } finally {
    s.dispose();
  }
});

test('without the flag an image stays inline without a name', async () => {
  const s = bootServer();
  try {
    storeAttachment(s, {
      id: 'inline-image',
      fileName: '图表.png',
      mimeType: 'image/png',
      ext: 'png',
      bytes: Buffer.from('png'),
    });
    const response = await s.app.request('/api/attachments/inline-image');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('inline');
  } finally {
    s.dispose();
  }
});

test('without the flag a text file stays an unnamed attachment', async () => {
  const s = bootServer();
  try {
    storeAttachment(s, {
      id: 'unnamed-text',
      fileName: '报告.txt',
      mimeType: 'text/plain',
      ext: 'txt',
      bytes: Buffer.from('text'),
    });
    const response = await s.app.request('/api/attachments/unnamed-text');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment');
  } finally {
    s.dispose();
  }
});

test.each(['0', '', 'true', 'yes', 'download'])(
  'download=%j keeps the unnamed disposition',
  async (value) => {
    const s = bootServer();
    try {
      storeAttachment(s, {
        id: 'other-flag-image',
        fileName: 'chart.png',
        mimeType: 'image/png',
        ext: 'png',
        bytes: Buffer.from('png'),
      });
      storeAttachment(s, {
        id: 'other-flag-text',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        ext: 'txt',
        bytes: Buffer.from('text'),
      });
      const image = await s.app.request(`/api/attachments/other-flag-image?download=${value}`);
      expect(image.headers.get('content-disposition')).toBe('inline');
      const text = await s.app.request(`/api/attachments/other-flag-text?download=${value}`);
      expect(text.headers.get('content-disposition')).toBe('attachment');
    } finally {
      s.dispose();
    }
  },
);

test.each([
  [
    'resume 2024.txt',
    'attachment; filename="resume 2024.txt"; filename*=UTF-8\'\'resume%202024.txt',
  ],
  [
    "a*b(c)d'e.txt",
    "attachment; filename=\"a*b(c)d'e.txt\"; filename*=UTF-8''a%2Ab%28c%29d%27e.txt",
  ],
  ['报告.pdf', 'attachment; filename="_.pdf"; filename*=UTF-8\'\'%E6%8A%A5%E5%91%8A.pdf'],
  ['   ', 'attachment; filename="download"; filename*=UTF-8\'\'download'],
  ['\u0000\u0001', 'attachment; filename="download"; filename*=UTF-8\'\'download'],
  ['  spaced.txt  ', 'attachment; filename="spaced.txt"; filename*=UTF-8\'\'spaced.txt'],
  ['\ud800.txt', 'attachment; filename="_.txt"; filename*=UTF-8\'\'%EF%BF%BD.txt'],
])('attachmentDownloadDisposition(%j) is %s', (fileName, expected) => {
  expect(attachmentDownloadDisposition(fileName)).toBe(expected);
});
