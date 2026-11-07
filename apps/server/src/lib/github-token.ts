export type AppToken = string & { readonly __githubTokenKind: 'app' };
export type UserToken = string & { readonly __githubTokenKind: 'user' };

export function tokenValue(token: AppToken | UserToken): string {
  return token;
}
