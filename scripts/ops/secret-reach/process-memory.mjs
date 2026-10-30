import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function memoryAddress(maps) {
  for (const line of maps.split('\n')) {
    const match = /^([0-9a-f]+)-[0-9a-f]+ r/.exec(line);
    if (!match) continue;
    const address = Number.parseInt(match[1], 16);
    if (Number.isSafeInteger(address) && address > 0) return address;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pid = process.argv[2];
  if (!/^[1-9][0-9]*$/.test(pid ?? '')) process.exit(2);
  let address;
  try {
    address = memoryAddress(readFileSync(`/proc/${pid}/maps`, 'utf8'));
  } catch (error) {
    console.log(['EACCES', 'EPERM'].includes(error.code) ? 'BLOCKED' : 'SKIPPED');
    process.exit(0);
  }
  if (address === null) {
    console.log('SKIPPED');
  } else {
    let fd;
    try {
      fd = openSync(`/proc/${pid}/mem`, 'r');
      console.log(readSync(fd, Buffer.alloc(1), 0, 1, address) === 1 ? 'READ' : 'SKIPPED');
    } catch (error) {
      console.log(['EACCES', 'EPERM'].includes(error.code) ? 'BLOCKED' : 'SKIPPED');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}
