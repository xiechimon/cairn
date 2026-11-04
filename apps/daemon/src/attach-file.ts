import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { ATTACHMENT_MAX_BYTES } from '@cairn/shared';

export function prepareFileAttachment(
  cwd: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof params.path !== 'string' || params.path.trim() === '' || params.path.includes('\0')) {
    throw new Error('attach_file requires a non-empty path');
  }
  if (
    params.caption !== undefined &&
    (typeof params.caption !== 'string' || params.caption.length > 2000)
  ) {
    throw new Error('attach_file caption must be a string of at most 2000 characters');
  }
  const root = realpathSync(cwd);
  const file = realpathSync(resolve(root, params.path));
  const within = relative(root, file);
  if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
    throw new Error('attach_file path is outside the step worktree');
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    const openedPath = realpathSync(file);
    const openedWithin = relative(root, openedPath);
    const current = statSync(openedPath);
    if (
      isAbsolute(openedWithin) ||
      openedWithin === '..' ||
      openedWithin.startsWith(`..${sep}`) ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino
    ) {
      throw new Error('attach_file path changed or is outside the step worktree');
    }
    if (!stat.isFile()) throw new Error('attach_file path must be a regular file');
    if (stat.size <= 0 || stat.size > ATTACHMENT_MAX_BYTES) {
      throw new Error('attach_file size must be 1 byte to the 10 MiB attachment cap');
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size !== stat.size)
      throw new Error('attach_file changed while reading; retry with a stable file');
    return {
      fileName: basename(file),
      ...(params.caption !== undefined ? { caption: params.caption } : {}),
      contentBase64: bytes.subarray(0, size).toString('base64'),
    };
  } finally {
    closeSync(fd);
  }
}
