import { devNull } from 'node:os';
import { bootServer } from './helpers.js';

export function bootStreamServer(options: { pingIntervalMs?: number } = {}) {
  return bootServer({
    ...options,
    reposDir: devNull,
    attachmentsDir: devNull,
    skillsDir: devNull,
    skillSourcesPath: devNull,
    homeDir: devNull,
    dataDir: devNull,
    workspacesDir: devNull,
  });
}
