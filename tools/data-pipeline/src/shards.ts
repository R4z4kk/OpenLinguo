export const toShards = (
  name: string,
  rows: readonly unknown[],
  size: number,
): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  for (let start = 0; start < rows.length; start += size) {
    const lines = rows.slice(start, start + size).map((row) => JSON.stringify(row));
    const index = String(start / size).padStart(3, "0");
    files.set(`${name}-${index}.json`, `[\n${lines.join(",\n")}\n]\n`);
  }
  return files;
};
