import { execFileSync } from 'node:child_process';
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { platform, userInfo } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { prepareCoordinatorImage } from '../src/coordinator/runtime/images.js';
import { user as userTable } from '../src/db/schema.js';
import { fillSystemAvatar } from '../src/services/system-avatar.js';
import { bootServer, req } from './helpers.js';

vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, platform: vi.fn(actual.platform), userInfo: vi.fn(actual.userInfo) };
});
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, openSync: vi.fn(actual.openSync) };
});

let home: string;
let png: Buffer;

beforeEach(async () => {
  vi.resetAllMocks();
  home = makeTestTempDir('avatar-');
  vi.mocked(platform).mockReturnValue('linux');
  vi.mocked(userInfo).mockReturnValue({
    username: 'avatar-test',
    homedir: home,
    uid: 1001,
    gid: 1001,
    shell: null,
  });
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error('unavailable');
  });
  png = await sharp({ create: { width: 317, height: 179, channels: 3, background: '#1a74b0' } })
    .withMetadata({ exif: { IFD0: { Artist: 'private-avatar-metadata' } } })
    .png()
    .toBuffer();
});

afterEach(() => {
  releaseTestTempDir(home);
  vi.restoreAllMocks();
});

async function decoded(url: string | null) {
  expect(url).toMatch(/^data:image\/webp;base64,/);
  const bytes = Buffer.from(url?.split(',')[1] ?? '', 'base64');
  expect(bytes.length).toBeLessThanOrEqual(8 * 1024);
  const metadata = await sharp(bytes).metadata();
  expect(metadata).toMatchObject({ format: 'webp', width: 128, height: 72 });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  return bytes;
}

describe('server OS account avatar fallback', () => {
  test.each(['png', 'jpeg', 'webp'] as const)(
    'normalizes real %s pixels without persisting or leaking the source',
    async (format) => {
      writeFileSync(join(home, '.face'), await sharp(png).toFormat(format).toBuffer());
      const s = bootServer();
      await fillSystemAvatar(s.user);
      await decoded(s.user.avatarUrl);
      expect(s.db.select().from(userTable).get()?.avatarUrl).toBeNull();
      for (const path of ['/api/user/me', `/api/teams/${s.team.id}/members`]) {
        const response = await req(s.app, 'GET', path);
        expect(response.status).toBe(200);
        const body = JSON.stringify(await response.json());
        expect(body).toContain(s.user.avatarUrl);
        expect(body).not.toContain(home);
      }
      const renamed = await req(s.app, 'PATCH', '/api/user/me', { displayName: 'Renamed owner' });
      const receipt = (await renamed.json()) as { avatarUrl: string | null };
      expect(receipt.avatarUrl).toBe(s.user.avatarUrl);
      expect(s.db.select().from(userTable).get()?.avatarUrl).toBeNull();
    },
  );

  test('preserves any existing avatar and never queries the operating system', async () => {
    const s = bootServer();
    s.db.update(userTable).set({ avatarUrl: 'https://example.test/custom.png' }).run();
    const restarted = bootServer({ db: s.db });
    vi.mocked(userInfo).mockClear();
    await fillSystemAvatar(restarted.user);
    expect(restarted.user.avatarUrl).toBe('https://example.test/custom.png');
    expect(userInfo).not.toHaveBeenCalled();
    expect(s.db.select().from(userTable).get()?.avatarUrl).toBe(restarted.user.avatarUrl);
    const response = await req(restarted.app, 'GET', '/api/user/me');
    expect(await response.json()).toMatchObject({ avatarUrl: 'https://example.test/custom.png' });
  });

  test.each([2, 3, 4, 5, 6, 7, 8])(
    'honors EXIF orientation %s before stripping metadata',
    async (orientation) => {
      const photo = await sharp(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]), {
        raw: { width: 2, height: 2, channels: 3 },
      })
        .resize(317, 179, { kernel: 'nearest' })
        .withMetadata({ orientation })
        .jpeg({ quality: 95 })
        .toBuffer();
      writeFileSync(join(home, '.face'), photo);
      const owner = { avatarUrl: null as string | null };
      await fillSystemAvatar(owner);
      expect(owner.avatarUrl).not.toBeNull();
      const actual = await sharp(Buffer.from(owner.avatarUrl?.split(',')[1] ?? '', 'base64'))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const expected = await sharp(photo)
        .autoOrient()
        .resize(128, 128, { fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([actual.info.width, actual.info.height]).toEqual([
        expected.info.width,
        expected.info.height,
      ]);
      for (const x of [0.25, 0.75])
        for (const y of [0.25, 0.75]) {
          const offset =
            (Math.floor(actual.info.height * y) * actual.info.width +
              Math.floor(actual.info.width * x)) *
            3;
          for (let channel = 0; channel < 3; channel++) {
            expect(
              Math.abs(
                (actual.data[offset + channel] ?? 0) - (expected.data[offset + channel] ?? 0),
              ),
            ).toBeLessThan(20);
          }
        }
    },
  );

  test('a dimension-bearing corrupt photo does not break later Coordinator images', async () => {
    writeFileSync(join(home, '.face'), png.subarray(0, 40));
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
    const result = await prepareCoordinatorImage(png.toString('base64'), 'image/png');
    expect(result.mimeType).toBe('image/png');
    expect(await sharp(Buffer.from(result.data, 'base64')).metadata()).toMatchObject({
      width: 317,
      height: 179,
    });
  });

  test('Linux falls through an invalid .face to its own AccountsService icon', async () => {
    writeFileSync(join(home, '.face'), 'invalid first candidate');
    const fallback = join(home, 'system-icon.png');
    writeFileSync(fallback, png);
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(openSync).mockImplementation((path, flags, mode) =>
      actual.openSync(
        path === '/var/lib/AccountsService/icons/avatar-test' ? fallback : path,
        flags,
        mode,
      ),
    );
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    await decoded(owner.avatarUrl);
  });

  test('retries a missing photo at the next startup and drops a removed automatic photo', async () => {
    const s = bootServer();
    await fillSystemAvatar(s.user);
    expect(s.user.avatarUrl).toBeNull();
    writeFileSync(join(home, '.face'), png);
    const restarted = bootServer({ db: s.db });
    await fillSystemAvatar(restarted.user);
    await decoded(restarted.user.avatarUrl);
    rmSync(join(home, '.face'));
    const removed = bootServer({ db: s.db });
    await fillSystemAvatar(removed.user);
    expect(removed.user.avatarUrl).toBeNull();
  });

  test.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>')],
    ['HTML', Buffer.from('<html>not an image</html>')],
    ['corrupt raster', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['oversize bytes', Buffer.alloc(2 * 1024 * 1024 + 1, 0xff)],
  ])('falls back to initials for %s', async (_name, bytes) => {
    writeFileSync(join(home, '.face'), bytes);
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
  });

  test('rejects directories and excessive decoded pixels', async () => {
    const owner = { avatarUrl: null as string | null };
    mkdirSync(join(home, '.face'));
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
    rmSync(join(home, '.face'), { recursive: true });
    writeFileSync(
      join(home, '.face'),
      await sharp({
        create: { width: 4001, height: 4000, channels: 3, background: '#112244' },
      })
        .png()
        .toBuffer(),
    );
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
  });

  test('never exposes an animated source or its metadata to the browser', async () => {
    const animation = await sharp(
      Buffer.concat([Buffer.alloc(317 * 179 * 3, 60), Buffer.alloc(317 * 179 * 3, 180)]),
      {
        raw: { width: 317, height: 358, pageHeight: 179, channels: 3 },
      },
    )
      .webp({ loop: 0, delay: [80, 100] })
      .toBuffer();
    expect((await sharp(animation).metadata()).pages).toBe(2);
    writeFileSync(join(home, '.face'), animation);
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    if (owner.avatarUrl !== null) {
      const metadata = await sharp(await decoded(owner.avatarUrl)).metadata();
      expect(metadata.pages ?? 1).toBe(1);
    }
  });

  test('missing account lookup and unsupported platforms do not prevent startup', async () => {
    vi.mocked(userInfo).mockImplementation(() => {
      throw new Error('private account path');
    });
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
    vi.mocked(platform).mockReturnValue('freebsd');
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
  });

  test('macOS uses binary JPEGPhoto before its Picture path', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(execFileSync).mockImplementation((file, args) => {
      if (file === '/usr/bin/dscl') return Buffer.from('platform plist fixture');
      if (file === '/usr/bin/plutil' && args?.includes('dsAttrTypeStandard:JPEGPhoto.0')) {
        return Buffer.from(png.toString('base64'));
      }
      throw new Error('Picture must not be read when JPEGPhoto works');
    });
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    await decoded(owner.avatarUrl);
  });

  test('macOS falls back from invalid JPEGPhoto to a local Picture path and handles command failure', async () => {
    vi.mocked(platform).mockReturnValue('darwin');
    const path = join(home, '头像.png');
    writeFileSync(path, png);
    vi.mocked(execFileSync).mockImplementation((file, args) => {
      if (file === '/usr/bin/dscl') return Buffer.from('platform plist fixture');
      if (args?.includes('dsAttrTypeStandard:JPEGPhoto.0')) return Buffer.from('aW52YWxpZA==');
      if (args?.includes('dsAttrTypeStandard:Picture.0')) return Buffer.from(`${path}\n`);
      throw new Error('unavailable');
    });
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    await decoded(owner.avatarUrl);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('unavailable');
    });
    const missing = { avatarUrl: null as string | null };
    await fillSystemAvatar(missing);
    expect(missing.avatarUrl).toBeNull();
  });

  test('Windows ignores UNC paths and queries only its own SID without shell interpolation', async () => {
    vi.mocked(platform).mockReturnValue('win32');
    vi.mocked(execFileSync).mockReturnValue(
      Buffer.from(JSON.stringify(['\\\\remote\\private.png'])),
    );
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    expect(owner.avatarUrl).toBeNull();
    const command = vi.mocked(execFileSync).mock.calls[0];
    expect(command?.[1]).toContain('-NoProfile');
    expect(command?.[1]).toContain('-NonInteractive');
    expect(command?.[1]?.join(' ')).toContain('WindowsIdentity]::GetCurrent().User.Value');
    expect(command?.[2]).toMatchObject({ timeout: 2000, windowsHide: true });
  });

  test('Windows decodes a non-ASCII local path and falls back on a failed registry query', async () => {
    vi.mocked(platform).mockReturnValue('win32');
    const path = 'C:\\AccountPictures\\头像.png';
    const local = join(home, 'windows-photo.png');
    writeFileSync(local, png);
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(JSON.stringify([path])));
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(openSync).mockImplementation((file, flags, mode) =>
      actual.openSync(file === path ? local : file, flags, mode),
    );
    const owner = { avatarUrl: null as string | null };
    await fillSystemAvatar(owner);
    await decoded(owner.avatarUrl);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('registry unavailable');
    });
    const missing = { avatarUrl: null as string | null };
    await fillSystemAvatar(missing);
    expect(missing.avatarUrl).toBeNull();
  });
});
