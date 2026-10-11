import { err, ok, type Result } from "@openlinguo/core";

/** Integers beyond `Number.MAX_SAFE_INTEGER` stay exact as `bigint`. */
export type SqlValue = null | number | bigint | string | Uint8Array;

/** `rowid` is `null` for a WITHOUT ROWID table. */
export type SqlRow = {
  readonly rowid: number | bigint | null;
  readonly values: readonly SqlValue[];
};

export type SqliteFailure =
  | { readonly kind: "not-sqlite" }
  | { readonly kind: "corrupt-database"; readonly detail: string }
  | { readonly kind: "missing-table"; readonly table: string };

export type SqliteFile = {
  readonly tables: ReadonlySet<string>;
  /** Every row of a table, in key order. */
  readonly rows: (table: string) => Result<readonly SqlRow[], SqliteFailure>;
};

const HEADER = "SQLite format 3\0";
const UTF8 = 1;
const INTERIOR_INDEX = 0x02;
const INTERIOR_TABLE = 0x05;
const LEAF_INDEX = 0x0a;
const LEAF_TABLE = 0x0d;

const corrupt = (detail: string): never => {
  throw new Error(detail);
};

const exact = (value: bigint): number | bigint =>
  value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value;

/** Reads a database file in memory, per the SQLite file format (sqlite.org/fileformat.html). */
const parse = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawPageSize = view.getUint16(16);
  const pageSize = rawPageSize === 1 ? 65_536 : rawPageSize;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) corrupt("bad page size");
  if ((bytes[19] ?? 0) > 2) corrupt("unsupported file format version");
  if (view.getUint32(56) !== UTF8) corrupt("text is not UTF-8");
  const usable = pageSize - (bytes[20] ?? 0);
  const pageCount = Math.floor(bytes.length / pageSize);
  const text = new TextDecoder("utf-8", { fatal: true });

  const byteAt = (at: number): number => bytes[at] ?? corrupt("read past the end");

  /** A 1 to 9 byte big-endian varint. */
  const varint = (at: number): readonly [bigint, number] => {
    let value = 0n;
    for (let index = 0; index < 8; index++) {
      const byte = byteAt(at + index);
      value = (value << 7n) | BigInt(byte & 0x7f);
      if (byte < 0x80) return [value, at + index + 1];
    }
    return [(value << 8n) | BigInt(byteAt(at + 8)), at + 9];
  };

  const smallVarint = (at: number): readonly [number, number] => {
    const [value, next] = varint(at);
    return value > BigInt(bytes.length) ? corrupt("size out of range") : [Number(value), next];
  };

  const pageStart = (page: number): number =>
    page >= 1 && page <= pageCount ? (page - 1) * pageSize : corrupt(`no page ${String(page)}`);

  /** A cell's payload, its tail read from the overflow chain when it does not fit the page. */
  const payload = (at: number, size: number, index: boolean): Uint8Array => {
    const maxLocal = index ? Math.floor(((usable - 12) * 64) / 255) - 23 : usable - 35;
    if (size <= maxLocal) return bytes.subarray(at, at + size);
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    const spill = minLocal + ((size - minLocal) % (usable - 4));
    const local = spill <= maxLocal ? spill : minLocal;
    const out = new Uint8Array(size);
    out.set(bytes.subarray(at, at + local));
    let filled = local;
    let page = view.getUint32(at + local);
    const seen = new Set<number>();
    while (filled < size) {
      if (seen.has(page)) corrupt("overflow loop");
      seen.add(page);
      const start = pageStart(page);
      const length = Math.min(usable - 4, size - filled);
      out.set(bytes.subarray(start + 4, start + 4 + length), filled);
      filled += length;
      page = view.getUint32(start);
    }
    return out;
  };

  const integer = (data: Uint8Array, at: number, length: number): number | bigint => {
    let value = 0n;
    for (let index = 0; index < length; index++)
      value = (value << 8n) | BigInt(data[at + index] ?? corrupt("record too short"));
    const bits = BigInt(length * 8);
    return exact(value >= 1n << (bits - 1n) ? value - (1n << bits) : value);
  };

  const INTEGER_SIZES = [0, 1, 2, 3, 4, 6, 8];

  const record = (data: Uint8Array): SqlValue[] => {
    const fields = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0;
    const read = (): number => {
      let value = 0;
      for (let index = 0; index < 9; index++) {
        const byte = data[at++] ?? corrupt("record header too short");
        if (index === 8) return value * 256 + byte;
        value = value * 128 + (byte & 0x7f);
        if (byte < 0x80) return value;
      }
      return value;
    };
    const headerSize = read();
    const types: number[] = [];
    while (at < headerSize) types.push(read());
    if (at !== headerSize) corrupt("bad record header");
    let body = headerSize;
    return types.map((type): SqlValue => {
      if (type === 0) return null;
      const integerSize = INTEGER_SIZES[type];
      if (integerSize != null) {
        body += integerSize;
        return integer(data, body - integerSize, integerSize);
      }
      if (type === 7) {
        body += 8;
        return fields.getFloat64(body - 8);
      }
      if (type === 8 || type === 9) return type - 8;
      if (type < 12) return corrupt(`reserved serial type ${String(type)}`);
      const length = Math.floor((type - 12) / 2);
      if (body + length > data.length) corrupt("record too short");
      const value = data.subarray(body, body + length);
      body += length;
      return type % 2 === 0 ? value : text.decode(value);
    });
  };

  const walk = (page: number, rows: SqlRow[], seen: Set<number>): void => {
    if (seen.has(page)) corrupt("b-tree loop");
    seen.add(page);
    const start = pageStart(page);
    const header = start + (page === 1 ? 100 : 0);
    const type = byteAt(header);
    const interior = type === INTERIOR_INDEX || type === INTERIOR_TABLE;
    if (!interior && type !== LEAF_INDEX && type !== LEAF_TABLE)
      corrupt(`page ${String(page)} is not a b-tree page`);
    const cells = view.getUint16(header + 3);
    const pointers = header + (interior ? 12 : 8);
    for (let cell = 0; cell < cells; cell++) {
      let at = start + view.getUint16(pointers + cell * 2);
      if (interior) {
        walk(view.getUint32(at), rows, seen);
        at += 4;
      }
      if (type === INTERIOR_TABLE) continue;
      const [size, afterSize] = smallVarint(at);
      if (type === LEAF_TABLE) {
        const [rowid, afterRowid] = varint(afterSize);
        rows.push({ rowid: exact(rowid), values: record(payload(afterRowid, size, false)) });
      } else {
        // An index b-tree holds each key once, interior cells included.
        rows.push({ rowid: null, values: record(payload(afterSize, size, true)) });
      }
    }
    if (interior) walk(view.getUint32(header + 8), rows, seen);
  };

  const scan = (root: number): SqlRow[] => {
    const rows: SqlRow[] = [];
    walk(root, rows, new Set());
    return rows;
  };

  const roots = new Map<string, number>();
  for (const { values } of scan(1)) {
    const [type, name, , root] = values;
    if (type === "table" && typeof name === "string" && typeof root === "number")
      roots.set(name, root);
  }
  return { roots, scan };
};

const failure = (error: unknown): SqliteFailure => ({
  kind: "corrupt-database",
  detail: error instanceof Error ? error.message : String(error),
});

export const openSqlite = (bytes: Uint8Array): Result<SqliteFile, SqliteFailure> => {
  if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 16)) !== HEADER)
    return err({ kind: "not-sqlite" });
  try {
    const { roots, scan } = parse(bytes);
    return ok({
      tables: new Set(roots.keys()),
      rows: (table) => {
        const root = roots.get(table);
        if (root == null) return err({ kind: "missing-table", table });
        try {
          return ok(scan(root));
        } catch (error) {
          return err(failure(error));
        }
      },
    });
  } catch (error) {
    return err(failure(error));
  }
};
