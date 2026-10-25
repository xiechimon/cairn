import { describe, expect, test } from 'vitest';
import {
  ATTACHMENT_TOKEN_LINE,
  formatAttachmentToken,
  IMAGE_ATTACHMENT_EXTS,
  INLINE_IMAGE_EXTS,
  INLINE_IMAGE_MIME_BY_EXT,
  isImageAttachmentExt,
  parseAttachmentTokenLines,
  renderAttachmentTokensToLabels,
} from '../src/attachment-token.js';

const KEY = 'team_abc/att_xyz123.png';

describe('attachment token contract (#730)', () => {
  test('failure mode 1: web write-side token round-trip -- written is parsed (label/key/ext field by field)', () => {
    const token = formatAttachmentToken('screenshot.png', KEY);
    const refs = parseAttachmentTokenLines(`title\n\n${token}`);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      label: 'screenshot.png',
      key: KEY,
      attachmentId: 'att_xyz123',
      ext: 'png',
    });
  });

  test('failure mode 1: multi-line text with multiple tokens -- parsed line by line, order preserved', () => {
    const text = [
      '标题行',
      '',
      formatAttachmentToken('a.png', 't1/id1.png'),
      '中间普通行',
      formatAttachmentToken('b.jpg', 't1/id2.jpg'),
    ].join('\n');
    const refs = parseAttachmentTokenLines(text);
    expect(refs.map((r) => r.attachmentId)).toEqual(['id1', 'id2']);
    expect(refs[0]?.line).toBe('![a.png](attachment:t1/id1.png)');
  });

  test('failure mode 3: inline form not parsed (mid-sentence / inside code fences), known limitation on record', () => {
    const inline = `看这行 ![x](attachment:${KEY}) 里的图`;
    expect(parseAttachmentTokenLines(inline)).toHaveLength(0);
    const fenced = '```\n![x](attachment:t1/id1.png)\n```';
    expect(parseAttachmentTokenLines(fenced)).toHaveLength(1);
  });

  test('failure mode 3: leading whitespace up to 3 spaces still counts as a whole line (same rule as ATTACHMENT_LINE)', () => {
    expect(parseAttachmentTokenLines('   ![x](attachment:t1/id1.png)')).toHaveLength(1);
    expect(parseAttachmentTokenLines('    ![x](attachment:t1/id1.png)')).toHaveLength(0);
  });

  test('failure mode 2: path-traversal keys never parsed -- ../, absolute paths, multi-segment slashes, empty segments', () => {
    const bad = [
      't1/../id1.png',
      '/etc/passwd.png',
      't1/a/b/id1.png',
      't1//id1.png',
      't1/id1.png/x',
      '../id1.png',
    ];
    for (const key of bad) {
      const text = `![x](attachment:${key})`;
      expect(parseAttachmentTokenLines(text), `key=${key}`).toHaveLength(0);
    }
  });

  test('failure mode 2: key segment charset pinned (recordId alphabet + lowercase extension)', () => {
    expect(parseAttachmentTokenLines('![x](attachment:t1/id-XYZ_9.png)')).toHaveLength(1);
    expect(parseAttachmentTokenLines('![x](attachment:t1/id1.PNG)')).toHaveLength(0);
    expect(parseAttachmentTokenLines('![x](attachment:t1/id1.toolongext)')).toHaveLength(0);
    expect(parseAttachmentTokenLines('![x](attachment:t1/id1!.png)')).toHaveLength(0);
  });

  test('failure mode 4: image ext vocabulary single source -- inline surface + asset-surface classification', () => {
    expect(INLINE_IMAGE_EXTS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp']);
    expect([...IMAGE_ATTACHMENT_EXTS].sort()).toEqual(
      ['avif', 'bmp', 'gif', 'ico', 'jpg', 'jpeg', 'png', 'svg', 'webp'].sort(),
    );
    expect(isImageAttachmentExt('png')).toBe(true);
    expect(isImageAttachmentExt('svg')).toBe(true);
    expect(isImageAttachmentExt('md')).toBe(false);
    expect(isImageAttachmentExt('pdf')).toBe(false);
  });

  test('failure mode 4: ext -> inline mime mapping (jpg normalized to image/jpeg)', () => {
    expect(INLINE_IMAGE_MIME_BY_EXT.png).toBe('image/png');
    expect(INLINE_IMAGE_MIME_BY_EXT.jpg).toBe('image/jpeg');
    expect(INLINE_IMAGE_MIME_BY_EXT.jpeg).toBe('image/jpeg');
    expect(INLINE_IMAGE_MIME_BY_EXT.gif).toBe('image/gif');
    expect(INLINE_IMAGE_MIME_BY_EXT.webp).toBe('image/webp');
    expect(INLINE_IMAGE_MIME_BY_EXT.svg).toBeUndefined();
    expect(INLINE_IMAGE_MIME_BY_EXT.bmp).toBeUndefined();
  });

  test('failure mode 1: ATTACHMENT_TOKEN_LINE row regex consistent with batch parsing', () => {
    const line = '![x](attachment:t1/id1.png)';
    expect(ATTACHMENT_TOKEN_LINE.test(line)).toBe(true);
    expect(ATTACHMENT_TOKEN_LINE.test(`prefix ${line}`)).toBe(false);
  });
});

describe('renderAttachmentTokensToLabels (#757 title surface: bare token -> chip name)', () => {
  test('inline tokens replaced with file names, other text untouched', () => {
    expect(renderAttachmentTokensToLabels('看这个 ![a.png](attachment:t/i.png) 很重要')).toBe(
      '看这个 a.png 很重要',
    );
  });

  test('text without tokens unchanged verbatim', () => {
    expect(renderAttachmentTokensToLabels('修复登录')).toBe('修复登录');
  });

  test('empty label falls back to empty string (caller skips the empty line)', () => {
    expect(renderAttachmentTokensToLabels('![](attachment:t/i.png)')).toBe('');
  });
});
