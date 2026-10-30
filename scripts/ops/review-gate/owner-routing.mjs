export function loadPolicy(source) {
  const start = source.indexOf('const AUTO_MERGE = [');
  const end = source.indexOf('const FILES_CMD =');
  if (start < 0 || end <= start)
    throw new Error('Cannot load the standalone workflow routing policy');
  const policy = new Function(
    `${source.slice(start, end)}; return { ownerRouting, isProtected, globToRegExp };`,
  )();
  if (Object.values(policy).some((value) => typeof value !== 'function'))
    throw new Error('Unsupported routing policy shape');
  return policy;
}
