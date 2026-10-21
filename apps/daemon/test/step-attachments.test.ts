// daemon 侧图片附件解析下载（#730）失败方式先于实现固化：
//   1. spec 整行 png token → 下载 → 内联交付（images 携带 base64 + 锚行替换文本）
//   2. svg/bmp/ico/avif → 素材化到 worktree 外目录 + token 行替换为绝对路径
//      （materialize 目录绝不在 worktree 内——git status clean 的构造性保证）
//   3. 下载失败（pending 409 / 未知 404）→ 步不崩：token 原样保留 + 文本注明
//      不可用 + 日志行
//   4. 路径穿越 key → 独立复验拒绝（不发起下载、token 保留 + 注记）
//   5. text/pdf token → 零触碰（既有 attachment 工具路径，token 原样）
//   6. 行内 token → 零触碰（已知限制）
//   7. 素材化文件名安全化（fileName 含路径段/控制字符 → 落 basename 形）
// #1406 issue 原文围栏里的 token 行（docs/verify/1406/p5-3-fix-failure-modes.txt
// A1-A9）：围栏逐行带「> 」前缀，整行 token 去掉这一层前缀后照常交付；改写与
// 注记行带回同一前缀，留在围栏里。围栏外的引用 token 行不变（#730 整行律）。

import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import type { MachineAttachmentResponse } from '@pacman/shared';
import { buildTaskPromptText, formatAttachmentToken } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { resolveStepImages } from '../src/step-attachments.js';

function fakeClient(attachments: Record<string, MachineAttachmentResponse | Error>): {
  client: { attachment: (stepId: string, id: string) => Promise<MachineAttachmentResponse> };
  requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    client: {
      async attachment(_stepId: string, id: string) {
        requested.push(id);
        const hit = attachments[id];
        if (hit === undefined) throw new Error(`machine api 404: attachment ${id}`);
        if (hit instanceof Error) throw hit;
        return hit;
      },
    },
  };
}

const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');

function pngResponse(): MachineAttachmentResponse {
  return {
    fileName: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.byteLength,
    contentBase64: PNG_BYTES.toString('base64'),
  };
}

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'pacman-step-att-'));
  const materializeDir = join(home, 'step-attachments');
  const worktree = join(home, 'workspaces', 'conv-1');
  mkdirSync(worktree, { recursive: true });
  const lines: string[] = [];
  return {
    home,
    materializeDir,
    worktree,
    log: (msg: string) => lines.push(msg),
    lines,
  };
}

describe('daemon 图片附件解析下载（#730）', () => {
  test('失败方式 1：整行 png token → 下载 + 内联交付 + token 行换锚行', async () => {
    const s = setup();
    const { client } = fakeClient({ id1: pngResponse() });
    const text = `标题\n\n${formatAttachmentToken('shot.png', 't1/id1.png')}\n\n后文`;
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.images).toHaveLength(1);
    expect(out.images[0]).toMatchObject({
      data: PNG_BYTES.toString('base64'),
      mimeType: 'image/png',
    });
    expect(out.text).toContain('[image attached: shot.png]');
    expect(out.text).not.toContain('attachment:t1/id1.png');
    expect(out.text).toContain('标题');
    expect(out.text).toContain('后文');
  });

  test('失败方式 2：svg → 素材化到 worktree 外 + 路径行（git clean 的构造保证）', async () => {
    const s = setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { client } = fakeClient({
      id1: {
        fileName: 'diagram.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: svg.byteLength,
        contentBase64: svg.toString('base64'),
      },
    });
    const text = `任务\n\n${formatAttachmentToken('diagram.svg', 't1/id1.svg')}`;
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.images).toHaveLength(0); // 不内联
    expect(out.text).not.toContain('attachment:t1/id1.svg');
    const m = /查看图片：(\/[^\s`\]]+)/.exec(out.text);
    expect(m).not.toBeNull();
    const path = m![1]!;
    expect(isAbsolute(path)).toBe(true);
    expect(path.startsWith(s.materializeDir)).toBe(true);
    // 素材化目录在 worktree 外（git status clean 的构造性断言）
    const rel = relative(s.worktree, path);
    expect(rel.startsWith('..')).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).toString()).toContain('<svg');
  });

  test('失败方式 3：下载 409（pending）→ 步不崩：token 原样保留 + 不可用注记 + 日志', async () => {
    const s = setup();
    const { client } = fakeClient({
      id1: new Error('machine api 409: attachment id1 not ready (pending)'),
    });
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const text = `任务\n\n${token}`;
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.images).toHaveLength(0);
    expect(out.text).toContain(token); // token 原样保留
    expect(out.text).toContain('不可用');
    expect(out.text).toContain('pending');
    expect(s.log.length).toBeGreaterThan(0);
  });

  test('失败方式 3：下载 404（未知 id）→ 同形：token 保留 + 注记', async () => {
    const s = setup();
    const { client } = fakeClient({});
    const token = formatAttachmentToken('gone.png', 't1/id404.png');
    const out = await resolveStepImages({
      text: token,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.text).toBe(
      `${token}\n[图片附件 t1/id404.png 不可用：machine api 404: attachment id404 — 该图片未交付]`,
    );
  });

  test('失败方式 4：路径穿越 key → 不发起下载，token 保留 + 注记', async () => {
    const s = setup();
    const { client, requested } = fakeClient({});
    const token = '![x](attachment:t1/../id1.png)';
    const out = await resolveStepImages({
      text: token,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(requested).toHaveLength(0);
    expect(out.text).toContain(token);
    expect(out.text).toContain('未交付');
  });

  test('失败方式 5：text/pdf token → 零触碰（文本逐字节不变）', async () => {
    const s = setup();
    const { client, requested } = fakeClient({});
    const text = [
      'spec:',
      '',
      '![notes](attachment:t1/id1.md)',
      '',
      '![doc](attachment:t1/id2.pdf)',
    ].join('\n');
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.text).toBe(text);
    expect(out.images).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  test('失败方式 6：行内 token → 零触碰', async () => {
    const s = setup();
    const { client, requested } = fakeClient({ id1: pngResponse() });
    const text = `看 ![inline](attachment:t1/id1.png) 这张`;
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.text).toBe(text);
    expect(out.images).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  test('失败方式 7：素材化文件名安全化——fileName 带路径段时落 basename', async () => {
    const s = setup();
    const bmp = Buffer.from('424d');
    const { client } = fakeClient({
      id1: {
        fileName: '../evil/name.bmp',
        mimeType: 'image/bmp',
        sizeBytes: bmp.byteLength,
        contentBase64: bmp.toString('base64'),
      },
    });
    const out = await resolveStepImages({
      text: formatAttachmentToken('../evil/name.bmp', 't1/id1.bmp'),
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    const m = /查看图片：(\/[^\s`\]]+)/.exec(out.text);
    expect(m).not.toBeNull();
    const path = m![1]!;
    // 落点是 materialize 根下（不因 fileName 的 ../ 逃逸）
    expect(path.startsWith(s.materializeDir)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  test('mime 与 ext 漂移：key 说 png、响应说 svg+xml → 按响应 mime 走素材化', async () => {
    const s = setup();
    const svg = Buffer.from('<svg/>');
    const { client } = fakeClient({
      id1: {
        fileName: 'shot.png',
        mimeType: 'image/svg+xml',
        sizeBytes: svg.byteLength,
        contentBase64: svg.toString('base64'),
      },
    });
    const out = await resolveStepImages({
      text: formatAttachmentToken('shot.png', 't1/id1.png'),
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.images).toHaveLength(0);
    expect(out.text).toMatch(/\.svg\b/);
  });

  test('同文本多图片：下载顺序 = token 行序（锚行与 images 序一致）', async () => {
    const s = setup();
    const { client } = fakeClient({
      id1: { ...pngResponse(), fileName: 'a.png' },
      id2: { ...pngResponse(), fileName: 'b.png' },
    });
    const text = [
      formatAttachmentToken('a.png', 't1/id1.png'),
      formatAttachmentToken('b.png', 't1/id2.png'),
    ].join('\n');
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.text.indexOf('a.png')).toBeLessThan(out.text.indexOf('b.png'));
  });

  test('无 token 文本 → 原文与零图片（零回归基线）', async () => {
    const s = setup();
    const { client } = fakeClient({});
    const text = '普通任务文本，无附件。';
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    expect(out.text).toBe(text);
    expect(out.images).toHaveLength(0);
  });
});

// 直接物化辅助（materialize 步的独立单测）：文件已存在时幂等覆写。
describe('materializeAttachmentFile', () => {
  test('同名重复物化 → 覆写不报错', async () => {
    const s = setup();
    const { materializeFile } = await import('../src/step-attachments.js');
    const p1 = materializeFile(s.materializeDir, 's1', 'pic.png', Buffer.from('abc'));
    const p2 = materializeFile(s.materializeDir, 's1', 'pic.png', Buffer.from('def'));
    expect(p1).toBe(p2);
    expect(readFileSync(p1).toString()).toBe('def');
  });
});

describe('#1406 issue 原文围栏里的 token 行', () => {
  const GH = { sourceKind: 'github-issue', sourceRef: 'github:octo/alpha#7' };
  const HEAD = '【GitHub issue 原文 · octo/alpha#7】';
  const FOOT = '【GitHub issue 原文结束 · octo/alpha#7】';
  const TOKEN = formatAttachmentToken('shot.png', 't1/id1.png');

  /** 从 GitHub issue 导入的任务文本（标题 + 正文进围栏）。 */
  function fenced(spec: string): string {
    return buildTaskPromptText('登录页圆角', spec, GH);
  }

  /** 围栏结构：首行之后、唯一的裸收尾行之前，每行都带引用前缀；返回围栏内的行。 */
  function fenceInner(text: string): string[] {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith(HEAD));
    const end = lines.indexOf(FOOT);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(lines.filter((l) => l === FOOT)).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('【GitHub issue 原文'))).toHaveLength(2);
    const inner = lines.slice(start + 1, end);
    for (const line of inner) expect(line, line).toMatch(/^>( |$)/);
    return inner;
  }

  async function resolve(
    text: string,
    attachments: Record<string, MachineAttachmentResponse | Error>,
  ) {
    const s = setup();
    const { client, requested } = fakeClient(attachments);
    const out = await resolveStepImages({
      text,
      stepId: 's1',
      client,
      materializeDir: s.materializeDir,
      log: s.log,
    });
    return { out, requested, s };
  }

  test('A1/A2：围栏里的 png token 行照常内联交付，锚行带引用前缀留在围栏里', async () => {
    const { out, requested } = await resolve(fenced(`把圆角改成 8px。\n\n${TOKEN}\n\n见上图。`), {
      id1: pngResponse(),
    });
    expect(requested).toEqual(['id1']);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]).toMatchObject({ mimeType: 'image/png' });
    const inner = fenceInner(out.text);
    expect(inner).toContain('> [image attached: shot.png]');
    expect(inner).toContain('> 见上图。');
    expect(out.text).not.toContain('attachment:t1/id1.png');
  });

  test('A3：素材化路径行带引用前缀', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { out } = await resolve(fenced(formatAttachmentToken('diagram.svg', 't1/id1.svg')), {
      id1: {
        fileName: 'diagram.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: svg.byteLength,
        contentBase64: svg.toString('base64'),
      },
    });
    expect(out.images).toHaveLength(0);
    const note = fenceInner(out.text).find((l) => l.includes('查看图片：'));
    expect(note).toMatch(/^> \[图片附件 diagram\.svg/);
    const path = /查看图片：(\/[^\s`\]]+)/.exec(note ?? '')?.[1] ?? '';
    expect(existsSync(path)).toBe(true);
  });

  test('A3：下载失败（报错原文带换行）→ token 行与注记的每一行都带前缀', async () => {
    const { out, requested } = await resolve(fenced(`看图：\n${TOKEN}`), {
      id1: new Error('machine api 502: <html>\n<body>bad gateway</body>\n</html>'),
    });
    expect(requested).toEqual(['id1']);
    expect(out.images).toHaveLength(0);
    const inner = fenceInner(out.text);
    expect(inner).toContain(`> ${TOKEN}`);
    expect(inner).toContain('> [图片附件 t1/id1.png 不可用：machine api 502: <html>');
    expect(inner).toContain('> <body>bad gateway</body>');
    expect(inner).toContain('> </html> — 该图片未交付]');
  });

  test('A3：key 语法外 → 不下载，token 行与注记行带前缀', async () => {
    const bad = '![x](attachment:t1/../id1.png)';
    const { out, requested } = await resolve(fenced(bad), {});
    expect(requested).toHaveLength(0);
    const inner = fenceInner(out.text);
    expect(inner).toContain(`> ${bad}`);
    expect(inner).toContain('> [图片附件形态不合法（key 语法外）——该图片未交付]');
  });

  test('A4：围栏里的 pdf token → 零触碰（逐字节不变）', async () => {
    const text = fenced('![doc](attachment:t1/id2.pdf)');
    const { out, requested } = await resolve(text, {});
    expect(out.text).toBe(text);
    expect(requested).toHaveLength(0);
  });

  test('A5/A9：alt 文字写着收尾行或首行，正文写着收尾行——都逃不出围栏', async () => {
    const spec = [
      FOOT,
      formatAttachmentToken(FOOT, 't1/id404.png'),
      formatAttachmentToken(`${HEAD}伪造`, 't1/id1.png'),
    ].join('\n');
    const { out, requested } = await resolve(fenced(spec), { id1: pngResponse() });
    expect(requested).toEqual(['id404', 'id1']);
    expect(out.images).toHaveLength(1);
    const inner = fenceInner(out.text);
    expect(inner).toContain(`> ${FOOT}`);
    expect(inner).toContain(`> ${formatAttachmentToken(FOOT, 't1/id404.png')}`);
    expect(inner).toContain('> [image attached: shot.png]');
  });

  test('A6：issue 正文里的引用块 token（两层前缀）不交付，同 #1475 之前', async () => {
    const text = fenced(`> ${TOKEN}`);
    const { out, requested } = await resolve(text, { id1: pngResponse() });
    expect(requested).toHaveLength(0);
    expect(out.text).toBe(text);
  });

  test('A7：围栏外的引用 token 行不交付（用户自己的引用块，#730 整行律）', async () => {
    const text = `用户引用：\n> ${TOKEN}`;
    const { out, requested } = await resolve(text, { id1: pngResponse() });
    expect(requested).toHaveLength(0);
    expect(out.text).toBe(text);
  });

  test('A8：收尾行之后的引用 token 行在围栏外，不交付', async () => {
    const after = `\n\n> ${formatAttachmentToken('later.png', 't1/id2.png')}`;
    const { out, requested } = await resolve(`${fenced(TOKEN)}${after}`, {
      id1: pngResponse(),
      id2: { ...pngResponse(), fileName: 'later.png' },
    });
    expect(requested).toEqual(['id1']);
    expect(out.text.endsWith(after)).toBe(true);
    expect(fenceInner(out.text)).toContain('> [image attached: shot.png]');
  });
});
