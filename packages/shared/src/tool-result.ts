export function toolResultText(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === 'string') return result === '' ? null : result;
  if (Array.isArray(result)) {
    const joined = result
      .map(toolResultText)
      .filter((s): s is string => s != null && s !== '')
      .join('\n');
    return joined === '' ? null : joined;
  }
  if (typeof result === 'object') {
    const o = result as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text === '' ? null : o.text;
    for (const key of ['content', 'output', 'stdout', 'result'] as const) {
      if (o[key] !== undefined) {
        const nested = toolResultText(o[key]);
        if (nested != null && nested !== '') return nested;
      }
    }
  }
  return null;
}

export function toolResultValue(result: unknown): unknown {
  const value = Array.isArray(result) ? toolResultText(result) : result;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
