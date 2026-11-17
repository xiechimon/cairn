import type { FailFacts } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

export function failFactsText(facts: FailFacts | undefined, t: TFunc): string {
  if (facts === undefined) return '';
  return [
    facts.files !== null ? t('改动 {n} 个文件', { n: facts.files }) : null,
    facts.commits.length > 0 ? t('提交 {shas}', { shas: facts.commits.join(', ') }) : null,
    facts.pr !== null ? t('PR #{n}', { n: facts.pr }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
