// Translation core (issue #74): the zh-CN source string IS the lookup key
// — zh renders are identity by construction (the e2e suite gates that),
// and en is a flat dict layered on top (01 S6: zh-CN 权威 + en 兜底). A
// source with no en entry falls back to the zh original, so a missed
// string degrades to mixed-language instead of blank. `{name}`
// placeholders interpolate into whichever template was selected.

import type { Locale } from './locale.js';

export type TVars = Record<string, string | number>;

/** Call-site signature the components consume (bound to locale + dict by
 *  the provider). */
export type TFunc = (source: string, vars?: TVars) => string;

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
      return (value === 1 ? one : many).replaceAll('#', String(value));
    },
  );
}
