export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}
