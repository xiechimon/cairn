const OFF_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off']);

export function routingRulesFlagOn(raw: string | undefined): boolean {
  return raw === undefined || !OFF_VALUES.has(raw.trim().toLowerCase());
}
