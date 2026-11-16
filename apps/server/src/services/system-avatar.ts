import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { createRequire as createAvatarRequire } from 'node:module';
import { platform, userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fliph,
  initSync,
  PhotonImage,
  resize,
  rotate,
  SamplingFilter,
} from '@silvia-odwyer/photon/photon_rs.js';
import { imageSize } from 'image-size';
import { BUNDLED_FORM } from '../bundle-form.js';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_OUTPUT_BYTES = 8 * 1024;
let initialized = false;

function readAvatarFile(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('invalid photo file');
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_INPUT_BYTES) throw new Error('photo is too large');
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

function command(file: string, args: string[], deadline: number, input?: Buffer): Buffer {
  const timeout = Math.min(2000, deadline - Date.now());
  if (timeout <= 0) throw new Error('photo query timed out');
  return execFileSync(file, args, {
    input,
    timeout,
    maxBuffer: 3 * MAX_INPUT_BYTES,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

function* avatarSources(): Generator<string | Buffer> {
  const account = userInfo();
  if (!account.username || /[/\\\0]/.test(account.username)) return;
  const deadline = Date.now() + 3000;
  switch (platform()) {
    case 'linux':
      yield join(account.homedir, '.face');
      yield join('/var/lib/AccountsService/icons', account.username);
      return;
    case 'darwin':
      for (const attribute of ['JPEGPhoto', 'Picture']) {
        try {
          const plist = command(
            '/usr/bin/dscl',
            ['-plist', '.', '-read', `/Users/${account.username}`, attribute],
            deadline,
          );
          const raw = command(
            '/usr/bin/plutil',
            ['-extract', `dsAttrTypeStandard:${attribute}.0`, 'raw', '-o', '-', '-'],
            deadline,
            plist,
          )
            .toString('utf8')
            .trim();
          if (attribute === 'JPEGPhoto') yield Buffer.from(raw, 'base64');
          else if (isAbsolute(raw)) yield raw;
        } catch {}
      }
      return;
    case 'win32': {
      const script = [
        '$ErrorActionPreference="Stop"',
        '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
        '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
        '$key="Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AccountPicture\\Users\\$sid"',
        '$values=Get-ItemProperty -LiteralPath $key',
        'ConvertTo-Json -Compress -InputObject @($values.Image448,$values.Image192,$values.Image96)',
      ].join(';');
      const paths: unknown = JSON.parse(
        command(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          deadline,
        ).toString('utf8'),
      );
      if (Array.isArray(paths)) {
        for (const path of paths) {
          if (typeof path === 'string' && /^[A-Za-z]:[\\/]/.test(path)) yield path;
        }
      }
    }
  }
}

function thumbnail(bytes: Buffer): string | null {
  if (bytes.length > MAX_INPUT_BYTES) return null;
  const info = imageSize(bytes);
  if (!['jpg', 'png', 'webp'].includes(info.type ?? '') || info.width * info.height > MAX_PIXELS)
    return null;
  if (!initialized) {
    const wasmPath = BUNDLED_FORM
      ? fileURLToPath(new URL('./photon_rs_bg.wasm', import.meta.url))
      : createAvatarRequire(import.meta.url).resolve('@silvia-odwyer/photon/photon_rs_bg.wasm');
    initSync({ module: readFileSync(wasmPath) });
    initialized = true;
  }
  const source = PhotonImage.new_from_byteslice(bytes);
  let oriented: PhotonImage | undefined;
  let scaled: PhotonImage | undefined;
  try {
    if ([2, 4, 5, 7].includes(info.orientation ?? 1)) fliph(source);
    const angleByOrientation: Record<number, number> = {
      3: 180,
      4: 180,
      5: 270,
      6: 90,
      7: 90,
      8: 270,
    };
    const angle = angleByOrientation[info.orientation ?? 1];
    if (angle !== undefined) oriented = rotate(source, angle);
    const image = oriented ?? source;
    const scale = Math.min(1, 128 / image.get_width(), 128 / image.get_height());
    scaled = resize(
      image,
      Math.max(1, Math.round(image.get_width() * scale)),
      Math.max(1, Math.round(image.get_height() * scale)),
      SamplingFilter.Lanczos3,
    );
    const webp = scaled.get_bytes_webp();
    if (webp.length <= MAX_OUTPUT_BYTES)
      return `data:image/webp;base64,${Buffer.from(webp).toString('base64')}`;
    for (const quality of [80, 60, 40]) {
      const jpeg = scaled.get_bytes_jpeg(quality);
      if (jpeg.length <= MAX_OUTPUT_BYTES)
        return `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;
    }
    return null;
  } finally {
    scaled?.free();
    oriented?.free();
    source.free();
  }
}

export async function fillSystemAvatar(owner: { avatarUrl: string | null }): Promise<void> {
  if (owner.avatarUrl !== null) return;
  try {
    for (const source of avatarSources()) {
      try {
        const result = thumbnail(typeof source === 'string' ? readAvatarFile(source) : source);
        if (result !== null) {
          owner.avatarUrl = result;
          return;
        }
      } catch {}
    }
  } catch {
    return;
  }
}
