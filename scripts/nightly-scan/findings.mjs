export const SCAN_LABEL = 'found-by:nightly-scan';
export const NIGHTLY_ISSUE_CAP = 3;
const SEVERITIES = new Set(['high', 'medium']);
const KEY_RE = /<!-- nightly-scan:(\S+) -->/g;

export const bugClassSlug = (bugClass) =>
  String(bugClass)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const findingKey = (finding) => `${finding.file}::${bugClassSlug(finding.bugClass)}`;

export function parseFindings(text, sliceFiles) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end < start) return [];
  let raw;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(sliceFiles);
  const seen = new Set();
  const findings = [];
  for (const entry of raw) {
    const valid =
      entry &&
      allowed.has(entry.file) &&
      Number.isInteger(entry.line) &&
      SEVERITIES.has(entry.severity) &&
      ['bugClass', 'title', 'evidence'].every(
        (field) => typeof entry[field] === 'string' && entry[field].trim(),
      ) &&
      bugClassSlug(entry.bugClass) !== '';
    if (!valid) continue;
    const key = findingKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(entry);
  }
  return findings;
}

export function knownKeys(issueBodies) {
  const keys = new Set();
  for (const body of issueBodies)
    for (const match of String(body ?? '').matchAll(KEY_RE)) keys.add(match[1]);
  return keys;
}

export function planIssues(findings, known, cap = NIGHTLY_ISSUE_CAP) {
  const fresh = findings
    .filter((finding) => !known.has(findingKey(finding)))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
  return {
    create: fresh.slice(0, cap),
    deferred: fresh.slice(cap),
    duplicates: findings.length - fresh.length,
  };
}

export function issueFor(finding) {
  return {
    title: `nightly-scan: ${finding.title} (${finding.file})`,
    body: `${finding.evidence}\n\nLocation: \`${finding.file}:${finding.line}\`\nBug class: ${finding.bugClass}\nSeverity: ${finding.severity}\n\nFound by the nightly whole-repo review scan. It never blocks a PR; fix every instance of the class, not only this line.\n\n<!-- nightly-scan:${findingKey(finding)} -->`,
  };
}
