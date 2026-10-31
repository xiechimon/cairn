import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const defaultPackage = JSON.parse(
  readFileSync(new URL('../../../apps/daemon/package.json', import.meta.url), 'utf8'),
).name;
const exactVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function daemonPackage({ entry, packageName = defaultPackage, version } = {}) {
  if (!packagePattern.test(packageName)) throw new Error('Invalid daemon package name');
  if (version === undefined || version === '') {
    if (!entry) throw new Error('Cannot find host daemon entry; set CAIRN_ORB_DAEMON_VERSION');
    let directory = dirname(realpathSync(entry));
    while (true) {
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (manifest) {
        if (manifest.name !== packageName) throw new Error('Host daemon package name mismatch');
        version = manifest.version;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error('Cannot find host daemon package metadata');
      directory = parent;
    }
  }
  if (typeof version !== 'string' || !exactVersion.test(version))
    throw new Error('Cannot pin exact daemon version');
  return { name: packageName, version };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const pin = daemonPackage({
    entry: process.argv[2],
    packageName: process.argv[3] || undefined,
    version: process.argv[4] || undefined,
  });
  console.log(`${pin.name} ${pin.version}`);
}
