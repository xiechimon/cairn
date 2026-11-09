export function normalizedRepoRef(url: string): string {
  let ref = url.trim();
  if (ref.endsWith('/')) ref = ref.slice(0, -1);
  if (ref.endsWith('.git')) ref = ref.slice(0, -4);
  const scp = /^([^@/]+)@([^:/]+):(.+)$/.exec(ref);
  if (scp) return `${scp[2]}/${scp[3]}`;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:([^@/]+)@)?([^/]+)\/(.+)$/i.exec(ref);
  if (scheme) return `${scheme[2]}/${scheme[3]}`;
  return ref;
}
