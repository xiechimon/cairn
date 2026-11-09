import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

const workspaceRootSchema = z.object({ workspacesDir: z.string().refine(isAbsolute) }).strict();

export function localWorkspaceRoot(homeDir: string, defaultRoot: string): string {
  let fd: number;
  try {
    fd = openSync(join(homeDir, 'workspace-root.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultRoot;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > 16 * 1024 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid())
    ) {
      throw new Error('unsafe local workspace root state');
    }
    return workspaceRootSchema.parse(JSON.parse(readFileSync(fd, 'utf8'))).workspacesDir;
  } finally {
    closeSync(fd);
  }
}
