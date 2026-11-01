export function sizeFacts(numstat, { maxLines, maxFiles }) {
  if (!Number.isInteger(maxLines) || maxLines <= 0 || !Number.isInteger(maxFiles) || maxFiles <= 0)
    throw new Error('size-facts: limits must be the positive integers of merge-gate-paths.json');
  const rows = numstat.split('\n').filter(Boolean);
  const lines = rows.reduce((sum, row) => {
    const [added, removed] = row.split('\t');
    return sum + (Number(added) || 0) + (Number(removed) || 0);
  }, 0);
  return {
    lines,
    files: rows.length,
    oversize: lines > maxLines || rows.length > maxFiles,
    maxLines,
    maxFiles,
  };
}

export function sizeFactsLine({ lines, files, oversize, maxLines, maxFiles }) {
  const counted = `${lines} lines, ${files} files outside docs/verify (limits ${maxLines} lines, ${maxFiles} files)`;
  return oversize
    ? `Size: OVERSIZE, ${counted}. Answer item 5 under a line starting "Why is it this big:".`
    : `Size: within limits, ${counted}.`;
}
