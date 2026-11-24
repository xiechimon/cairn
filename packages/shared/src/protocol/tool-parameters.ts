const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const MAX_DEPTH = 32;
const COMPOSITE_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;

function withDescription(
  node: Record<string, unknown>,
  description: unknown,
): Record<string, unknown> {
  return typeof description === 'string' ? { ...node, description } : node;
}

function resolveType(def: Record<string, unknown>): string {
  const raw = def.type;
  const usable = (Array.isArray(raw) ? raw : [raw]).filter(
    (entry): entry is string => typeof entry === 'string' && KNOWN_TYPES.has(entry),
  );
  const picked = usable.find((type) => type !== 'null') ?? usable[0];
  if (picked !== undefined) return picked;
  if (typeof def.properties === 'object' && def.properties !== null) return 'object';
  if (def.items !== undefined) return 'array';
  return 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeNode(node: unknown, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH || !isPlainObject(node)) return { type: 'string' };
  for (const key of COMPOSITE_KEYS) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      const first = branches.find(isPlainObject);
      if (first !== undefined) return sanitizeNode(first, depth + 1);
    }
  }
  const type = resolveType(node);
  if (type === 'object') {
    const sanitized: Record<string, unknown> = { type: 'object' };
    if (isPlainObject(node.properties)) {
      sanitized.properties = Object.fromEntries(
        Object.entries(node.properties).map(([key, sub]) => [key, sanitizeNode(sub, depth + 1)]),
      );
      const required = Array.isArray(node.required)
        ? node.required.filter((entry): entry is string => typeof entry === 'string')
        : [];
      if (required.length > 0) sanitized.required = required;
    }
    return withDescription(sanitized, node.description);
  }
  if (type === 'array') {
    return withDescription(
      { type: 'array', items: sanitizeNode(node.items, depth + 1) },
      node.description,
    );
  }
  return withDescription({ type }, node.description);
}

export function toolStringSchema(description: string): { type: 'string'; description: string } {
  return { type: 'string', description };
}

export function toolArraySchema(
  items: unknown,
  description: string,
): { type: 'array'; items: unknown; description: string } {
  return { type: 'array', items, description };
}

export function toolObjectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export function sanitizeToolParameters(inputSchema: unknown): Record<string, unknown> | undefined {
  if (inputSchema === undefined || inputSchema === null) return undefined;
  const node = sanitizeNode(inputSchema, 0);
  return node.type === 'object' ? node : { type: 'object' };
}
