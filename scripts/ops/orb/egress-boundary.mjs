import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export function inspectEgressBoundary(
  socketPath,
  { uid = process.getuid(), stat = lstatSync, entries = readdirSync, realpath = realpathSync } = {},
) {
  const directory = dirname(socketPath);
  const refused = (reason) => ({ ok: false, directory, reason });
  if (
    !isAbsolute(socketPath) ||
    resolve(socketPath) !== socketPath ||
    !/^cairn-orb-egress(?:-[a-z0-9-]{1,64})?$/.test(basename(directory))
  )
    return refused('not-dedicated');
  try {
    const parent = stat(directory);
    const socket = stat(socketPath);
    if (!parent || !socket) return refused('missing');
    if (parent.isSymbolicLink() || socket.isSymbolicLink() || realpath(directory) !== directory)
      return refused('symlink');
    if (!parent.isDirectory() || !socket.isSocket()) return refused('type');
    if (parent.uid !== uid || socket.uid !== uid) return refused('owner');
    if ((parent.mode & 0o777) !== 0o700 || (socket.mode & 0o777) !== 0o600) return refused('mode');
    const names = entries(directory);
    if (names.length !== 1 || names[0] !== basename(socketPath)) return refused('siblings');
    return { ok: true, directory, reason: 'ok' };
  } catch (error) {
    return refused(error.code === 'ENOENT' ? 'missing' : 'unreadable');
  }
}
