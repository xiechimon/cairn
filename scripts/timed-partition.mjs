export function partitionByWeight(keys, weights, count) {
  const known = keys
    .map((key) => weights[key])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const fallback = Math.max(1, known[Math.floor(known.length / 2)] ?? 1);
  const items = keys
    .map((key) => ({ key, weight: Math.max(1, weights[key] ?? fallback) }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const bins = Array.from({ length: count }, () => ({ total: 0, keys: [] }));
  for (const item of items) {
    const lightest = bins.reduce((min, bin) => (bin.total < min.total ? bin : min));
    lightest.keys.push(item.key);
    lightest.total += item.weight;
  }
  return bins.map((bin) => bin.keys);
}
