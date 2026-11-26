const LIVING_LOCATIONS =
  /^(?:[^/]+\.md|docs\/[^/]+\.md|docs\/(?:spec|ops)\/.+\.md|docs\/design\/(?:tested-sha-landing|preflight-ci-verification)\.md|docs\/design\/surfaces\/[^/]+\.md|\.claude\/skills\/.+\.md|apps\/web\/DESIGN\.md)$/;
const SKILL_RECORDS =
  /^\.claude\/skills\/(?:.+\/)?(?:archive|changelog|references?|upstream|vendor)\//;
const CHANGELOG = /(?:^|\/)CHANGELOG\.md$/;
const GENERATED = new Set([
  'docs/CANON.md',
  'docs/feature-map.md',
  '.claude/skills/verify-cairn/feature-map.md',
]);
const RULES_ONLY = /^docs\/design\/surfaces\//;

export const isLivingDoc = (path) =>
  LIVING_LOCATIONS.test(path) &&
  !SKILL_RECORDS.test(path) &&
  !CHANGELOG.test(path) &&
  !GENERATED.has(path);

export function livingText(path, text) {
  if (!RULES_ONLY.test(path)) return text;
  let inRules = false;
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const mark = /^\s*(```|~~~)/.exec(line)?.[1];
      if (mark) fence = fence === null ? mark : fence === mark ? null : fence;
      if (fence === null && line.startsWith('## ')) inRules = line.trim() === '## Rules';
      return inRules ? line : '';
    })
    .join('\n');
}
