import { z } from 'zod';

export const permissionActionSchema = z.enum(['allow', 'ask', 'reject']);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const permissionRuleSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  matches: z.record(z.string(), z.string()).optional(),
  action: permissionActionSchema,
  description: z.string().optional(),
});
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export function matchGlob(pattern: string, value: string): boolean {
  const parts = pattern.split('*');
  let from = 0;
  for (const part of parts) {
    if (part === '') continue;
    const hit = value.indexOf(part, from);
    if (hit === -1) return false;
    from = hit + part.length;
  }
  return true;
}

export function matchPermissionRule(
  rules: readonly PermissionRule[],
  toolName: string,
  params: Readonly<Record<string, string>>,
): PermissionRule | undefined {
  for (const rule of rules) {
    if (rule.tool !== '*' && rule.tool !== toolName) continue;
    const slots = rule.matches ?? {};
    let hit = true;
    for (const [slot, pattern] of Object.entries(slots)) {
      if (!matchGlob(pattern, params[slot] ?? '')) {
        hit = false;
        break;
      }
    }
    if (hit) return rule;
  }
  return undefined;
}
