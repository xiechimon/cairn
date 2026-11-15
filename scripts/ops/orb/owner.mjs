import * as fs from 'node:fs';

export const ORB_OWNER_FILE = '/etc/cairn-orb/owner';

const OWNER_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;

export function validOwnerName(name) {
  return typeof name === 'string' && OWNER_NAME.test(name);
}

export function readOrbOwner({ path = ORB_OWNER_FILE, io = fs } = {}) {
  let content;
  try {
    content = io.readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read the orb owner file ${path} (${error.code ?? error.message}); run install-host.sh as root first`,
    );
  }
  const name = content.replace(/\n$/, '');
  if (!validOwnerName(name))
    throw new Error(`Invalid orb owner in ${path}; run install-host.sh as root to rewrite it`);
  return name;
}
