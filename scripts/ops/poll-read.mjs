import { spawnSync } from 'node:child_process';

/**
 * @template T
 * @typedef {{ kind: 'value', value: T } | { kind: 'unreadable', source: string }} ReadResult
 */

/**
 * @template T
 * @param {T} value
 * @returns {ReadResult<T>}
 */
export function readable(value) {
  return { kind: 'value', value };
}

/** @param {string} source @returns {ReadResult<never>} */
export function unreadable(source) {
  return { kind: 'unreadable', source };
}

export function commandReader(remaining = () => Infinity) {
  return (file, args, source, decode = (text) => text.trim(), statuses = [0]) => {
    const timeout = Math.min(30_000, Math.floor(remaining()));
    if (timeout <= 0) return unreadable(source);
    const result = spawnSync(file, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
    if (result.error || !statuses.includes(result.status)) return unreadable(source);
    try {
      const value = decode(result.stdout, result.status);
      return value === undefined ? unreadable(source) : readable(value);
    } catch {
      return unreadable(source);
    }
  };
}

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
