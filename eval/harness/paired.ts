/**
 * Paired binary decision over the exam's per-case outcomes.
 *
 * A case votes once. `W` counts candidate-only passes, `L` baseline-only
 * passes; both arms passing or both failing is a tie that counts toward `n`
 * but not toward the sign test. The rule is the plan's: keep only when the
 * paired effect is at least ten percentage points and the one-sided exact
 * McNemar probability of `W` or more wins is at most 0.05.
 */

export const MIN_EFFECT = 0.1;
export const MAX_P = 0.05;

export interface Pair {
  caseId: string;
  baseline: boolean;
  candidate: boolean;
}

export interface Decision {
  kind: 'keep' | 'discard' | 'invalid';
  n: number;
  wins: number;
  losses: number;
  ties: number;
  effect: number;
  p: number;
  reason: string;
}

function binomialProbability(trials: number, successes: number, p: number): number {
  if (successes < 0 || successes > trials) return 0;
  let choose = 1;
  for (let i = 0; i < successes; i += 1) choose *= (trials - i) / (i + 1);
  return choose * p ** successes * (1 - p) ** (trials - successes);
}

/** One-sided exact McNemar: P(X >= wins) with X ~ Binomial(wins + losses, 0.5). */
export function mcnemarOneSided(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 1;
  let p = 0;
  for (let k = wins; k <= total; k += 1) p += binomialProbability(total, k, 0.5);
  return Math.min(1, p);
}

export function decide(pairs: readonly Pair[]): Decision {
  const n = pairs.length;
  if (n === 0)
    return {
      kind: 'invalid',
      n: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      effect: 0,
      p: 1,
      reason: 'no pairs',
    };
  let wins = 0;
  let losses = 0;
  for (const pair of pairs) {
    if (pair.candidate && !pair.baseline) wins += 1;
    else if (!pair.candidate && pair.baseline) losses += 1;
  }
  const ties = n - wins - losses;
  const effect = (wins - losses) / n;
  const p = mcnemarOneSided(wins, losses);
  if (wins <= losses)
    return {
      kind: 'discard',
      n,
      wins,
      losses,
      ties,
      effect,
      p,
      reason: `paired effect ${(effect * 100).toFixed(1)} points, ${wins}W/${losses}L`,
    };
  if (effect + 1e-12 < MIN_EFFECT)
    return {
      kind: 'discard',
      n,
      wins,
      losses,
      ties,
      effect,
      p,
      reason: `effect ${(effect * 100).toFixed(1)} points is below the 10-point floor`,
    };
  if (p > MAX_P)
    return {
      kind: 'discard',
      n,
      wins,
      losses,
      ties,
      effect,
      p,
      reason: `p=${p.toFixed(4)} above 0.05 at ${wins}W/${losses}L`,
    };
  return {
    kind: 'keep',
    n,
    wins,
    losses,
    ties,
    effect,
    p,
    reason: `effect ${(effect * 100).toFixed(1)} points, ${wins}W/${losses}L, p=${p.toFixed(4)}`,
  };
}

/**
 * Power of this decision for a plain paired scenario: each case's arms
 * disagree with probability `discordance`, and of the disagreeing cases the
 * fraction `candidateShare` favour the candidate. Exact over the two
 * binomials, so it needs no simulation and repeats identically.
 */
export function powerAt(
  n: number,
  discordance: number,
  candidateShare: number,
  options: { minEffect?: number; maxP?: number } = {},
): number {
  const minEffect = options.minEffect ?? MIN_EFFECT;
  const maxP = options.maxP ?? MAX_P;
  let power = 0;
  for (let b = 0; b <= n; b += 1) {
    const pB = binomialProbability(n, b, discordance);
    if (pB === 0) continue;
    for (let w = 0; w <= b; w += 1) {
      const pW = binomialProbability(b, w, candidateShare);
      const losses = b - w;
      const effect = (w - losses) / n;
      if (w <= losses) continue;
      if (effect + 1e-12 < minEffect) continue;
      if (mcnemarOneSided(w, losses) > maxP) continue;
      power += pB * pW;
    }
  }
  return power;
}

/** Share of pairs whose two arms disagree: the A/A noise this exam actually carries. */
export function discordance(pairs: readonly Pair[]): number {
  if (pairs.length === 0) return 0;
  return pairs.filter((pair) => pair.baseline !== pair.candidate).length / pairs.length;
}

export function passRate(outcomes: readonly boolean[]): number {
  if (outcomes.length === 0) return 0;
  return outcomes.filter(Boolean).length / outcomes.length;
}
