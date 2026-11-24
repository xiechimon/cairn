import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ComputerCall, ComputerFrame } from '@cairn/shared';
import { ATTACHMENT_MAX_BYTES } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { createHostShellConfinement } from '../src/backend/host-shell-confinement.js';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import { HostComputerProvider } from '../src/computer/host.js';
import { sweepStagedUploads, writeStagedUpload } from '../src/computer/staging.js';
import { MachineApiError } from '../src/machine-client.js';
import { testTempDir } from './test-temp-dir.js';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

function fixture() {
  const root = realpathSync(testTempDir('attach-file-'));
  const home = join(root, 'home');
  const stagingRoot = join(root, 'cairn-uploads');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'id_ed25519'), 'private-key');
  mkdirSync(join(home, 'work'), { recursive: true });
  const confinement = createHostShellConfinement({ home, deniedRoots: [] });
  const host = new HostComputerProvider({
    home,
    env: { PATH: process.env.PATH, HOME: home },
    confinement,
  });
  return { root, home, stagingRoot, confinement, host };
}

function callOf(
  tool: 'stage_attachment' | 'attach_file',
  params: Record<string, unknown>,
): ComputerCall {
  return {
    callId: `call-${tool}-${Math.random().toString(16).slice(2, 10)}`,
    stepId: 'step-1',
    tool,
    params,
    deadlineAt: Date.now() + 30_000,
  };
}

describe('daemon stage_attachment and attach_file', () => {
  test('stage_attachment downloads bytes into a per-thread staging folder and sanitizes path traversal filenames', async () => {
    const { home, stagingRoot, confinement, host } = fixture();
    const frames: ComputerFrame[] = [];
    const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF\n');
    const dispatcher = createComputerDispatcher({
      client: {
        computerFrames: async (_callId, body) => {
          frames.push(...body.frames);
          return { ok: true, cancelled: false };
        },
        downloadComputerAttachment: async () => pdfBytes,
      },
      host,
      hostConfinement: confinement,
      hostHome: home,
      stagingRoot,
      cairnOrigins: [],
    });

    await dispatcher.dispatch(
      callOf('stage_attachment', {
        threadId: 'chief-abc',
        attachmentId: 'att-1',
        fileName: '../../../etc/resume.pdf',
      }),
    );

    const done = frames.find((f) => f.kind === 'done');
    expect(done).toBeDefined();
    if (done?.kind === 'done') {
      const parsed = JSON.parse(done.text) as { path: string; sizeBytes: number };
      expect(parsed.sizeBytes).toBe(pdfBytes.length);
      expect(parsed.path.startsWith(join(stagingRoot, 'chief-abc'))).toBe(true);
      expect(parsed.path.endsWith('att-1-resume.pdf')).toBe(true);
      expect(readFileSync(parsed.path)).toEqual(pdfBytes);
    }
    await dispatcher.close();
  });

  test('sweepStagedUploads removes expired thread folders and preserves recent ones', () => {
    const { stagingRoot } = fixture();
    const oldFile = writeStagedUpload(stagingRoot, {
      threadId: 'chief-old',
      attachmentId: 'att-1',
      fileName: 'old.pdf',
      bytes: Buffer.from('old'),
    });
    const freshFile = writeStagedUpload(stagingRoot, {
      threadId: 'chief-fresh',
      attachmentId: 'att-2',
      fileName: 'fresh.pdf',
      bytes: Buffer.from('fresh'),
    });
    const now = Date.now();
    const expired = new Date(now - 73 * 60 * 60 * 1000);
    utimesSync(join(stagingRoot, 'chief-old'), expired, expired);

    const removed = sweepStagedUploads(stagingRoot, { now });
    expect(removed).toEqual(['chief-old']);
    expect(existsSync(oldFile.path)).toBe(false);
    expect(existsSync(freshFile.path)).toBe(true);
  });

  test('writeStagedUpload and sweepStagedUploads refuse symlinked or world-writable staging roots', () => {
    const { root, home } = fixture();
    const targetDir = join(home, 'protected-target');
    mkdirSync(join(targetDir, 'sub'), { recursive: true });
    writeFileSync(join(targetDir, 'sub', 'keep.txt'), 'important');
    const oldDate = new Date(Date.now() - 100 * 60 * 60 * 1000);
    utimesSync(join(targetDir, 'sub'), oldDate, oldDate);

    const symlinkRoot = join(root, 'symlink-uploads');
    symlinkSync(targetDir, symlinkRoot);
    expect(() =>
      writeStagedUpload(symlinkRoot, {
        threadId: 'chief-1',
        attachmentId: 'att-1',
        fileName: 'a.pdf',
        bytes: Buffer.from('x'),
      }),
    ).toThrow(/unsafe/i);
    expect(sweepStagedUploads(symlinkRoot)).toEqual([]);
    expect(existsSync(join(targetDir, 'sub', 'keep.txt'))).toBe(true);

    const wideRoot = join(root, 'wide-uploads');
    mkdirSync(wideRoot, { mode: 0o777 });
    chmodSync(wideRoot, 0o777);
    expect(() =>
      writeStagedUpload(wideRoot, {
        threadId: 'chief-1',
        attachmentId: 'att-1',
        fileName: 'a.pdf',
        bytes: Buffer.from('x'),
      }),
    ).toThrow(/unsafe/i);
  });

  test('attach_file uploads a valid file and returns server attachment metadata', async () => {
    const { home, stagingRoot, confinement, host } = fixture();
    const outPath = join(home, 'work', 'resume-page-1.png');
    writeFileSync(outPath, PNG_BYTES);
    const frames: ComputerFrame[] = [];
    const uploaded: { fileName: string; caption?: string; bytes: Buffer }[] = [];

    const dispatcher = createComputerDispatcher({
      client: {
        computerFrames: async (_callId, body) => {
          frames.push(...body.frames);
          return { ok: true, cancelled: false };
        },
        uploadComputerAttachment: async (_callId, input) => {
          uploaded.push(input);
          return {
            id: 'att-out-1',
            key: 'team-1/att-out-1.png',
            token: '![Page 1](attachment:team-1/att-out-1.png)',
            sha256: 'deadbeef',
          };
        },
      },
      host,
      hostConfinement: confinement,
      hostHome: home,
      stagingRoot,
      cairnOrigins: [],
    });

    await dispatcher.dispatch(
      callOf('attach_file', { path: '~/work/resume-page-1.png', caption: 'Page 1' }),
    );

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.fileName).toBe('resume-page-1.png');
    expect(uploaded[0]?.caption).toBe('Page 1');
    expect(uploaded[0]?.bytes).toEqual(PNG_BYTES);
    const done = frames.find((f) => f.kind === 'done');
    expect(done?.kind).toBe('done');
    await dispatcher.close();
  });

  test('attach_file refuses missing files, directories, symlinks to credentials, empty files, oversized files, and reports upload errors', async () => {
    const { home, stagingRoot, confinement, host } = fixture();
    const emptyPath = join(home, 'work', 'empty.png');
    writeFileSync(emptyPath, Buffer.alloc(0));
    const bigPath = join(home, 'work', 'too-big.png');
    writeFileSync(bigPath, Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 1));
    const symlinkPath = join(home, 'work', 'key-link.txt');
    symlinkSync(join(home, '.ssh', 'id_ed25519'), symlinkPath);
    const okPath = join(home, 'work', 'ok.png');
    writeFileSync(okPath, PNG_BYTES);

    const runCase = async (
      path: string,
      uploadError?: Error,
    ): Promise<ComputerFrame | undefined> => {
      const frames: ComputerFrame[] = [];
      const dispatcher = createComputerDispatcher({
        client: {
          computerFrames: async (_callId, body) => {
            frames.push(...body.frames);
            return { ok: true, cancelled: false };
          },
          uploadComputerAttachment: async () => {
            if (uploadError) throw uploadError;
            return { id: 'x', key: 't/x.png', token: '![x](attachment:t/x.png)', sha256: '00' };
          },
        },
        host,
        hostConfinement: confinement,
        hostHome: home,
        stagingRoot,
        cairnOrigins: [],
      });
      await dispatcher.dispatch(callOf('attach_file', { path }));
      await dispatcher.close();
      return frames.find((f) => f.kind === 'error');
    };

    const missing = await runCase(join(home, 'work', 'does-not-exist.png'));
    expect(missing?.kind === 'error' && missing.message).toContain('file not found');

    const dir = await runCase(join(home, 'work'));
    expect(dir?.kind === 'error' && dir.message).toContain('not a regular file');

    const credDirect = await runCase(join(home, '.ssh', 'id_ed25519'));
    expect(credDirect?.kind === 'error' && credDirect.message).toContain('protected directory');

    const credSymlink = await runCase(symlinkPath);
    expect(credSymlink?.kind === 'error' && credSymlink.message).toContain('protected directory');

    const empty = await runCase(emptyPath);
    expect(empty?.kind === 'error' && empty.message).toContain('empty');

    const oversized = await runCase(bigPath);
    expect(oversized?.kind === 'error' && oversized.message).toContain('10 MiB');

    const serverErr = await runCase(okPath, new MachineApiError(500, '{"error":"disk full"}'));
    expect(serverErr?.kind === 'error' && serverErr.message).toContain('disk full');
  });
});
