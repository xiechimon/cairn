export function isGithubRepositoryFullName(value: unknown): value is string;

export function permissionKey(permissions: Readonly<Record<string, string>>): string;

export function appTokenScopeKey(
  owner: string,
  repository: string,
  repositoryId: number | undefined,
  permissions: Readonly<Record<string, string>>,
): string;
