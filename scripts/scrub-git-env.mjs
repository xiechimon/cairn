const REPO_BINDING =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES)$/;

export function scrubGitEnv(env = process.env) {
  for (const key of Object.keys(env)) if (REPO_BINDING.test(key)) delete env[key];
  return env;
}

export function scrubGateEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/_BASE_SHA$/.test(key) && key !== 'PREPUSH_FORCE_FULL'),
  );
}
