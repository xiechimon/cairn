// 附件 token 解析契约（#730）：web 写侧（api/attachments.ts `![name](attachment:<key>)`）
// 与 daemon 读侧的单源对拍。失败方式先于实现固化：
//   1. token 形漂移——web 写出的 token daemon 解不出（或反之）→ 图片静默不交付；
//      契约测试钉住 round-trip。
//   2. 路径穿越——key 含 `../`/绝对路径/多段斜杠 → daemon 拼 materialize 路径时逃逸；
//      key 语法钉死为 `<teamId>/<id>.<ext>`（[A-Za-z0-9_-] 段）。
//   3. 展开破坏原文——行内代码/表格里的 token 被误展开；只认**整行**形态
//      （ATTACHMENT_LINE 同纪律），行内形态原样保留（已知限制）。
//   4. 分类漂移——inline 支持面（png/jpeg/gif/webp）与素材化面（svg/bmp/ico/avif）
//      词表分裂；词表单源在此。

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

describe('attachment token 契约（#730）', () => {
  test('失败方式 1：web 写侧 token round-trip——写出即解析（label/key/ext 逐字段）', () => {
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

  test('失败方式 1：多行文本多 token——逐行解析，行序保持', () => {
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

  test('失败方式 3：行内形态不解析（句中/代码 fence 内），已知限制记录在案', () => {
    const inline = `看这行 ![x](attachment:${KEY}) 里的图`;
    expect(parseAttachmentTokenLines(inline)).toHaveLength(0);
    const fenced = '```\n![x](attachment:t1/id1.png)\n```';
    // fence 内的整行 token 形态上无法与普通整行区分——按整行形态展开（已知
    // 限制：fence 展开会破坏代码块原文；本票裁决 = 整行形态即展开，行内不展开）。
    expect(parseAttachmentTokenLines(fenced)).toHaveLength(1);
  });

  test('失败方式 3：前导空白 ≤3 空格仍算整行（ATTACHMENT_LINE 同纪律）', () => {
    expect(parseAttachmentTokenLines('   ![x](attachment:t1/id1.png)')).toHaveLength(1);
    expect(parseAttachmentTokenLines('    ![x](attachment:t1/id1.png)')).toHaveLength(0); // 4 空格 = 代码块
  });

  test('失败方式 2：路径穿越 key 一律不解析——../、绝对路径、多段斜杠、空段', () => {
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

  test('失败方式 2：key 段字符集钉死（recordId 字母表 + 小写扩展名）', () => {
    // 合法：21 段 recordId 字母表 + 小写字母数字 ext
    expect(parseAttachmentTokenLines('![x](attachment:t1/id-XYZ_9.png)')).toHaveLength(1);
    // 非法：ext 含非 [a-z0-9]、ext 超 8 字符、id 含字母表外字符
    expect(parseAttachmentTokenLines('![x](attachment:t1/id1.PNG)')).toHaveLength(0);
    expect(parseAttachmentTokenLines('![x](attachment:t1/id1.toolongext)')).toHaveLength(0);
    expect(parseAttachmentTokenLines('![x](attachment:t1/id1!.png)')).toHaveLength(0);
  });

  test('失败方式 4：图片 ext 词表单源——inline 面 + 素材化面分类', () => {
    expect(INLINE_IMAGE_EXTS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp']);
    expect([...IMAGE_ATTACHMENT_EXTS].sort()).toEqual(
      ['avif', 'bmp', 'gif', 'ico', 'jpg', 'jpeg', 'png', 'svg', 'webp'].sort(),
    );
    expect(isImageAttachmentExt('png')).toBe(true);
    expect(isImageAttachmentExt('svg')).toBe(true);
    expect(isImageAttachmentExt('md')).toBe(false);
    expect(isImageAttachmentExt('pdf')).toBe(false);
  });

  test('失败方式 4：ext → inline mime 映射（jpg 归一 image/jpeg）', () => {
    expect(INLINE_IMAGE_MIME_BY_EXT.png).toBe('image/png');
    expect(INLINE_IMAGE_MIME_BY_EXT.jpg).toBe('image/jpeg');
    expect(INLINE_IMAGE_MIME_BY_EXT.jpeg).toBe('image/jpeg');
    expect(INLINE_IMAGE_MIME_BY_EXT.gif).toBe('image/gif');
    expect(INLINE_IMAGE_MIME_BY_EXT.webp).toBe('image/webp');
    expect(INLINE_IMAGE_MIME_BY_EXT.svg).toBeUndefined();
    expect(INLINE_IMAGE_MIME_BY_EXT.bmp).toBeUndefined();
  });

  test('失败方式 1：ATTACHMENT_TOKEN_LINE 行级正则与批量解析一致', () => {
    const line = '![x](attachment:t1/id1.png)';
    expect(ATTACHMENT_TOKEN_LINE.test(line)).toBe(true);
    expect(ATTACHMENT_TOKEN_LINE.test(`prefix ${line}`)).toBe(false);
  });
});

describe('renderAttachmentTokensToLabels（#757 标题面：裸 token → chip 名）', () => {
  test('行中 token 替换为文件名，其余文字不动', () => {
    expect(renderAttachmentTokensToLabels('看这个 ![a.png](attachment:t/i.png) 很重要')).toBe(
      '看这个 a.png 很重要',
    );
  });

  test('无 token 文本逐字不变', () => {
    expect(renderAttachmentTokensToLabels('修复登录')).toBe('修复登录');
  });

  test('空 label 退为空串（调用面跳过空行）', () => {
    expect(renderAttachmentTokensToLabels('![](attachment:t/i.png)')).toBe('');
  });
});
