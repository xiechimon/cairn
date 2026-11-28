import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  BACKEND_RUNTIME_IDS,
  BRIEF_BACKEND_IDS,
  createDoubaoSubscriptionSchema,
  doubaoLoginSessionSchema,
  doubaoSubscriptionSchema,
  MACHINE_RUNTIMES,
  MODEL_SOURCE_RUNTIMES,
  machineDoubaoLoginEventBodySchema,
  machineStreamEventSchema,
  mergeReportedCapabilities,
  parseReportedCapabilities,
  patchDoubaoSubscriptionSchema,
  startDoubaoLoginBodySchema,
  stepQueueBlockedSchema,
  teamStreamEventSchema,
} from '../src/index.js';
import {
  DOUBAO_PINNED_ARTIFACTS,
  doubaoInstallSupported,
  ensureDoubaoManagedInstall,
  parseDoubaoArtifactsRelease,
} from '../src/node/doubao-install.js';

describe('doubao subscription shared contracts', () => {
  test('parseReportedCapabilities keeps doubao report and handles omitted old-runner payload', () => {
    const oldRunner = parseReportedCapabilities({
      mcpServers: ['cairn'],
      skills: [],
      runnerProtocolVersion: 1,
    });
    expect(oldRunner).toBeDefined();
    expect(oldRunner?.doubao).toBeUndefined();

    const doubaoRunner = parseReportedCapabilities({
      mcpServers: [],
      skills: [],
      doubao: {
        installed: true,
        authenticated: true,
        platformSupported: true,
        version: '2.38.4',
        probedAt: 1_700_000_000_000,
        models: [
          {
            id: '5',
            name: 'Doubao 2.1 Pro',
            thinkingLevels: ['low', 'medium', 'high'],
            thinkingDefault: 'medium',
          },
        ],
      },
    });
    expect(doubaoRunner?.doubao).toEqual({
      installed: true,
      authenticated: true,
      platformSupported: true,
      version: '2.38.4',
      probedAt: 1_700_000_000_000,
      models: [
        {
          id: '5',
          name: 'Doubao 2.1 Pro',
          thinkingLevels: ['low', 'medium', 'high'],
          thinkingDefault: 'medium',
        },
      ],
    });
    expect(BACKEND_RUNTIME_IDS).toContain('doubao');
    expect(BRIEF_BACKEND_IDS).toContain('doubao');
    expect(MACHINE_RUNTIMES).toContain('doubao');
    expect(MODEL_SOURCE_RUNTIMES).toContain('doubao');
  });

  test('mergeReportedCapabilities preserves newer doubao probedAt', () => {
    const newerRevoked = mergeReportedCapabilities(
      {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: false,
          probedAt: 2_000,
        },
      },
      {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          probedAt: 1_000,
        },
      },
    );
    expect(newerRevoked.doubao).toEqual({
      installed: true,
      authenticated: false,
      probedAt: 2_000,
    });

    const fresherHeartbeat = mergeReportedCapabilities(
      {
        ...newerRevoked,
        doubao: {
          ...newerRevoked.doubao!,
          switchedAt: 2_500,
        },
      },
      {
        mcpServers: [],
        skills: [],
        doubao: {
          installed: true,
          authenticated: true,
          probedAt: 3_000,
        },
      },
    );
    expect(fresherHeartbeat.doubao).toEqual({
      installed: true,
      authenticated: true,
      probedAt: 3_000,
      switchedAt: 2_500,
    });
  });

  test('stepQueueBlockedSchema accepts doubao-login-required and doubao login wire schemas validate', () => {
    expect(stepQueueBlockedSchema.parse({ kind: 'doubao-subscription', missing: [] })).toEqual({
      kind: 'doubao-subscription',
      missing: [],
    });
    expect(
      stepQueueBlockedSchema.parse({ kind: 'doubao-login-required', missing: ['Mac-mini'] }),
    ).toEqual({
      kind: 'doubao-login-required',
      missing: ['Mac-mini'],
    });
    expect(createDoubaoSubscriptionSchema.parse({ label: '豆包订阅' })).toEqual({
      label: '豆包订阅',
    });
    expect(createDoubaoSubscriptionSchema.parse({ label: 'MacBook 豆包', runnerId: null })).toEqual(
      { label: 'MacBook 豆包', runnerId: null },
    );
    expect(patchDoubaoSubscriptionSchema.parse({ runnerId: null })).toEqual({ runnerId: null });
    expect(startDoubaoLoginBodySchema.parse({ force: true, logoutFirst: true })).toEqual({
      force: true,
      logoutFirst: true,
    });
    expect(
      machineStreamEventSchema.parse({
        type: 'doubao.login.start',
        loginId: 'login-1',
        logoutFirst: true,
      }),
    ).toEqual({ type: 'doubao.login.start', loginId: 'login-1', logoutFirst: true });
    expect(
      machineStreamEventSchema.parse({ type: 'doubao.login.cancel', loginId: 'login-1' }),
    ).toEqual({ type: 'doubao.login.cancel', loginId: 'login-1' });
    expect(
      machineDoubaoLoginEventBodySchema.parse({
        loginId: 'login-1',
        status: 'qr',
        revision: 1,
        qrPngBase64: 'iVBORw0KGgo=',
      }).status,
    ).toBe('qr');
    expect(
      doubaoLoginSessionSchema.parse({
        loginId: 'login-1',
        machineId: 'm-1',
        machineName: 'Mac mini',
        status: 'scanned',
        revision: 2,
        startedAt: 100,
        updatedAt: 200,
      }).status,
    ).toBe('scanned');
    expect(
      teamStreamEventSchema.parse({
        type: 'doubao.login',
        machineId: 'm-1',
        loginId: 'login-1',
        status: 'qr',
        revision: 1,
      }).type,
    ).toBe('doubao.login');

    expect(patchDoubaoSubscriptionSchema.safeParse({}).success).toBe(false);
    expect(
      doubaoSubscriptionSchema.parse({
        id: 'doubao-1',
        kind: 'doubao-subscription',
        label: 'MacBook 豆包',
        runnerId: null,
        enabled: true,
        enabledAt: 1_700_000_000_000,
        models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
        createdAt: 1_700_000_000_000,
      }).runnerId,
    ).toBeNull();
  });

  test('doubao-install pins 2.38.4 without npm fetches, verifies SHA-256, and rejects traversal/symlinks', async () => {
    expect(doubaoInstallSupported('darwin', 'arm64')).toBe(true);
    expect(doubaoInstallSupported('darwin', 'x64')).toBe(false);
    expect(doubaoInstallSupported('linux', 'x64')).toBe(false);
    expect(doubaoInstallSupported('win32', 'x64')).toBe(false);
    expect(parseDoubaoArtifactsRelease(DOUBAO_PINNED_ARTIFACTS, 'darwin', 'arm64')?.version).toBe(
      '2.38.4',
    );
    expect(
      parseDoubaoArtifactsRelease(
        {
          version: '2.38.4',
          platforms: {
            'darwin-arm64': {
              url: 'https://evil.example.com/doubao.tar.gz',
              sha256: 'a'.repeat(64),
              root: 'doubao-cli-2.38.4-darwin-arm64',
            },
          },
        },
        'darwin',
        'arm64',
      ),
    ).toBeNull();
    expect(
      parseDoubaoArtifactsRelease(
        {
          version: '2.37.0',
          platforms: {
            'darwin-arm64': {
              url: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao_cli/2.37.0/doubao.tar.gz',
              sha256: 'a'.repeat(64),
              root: 'doubao-cli-2.37.0-darwin-arm64',
            },
          },
        },
        'darwin',
        'arm64',
      ),
    ).toBeNull();

    const temp = makeTestTempDir('doubao-install-test-');
    try {
      const rootFolder = 'doubao-cli-2.38.4-darwin-arm64';
      const srcDir = join(temp, 'src', rootFolder);
      mkdirSync(join(srcDir, 'resources', 'js_app'), { recursive: true });
      const pinnedBin = '#!/bin/sh\necho "2.38.4"\n';
      writeFileSync(join(srcDir, 'doubao'), pinnedBin, { mode: 0o755 });
      writeFileSync(join(srcDir, 'resources', 'js_app', 'cli-manifest.json'), '{}');
      const pinnedBinSha = createHash('sha256').update(pinnedBin).digest('hex');
      writeFileSync(
        join(srcDir, 'manifest.json'),
        JSON.stringify({
          schema_version: 1,
          version: '2.38.4',
          target: 'darwin-arm64',
          entrypoint: 'doubao',
          files: [
            { path: 'doubao', sha256: pinnedBinSha },
            { path: 'resources/js_app/cli-manifest.json' },
          ],
        }),
      );
      const tgzPath = join(temp, 'doubao.tar.gz');
      execFileSync('tar', ['-czf', tgzPath, '-C', join(temp, 'src'), rootFolder]);
      const pinnedBytes = readFileSync(tgzPath);
      const pinnedSha = createHash('sha256').update(pinnedBytes).digest('hex');

      const fetchedUrls: string[] = [];
      const badRoot = join(temp, 'managed-bad');
      const badArchive = await ensureDoubaoManagedInstall({
        root: badRoot,
        platform: 'darwin',
        arch: 'arm64',
        versionProbe: false,
        fetchImpl: async (input) => {
          fetchedUrls.push(String(input));
          return new Response(Buffer.from('corrupt'));
        },
      });
      expect(badArchive).toBeNull();
      expect(fetchedUrls).toEqual([DOUBAO_PINNED_ARTIFACTS.platforms['darwin-arm64']!.url]);

      const traversalSrc = join(temp, 'evil-src');
      mkdirSync(traversalSrc, { recursive: true });
      writeFileSync(join(traversalSrc, 'escape.txt'), 'bad');
      const traversalTgz = join(temp, 'traversal.tar.gz');
      execFileSync('tar', ['-czf', traversalTgz, '-C', traversalSrc, 'escape.txt']);
      const traversalBytes = readFileSync(traversalTgz);
      const traversalSha = createHash('sha256').update(traversalBytes).digest('hex');
      const traversalRes = await ensureDoubaoManagedInstall({
        root: join(temp, 'managed-traversal'),
        platform: 'darwin',
        arch: 'arm64',
        release: {
          version: '2.38.4',
          url: DOUBAO_PINNED_ARTIFACTS.platforms['darwin-arm64']!.url,
          sha256: traversalSha,
          root: rootFolder,
          executableName: 'doubao',
          format: 'tar.gz',
        },
        fetchImpl: async () => new Response(traversalBytes),
      });
      expect(traversalRes).toBeNull();

      const symlinkRoot = join(temp, 'sym-src', rootFolder);
      mkdirSync(symlinkRoot, { recursive: true });
      symlinkSync('/etc/passwd', join(symlinkRoot, 'doubao'));
      const symTgz = join(temp, 'symlink.tar.gz');
      execFileSync('tar', ['-czf', symTgz, '-C', join(temp, 'sym-src'), rootFolder]);
      const symBytes = readFileSync(symTgz);
      const symSha = createHash('sha256').update(symBytes).digest('hex');
      const symManagedRoot = join(temp, 'managed-symlink');
      const symRes = await ensureDoubaoManagedInstall({
        root: symManagedRoot,
        platform: 'darwin',
        arch: 'arm64',
        release: {
          version: '2.38.4',
          url: DOUBAO_PINNED_ARTIFACTS.platforms['darwin-arm64']!.url,
          sha256: symSha,
          root: rootFolder,
          executableName: 'doubao',
          format: 'tar.gz',
        },
        fetchImpl: async () => new Response(symBytes),
      });
      expect(symRes).toBeNull();
      expect(existsSync(join(symManagedRoot, 'current.json'))).toBe(false);

      const customRoot = join(temp, 'managed-ok');
      const okUrls: string[] = [];
      const installed = await ensureDoubaoManagedInstall({
        root: customRoot,
        platform: 'darwin',
        arch: 'arm64',
        release: {
          version: '2.38.4',
          url: DOUBAO_PINNED_ARTIFACTS.platforms['darwin-arm64']!.url,
          sha256: pinnedSha,
          root: rootFolder,
          executableName: 'doubao',
          format: 'tar.gz',
        },
        fetchImpl: async (input) => {
          okUrls.push(String(input));
          return new Response(pinnedBytes);
        },
      });
      expect(okUrls).toEqual([DOUBAO_PINNED_ARTIFACTS.platforms['darwin-arm64']!.url]);
      expect(installed?.version).toBe('2.38.4');
      expect(installed?.args).toEqual(['acp', 'serve']);
    } finally {
      releaseTestTempDir(temp);
    }
  });
});
