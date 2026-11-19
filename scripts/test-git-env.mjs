import { scrubGitEnv } from './scrub-git-env.mjs';

export function testGitEnv(env = process.env) {
  return {
    ...scrubGitEnv(
      Object.fromEntries(
        Object.entries(env).filter(
          ([key]) => key !== 'GIT_CONFIG' && !key.startsWith('GIT_CONFIG_'),
        ),
      ),
    ),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
  };
}
