export const MAX_LINES = 800;
export const MAX_FILES = 40;

export function sizeFacts(numstat) {
  const rows = numstat.split('\n').filter(Boolean);
  const lines = rows.reduce((sum, row) => {
    const [added, removed] = row.split('\t');
    return sum + (Number(added) || 0) + (Number(removed) || 0);
  }, 0);
  return {
    lines,
    files: rows.length,
    oversize: lines > MAX_LINES || rows.length > MAX_FILES,
  };
}

export function sizeFactsLine({ lines, files, oversize }) {
  const counted = `${lines} lines, ${files} files outside docs/verify (limits ${MAX_LINES} lines, ${MAX_FILES} files)`;
  return oversize
    ? `Size: OVERSIZE, ${counted}. Answer item 5 under a line starting "Why is it this big:".`
    : `Size: within limits, ${counted}.`;
}
