export type RowDiff = { readonly added: number; readonly removed: number };

const countRows = (shards: Iterable<string>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const shard of shards) {
    for (const line of shard.split("\n")) {
      if (line === "[" || line === "]" || line === "") continue;
      const row = line.endsWith(",") ? line.slice(0, -1) : line;
      counts.set(row, (counts.get(row) ?? 0) + 1);
    }
  }
  return counts;
};

const surplus = (from: Map<string, number>, against: Map<string, number>): number => {
  let total = 0;
  for (const [row, count] of from) {
    total += Math.max(0, count - (against.get(row) ?? 0));
  }
  return total;
};

export const diffRows = (before: Iterable<string>, after: Iterable<string>): RowDiff => {
  const old = countRows(before);
  const next = countRows(after);
  return { added: surplus(next, old), removed: surplus(old, next) };
};
