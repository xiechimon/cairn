export function isGithubRepositoryFullName(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner, repository] = parts;
  return (
    owner.length <= 39 &&
    /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(owner) &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(repository) &&
    repository !== '.' &&
    repository !== '..'
  );
}

export function permissionKey(permissions) {
  return Object.keys(permissions)
    .sort()
    .map((name) => `${name}:${permissions[name]}`)
    .join(',');
}

export function appTokenScopeKey(owner, repository, repositoryId, permissions) {
  return JSON.stringify([
    `${owner}/${repository}`.toLowerCase(),
    repositoryId ?? null,
    permissionKey(permissions),
  ]);
}
