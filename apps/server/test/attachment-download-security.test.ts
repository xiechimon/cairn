import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { attachment } from '../src/db/schema.js';
import { bootServer } from './helpers.js';

test.each([
  ['image/png', 'png', true],
  ['image/jpeg', 'jpg', true],
  ['image/gif', 'gif', true],
  ['image/webp', 'webp', true],
  ['application/pdf', 'pdf', true],
  ['image/svg+xml', 'svg', false],
  ['text/html', 'html', false],
  ['application/xml', 'xml', false],
  ['text/plain', 'txt', false],
  ['image/bmp', 'bmp', false],
  ['image/x-icon', 'ico', false],
  ['image/avif', 'avif', false],
  ['application/octet-stream', 'bin', false],
] as const)(
  'downloads %s with isolation headers and safe disposition',
  async (mimeType, ext, inline) => {
    const s = bootServer();
    try {
      const bytes = Buffer.from('<svg><script>alert(document.domain)</script></svg>');
      const storageKey = `${s.team.id}/security-download.${ext}`;
      mkdirSync(join(s.attachmentsDir, s.team.id), { recursive: true });
      writeFileSync(join(s.attachmentsDir, storageKey), bytes);
      s.db
        .insert(attachment)
        .values({
          id: 'security-download',
          teamId: s.team.id,
          createdBy: s.user.id,
          fileName: `download.${ext}`,
          mimeType,
          sizeBytes: bytes.length,
          storageKey,
          grantId: 'security-grant',
          scope: 'message',
          status: 'ready',
          createdAt: 1,
        })
        .run();
      const response = await s.app.request('/api/attachments/security-download');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(mimeType);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
      if (inline) {
        expect(response.headers.get('content-disposition')).not.toMatch(/^attachment(?:;|$)/);
      } else {
        expect(response.headers.get('content-disposition')).toMatch(/^attachment(?:;|$)/);
      }
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      s.dispose();
    }
  },
);
