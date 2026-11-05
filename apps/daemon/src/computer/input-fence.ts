import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ComputerInputLease {
  release(): void;
}

export class ComputerInputFence {
  private pinnedOwnerId: string | undefined;

  constructor(
    private readonly directory: string,
    private readonly ownerId: string | (() => string),
  ) {}

  async acquire(scopeKey: string, signal?: AbortSignal): Promise<ComputerInputLease> {
    signal?.throwIfAborted();
    if (process.platform !== 'linux')
      throw new Error('Computer input ownership requires Linux file locks');
    if (scopeKey.length === 0) throw new Error('Computer input scope is empty');
    if (this.pinnedOwnerId === undefined) {
      const ownerId = typeof this.ownerId === 'function' ? this.ownerId() : this.ownerId;
      if (typeof ownerId !== 'string' || ownerId.trim().length === 0 || ownerId.length > 256)
        throw new Error('Computer input ownership requires an enrolled machine identity');
      this.pinnedOwnerId = ownerId;
    }
    const directory = lstatSync(this.directory);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid?.() ||
      (directory.mode & 0o7777) !== 0o700 ||
      realpathSync(this.directory) !== resolve(this.directory)
    )
      throw new Error('Computer input lock directory must be private and owned by the daemon');
    const name = `${createHash('sha256')
      .update(JSON.stringify([this.pinnedOwnerId, scopeKey]))
      .digest('hex')}.lock`;
    const path = join(this.directory, name);
    const descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      const file = fstatSync(descriptor);
      const current = lstatSync(path);
      if (
        !file.isFile() ||
        file.uid !== process.getuid?.() ||
        file.nlink !== 1 ||
        (file.mode & 0o7777) !== 0o600 ||
        current.ino !== file.ino ||
        current.dev !== file.dev
      )
        throw new Error('Computer input lock must be a private file owned by the daemon');
      const deadline = AbortSignal.timeout(3_000);
      const acquisitionSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const status = await new Promise<number | null>((accept, reject) => {
        const child = spawn('/usr/bin/flock', ['-n', '-E', '75', '3'], {
          stdio: ['ignore', 'ignore', 'ignore', descriptor],
          signal: acquisitionSignal,
        });
        child.once('error', reject);
        child.once('exit', accept);
      });
      acquisitionSignal.throwIfAborted();
      if (status === 75) throw new Error('Computer already has an input owner');
      if (status !== 0) throw new Error('Unable to acquire computer input ownership');
    } catch (error) {
      closeSync(descriptor);
      throw error;
    }
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        closeSync(descriptor);
      },
    };
  }
}
