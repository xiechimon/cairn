import { parseDocument } from 'yaml';

export function parseYamlMapping(text: string): Record<string, unknown> {
  const doc = parseDocument(text, { version: '1.2', schema: 'core', prettyErrors: false });
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]?.message ?? 'yaml parse error');
  }
  if (doc.contents === null) return {};
  const value: unknown = doc.toJS();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('yaml root must be a mapping');
  }
  return value as Record<string, unknown>;
}
