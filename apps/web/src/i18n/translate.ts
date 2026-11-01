import type { Locale } from './locale.js';

export type TVars = Record<string, string | number>;

/** Call-site signature the components consume (bound to locale + dict by
 *  the provider). */
export type TFunc = (source: string, vars?: TVars) => string;

const englishCardinals = new Intl.PluralRules('en');

export function translate(
  locale: Locale,
  dict: Record<string, string>,
  source: string,
  vars?: TVars,
): string {
  const template = locale === 'zh' ? source : (dict[source] ?? source);
  if (vars == null) return template;
  return template.replace(
    /\{(\w+)(?:#([^|}]*)\|([^}]*))?\}/g,
    (match, name: string, one: string | undefined, many: string | undefined) => {
      if (!Object.hasOwn(vars, name)) return match;
      const value = vars[name];
      if (one === undefined || many === undefined) return String(value);
      return (
        typeof value === 'number' && englishCardinals.select(value) === 'one' ? one : many
      ).replaceAll('#', String(value));
    },
  );
}
