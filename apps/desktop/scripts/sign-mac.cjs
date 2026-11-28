const { closeSync, openSync, readSync, realpathSync, statSync } = require('node:fs');
const { basename, join, relative } = require('node:path');
const { signAsync } = require('@electron/osx-sign');

const MACH_O_MAGIC = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
]);

function isMachO(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && MACH_O_MAGIC.has(head.readUInt32BE(0));
  } finally {
    closeSync(fd);
  }
}

function signsOnItsOwn(app) {
  const appReal = realpathSync(app);
  const mainExecutable = join(appReal, 'Contents', 'MacOS', basename(app, '.app'));
  return (file) => {
    const real = realpathSync(file);
    if (real !== join(appReal, relative(app, file))) return false;
    if (statSync(real).isDirectory()) return true;
    return real !== mainExecutable && isMachO(real);
  };
}

exports.signsOnItsOwn = signsOnItsOwn;

exports.default = async function signWithCairnCertificate(options) {
  const signs = signsOnItsOwn(options.app);
  const ignore = (file) => !signs(file) || options.ignore(file);
  const identity = process.env.CAIRN_MAC_SIGN_IDENTITY;
  if (!identity) return signAsync({ ...options, ignore });
  return signAsync({
    ...options,
    ignore,
    identity,
    identityValidation: false,
    keychain: process.env.CAIRN_MAC_SIGN_KEYCHAIN,
  });
};
