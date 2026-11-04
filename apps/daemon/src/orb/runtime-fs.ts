import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export function readOrbFile(directory: string, filename: string, maxBytes: number): Buffer {
  if (!filename || basename(filename) !== filename || filename === '.' || filename === '..')
    throw new Error('Invalid orb filename');
  const parent = lstatSync(directory);
  if (!parent.isDirectory()) throw new Error('Orb file parent must be a real directory');
  const parentDescriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedParent = fstatSync(parentDescriptor);
    if (parent.dev !== openedParent.dev || parent.ino !== openedParent.ino)
      throw new Error('Orb file parent changed before reading');
    const path = join(
      process.platform === 'linux' ? `/proc/self/fd/${parentDescriptor}` : directory,
      filename,
    );
    const before = lstatSync(path);
    if (!before.isFile() || before.nlink !== 1)
      throw new Error('Orb file must be a regular file with one link');
    if (before.size > maxBytes) throw new Error('Orb file exceeds size cap');
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Orb file must be a regular file with one link');
      if (stat.dev !== before.dev || stat.ino !== before.ino)
        throw new Error('Orb file changed before reading');
      if (stat.size > maxBytes) throw new Error('Orb file exceeds size cap');
      const currentParent = lstatSync(directory);
      if (
        !currentParent.isDirectory() ||
        currentParent.dev !== openedParent.dev ||
        currentParent.ino !== openedParent.ino
      )
        throw new Error('Orb file parent changed before reading');
      const content = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < content.length) {
        const size = readSync(descriptor, content, offset, content.length - offset, offset);
        if (size === 0) break;
        offset += size;
      }
      const after = fstatSync(descriptor);
      if (
        offset !== stat.size ||
        after.nlink !== 1 ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs
      )
        throw new Error('Orb file changed while reading');
      return content.subarray(0, offset);
    } finally {
      closeSync(descriptor);
    }
  } finally {
    closeSync(parentDescriptor);
  }
}

export function cleanOrbOutbox(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor);
    const current = () => {
      const metadata = lstatSync(directory, { throwIfNoEntry: false });
      return metadata?.isDirectory() && metadata.dev === opened.dev && metadata.ino === opened.ino;
    };
    const path = process.platform === 'linux' ? `/proc/self/fd/${descriptor}` : directory;
    for (const name of readdirSync(path)) {
      try {
        if (!current()) return;
        const entry = join(path, name);
        const metadata = lstatSync(entry, { throwIfNoEntry: false });
        if (metadata && !metadata.isDirectory()) unlinkSync(entry);
      } catch {}
    }
    if (current()) rmdirSync(directory);
  } catch {
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
