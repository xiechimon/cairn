export type Role = 'implement' | 'plan' | 'verify' | 'review' | 'coordinator' | 'citation';

export const FACTORS = {
  role: ['implement', 'plan', 'verify', 'review', 'coordinator', 'citation'],
  kind: ['persona', 'custom'],
  assigned: ['yes', 'no'],
  machine: ['none', 'native', 'orb-capability', 'orb-name'],
  caps: ['null', 'mcp', 'models', 'mcp+models', 'orb'],
  tools: ['none', 'push', 'all'],
  secrets: ['none', 'some'],
  mcp: ['none', 'some'],
  skills: ['null', 'empty', 'some'],
  defaultSkill: ['null', 'some'],
  fallback: ['null', 'some'],
  thinking: ['null', 'high'],
  existing: ['none', 'rule-and-policy', 'rule-only'],
  ruleMachine: ['null', 'pinned'],
  model: ['same-as-session', 'same-vendor', 'other-vendor'],
  secondReviewer: ['none', 'independent-custom'],
} as const;

export type FactorName = keyof typeof FACTORS;
export type Cell = { [K in FactorName]: (typeof FACTORS)[K][number] };

const NAMES = Object.keys(FACTORS) as FactorName[];

export function fullSize(): number {
  return NAMES.reduce((n, name) => n * FACTORS[name].length, 1);
}

function cellAt(index: number): Cell {
  const cell: Record<string, string> = {};
  let rest = index;
  for (const name of NAMES) {
    const values = FACTORS[name];
    cell[name] = values[rest % values.length] as string;
    rest = Math.floor(rest / values.length);
  }
  return cell as Cell;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

export function randomCells(count: number, seed: number): Cell[] {
  const next = seededRandom(seed);
  const total = fullSize();
  const out: Cell[] = [];
  for (let i = 0; i < count; i++) out.push(cellAt(next() % total));
  return out;
}

export function fullCrossProduct(limit: number, seed: number): Cell[] {
  const total = fullSize();
  if (limit >= total) return Array.from({ length: total }, (_, i) => cellAt(i));
  return randomCells(limit, seed);
}

export function pairwiseCells(seed: number): Cell[] {
  const next = seededRandom(seed);
  const sizes = NAMES.map((name) => FACTORS[name].length);
  const key = (a: number, va: number, b: number, vb: number) => `${a}:${va}|${b}:${vb}`;
  const uncovered = new Set<string>();
  for (let a = 0; a < NAMES.length; a++)
    for (let b = a + 1; b < NAMES.length; b++)
      for (let va = 0; va < (sizes[a] as number); va++)
        for (let vb = 0; vb < (sizes[b] as number); vb++) uncovered.add(key(a, va, b, vb));
  const rows: number[][] = [];
  while (uncovered.size > 0) {
    let best: number[] = [];
    let bestScore = -1;
    for (let t = 0; t < 300; t++) {
      const row = sizes.map((size) => next() % size);
      let score = 0;
      for (let a = 0; a < NAMES.length; a++)
        for (let b = a + 1; b < NAMES.length; b++)
          if (uncovered.has(key(a, row[a] as number, b, row[b] as number))) score++;
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
    for (let a = 0; a < NAMES.length; a++)
      for (let b = a + 1; b < NAMES.length; b++)
        uncovered.delete(key(a, best[a] as number, b, best[b] as number));
    rows.push(best);
  }
  return rows.map(
    (row) =>
      Object.fromEntries(
        NAMES.map((name, i) => [name, FACTORS[name][row[i] as number]]),
      ) as unknown as Cell,
  );
}

const BASE: Cell = {
  role: 'implement',
  kind: 'custom',
  assigned: 'yes',
  machine: 'none',
  caps: 'null',
  tools: 'none',
  secrets: 'none',
  mcp: 'none',
  skills: 'null',
  defaultSkill: 'null',
  fallback: 'null',
  thinking: 'null',
  existing: 'none',
  ruleMachine: 'null',
  model: 'other-vendor',
  secondReviewer: 'none',
};

export const NAMED_CELLS: Record<string, Cell> = {
  'orb machine by capability': { ...BASE, machine: 'orb-capability' },
  'orb machine by name': { ...BASE, machine: 'orb-name', caps: 'mcp' },
  'orb session rule with existing null caps': {
    ...BASE,
    machine: 'orb-capability',
    existing: 'rule-only',
  },
  'orb review rule': { ...BASE, role: 'review', machine: 'orb-name', model: 'other-vendor' },
  'mcp and model caps on an existing rule': {
    ...BASE,
    caps: 'mcp+models',
    existing: 'rule-only',
  },
  'machine fallback on an existing rule': {
    ...BASE,
    machine: 'native',
    existing: 'rule-and-policy',
    ruleMachine: 'null',
  },
  'reviewer on the same vendor': { ...BASE, role: 'review', kind: 'persona', model: 'same-vendor' },
  'reviewer on the same model': {
    ...BASE,
    role: 'review',
    kind: 'custom',
    model: 'same-as-session',
  },
  'reviewer on another vendor': {
    ...BASE,
    role: 'review',
    kind: 'persona',
    model: 'other-vendor',
    tools: 'all',
    secrets: 'some',
    mcp: 'some',
    skills: 'some',
  },
  'custom reviewer keeps its permissions': {
    ...BASE,
    role: 'review',
    kind: 'custom',
    model: 'other-vendor',
    mcp: 'some',
    skills: 'some',
    defaultSkill: 'some',
  },
  'assigned independent custom reviewer beside a same-vendor reviewer persona': {
    ...BASE,
    role: 'review',
    kind: 'persona',
    assigned: 'yes',
    model: 'same-vendor',
    secondReviewer: 'independent-custom',
  },
  'assigned custom reviewer with permissions and no default review policy': {
    ...BASE,
    role: 'review',
    kind: 'custom',
    assigned: 'yes',
    model: 'other-vendor',
    tools: 'all',
    secrets: 'some',
    mcp: 'some',
    skills: 'some',
    defaultSkill: 'some',
  },
  'existing coordinator rule with null capabilities and a different id': {
    ...BASE,
    role: 'coordinator',
    existing: 'rule-only',
    caps: 'mcp+models',
    machine: 'orb-capability',
    mcp: 'some',
  },
  'existing coordinator rule pinned to a machine': {
    ...BASE,
    role: 'coordinator',
    existing: 'rule-only',
    machine: 'native',
    ruleMachine: 'pinned',
  },
  'citation checker assigned on another vendor': {
    ...BASE,
    role: 'citation',
    assigned: 'yes',
    model: 'other-vendor',
  },
  'citation checker unassigned custom on another vendor': {
    ...BASE,
    role: 'citation',
    assigned: 'no',
    model: 'other-vendor',
  },
  'citation checker assigned on the same vendor': {
    ...BASE,
    role: 'citation',
    assigned: 'yes',
    model: 'same-vendor',
  },
  'citation checker unassigned on the same vendor': {
    ...BASE,
    role: 'citation',
    assigned: 'no',
    model: 'same-vendor',
  },
  'coordinator with MCP servers': {
    ...BASE,
    role: 'coordinator',
    mcp: 'some',
    model: 'other-vendor',
  },
  'coordinator on an orb machine': {
    ...BASE,
    role: 'coordinator',
    machine: 'orb-capability',
    caps: 'orb',
  },
  'plan agent beside an implementer': { ...BASE, role: 'plan', tools: 'all', secrets: 'some' },
  'verifier memories': { ...BASE, role: 'verify', kind: 'persona' },
};
