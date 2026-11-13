import { describe, expect, test } from 'vitest';
import { isImageAttachmentKey } from '../src/detail/attachment-chip.js';
import { inlineSegments, parseChatMarkdown } from '../src/lib/markdown.js';

const KEY = 'lIH2x-iaJ8NjTCJdW-vcF/hg4lgHMHQLnQBHR3CImra.md';
const NOTICE = `[#173](todo:swkW7vZcIv5mv9rMwz_c7) 调研与方案已验收，尚未实现。
建议：点击 Markdown 附件。
[完整报告](attachment:${KEY})`;

describe('attachment citations in displayed markdown', () => {
  test('a prose attachment link becomes an attachment chip, not literal markdown', () => {
    const segments = inlineSegments(`[完整报告](attachment:${KEY})`);
    expect(segments).toEqual([{ text: '完整报告', style: 'attachment', attachmentKey: KEY }]);
    expect(segments.map((segment) => segment.text).join('')).not.toContain('attachment:');
  });

  test('a citation joined onto the previous sentence still becomes a chip', () => {
    const blocks = parseChatMarkdown(NOTICE);
    const attachments = blocks.flatMap((block) =>
      block.kind === 'para'
        ? block.segments.filter((segment) => segment.style === 'attachment')
        : [],
    );
    expect(attachments).toEqual([{ text: '完整报告', style: 'attachment', attachmentKey: KEY }]);
    const mentions = blocks.flatMap((block) =>
      block.kind === 'para' ? block.segments.filter((segment) => segment.style === 'mention') : [],
    );
    expect(mentions).toEqual([
      {
        text: '#173',
        style: 'mention',
        mentionKind: 'todo',
        mentionId: 'swkW7vZcIv5mv9rMwz_c7',
      },
    ]);
  });

  test('an inline image token drops the bang and keeps the caption', () => {
    expect(inlineSegments('见图 ![截图](attachment:team-1/shot.png) 这里')).toEqual([
      { text: '见图 ' },
      { text: '截图', style: 'attachment', attachmentKey: 'team-1/shot.png' },
      { text: ' 这里' },
    ]);
  });

  test('only inline-served image types open a preview', () => {
    expect(isImageAttachmentKey('team-1/shot.png')).toBe(true);
    expect(isImageAttachmentKey('team-1/shot.avif')).toBe(false);
    expect(isImageAttachmentKey('team-1/icon.svg')).toBe(false);
    expect(isImageAttachmentKey('team-1/icon.bmp')).toBe(false);
    expect(isImageAttachmentKey('team-1/icon.ico')).toBe(false);
  });

  test('an empty image label falls back to the file name', () => {
    expect(inlineSegments('见图 ![](attachment:team-1/shot.png) 这里')).toEqual([
      { text: '见图 ' },
      { text: 'shot.png', style: 'attachment', attachmentKey: 'team-1/shot.png' },
      { text: ' 这里' },
    ]);
  });

  test('an invalid attachment key stays literal', () => {
    const raw = '[报告](attachment:not a key)';
    expect(inlineSegments(raw).map((segment) => segment.text).join('')).toBe(raw);
  });

  test('javascript: and a citation inside code stay literal', () => {
    expect(
      inlineSegments('[click](javascript:alert(1))').some(
        (segment) => segment.style === 'attachment',
      ),
    ).toBe(false);
    const coded = `[完整报告](attachment:${KEY})`;
    expect(inlineSegments('`' + coded + '`')).toEqual([{ text: coded, style: 'code' }]);
  });

  test('a fenced citation is not parsed as a chip', () => {
    const blocks = parseChatMarkdown('```\n[完整报告](attachment:' + KEY + ')\n```');
    expect(blocks).toEqual([{ kind: 'code', text: `[完整报告](attachment:${KEY})` }]);
  });
});
