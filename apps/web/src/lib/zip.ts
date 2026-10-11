import { err, ok, type Result } from "@openlinguo/core";

export type ZipEntry = {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localHeader: number;
};

export type ZipFailure =
  | { readonly kind: "not-zip" }
  /** ZIP64 archives (over 65,535 entries or 4 GB) are not read. */
  | { readonly kind: "zip64" }
  | { readonly kind: "corrupt-zip"; readonly detail: string }
  | { readonly kind: "read"; readonly message: string };

export type ZipArchive = {
  readonly entries: ReadonlyMap<string, ZipEntry>;
  /** Reads only this entry from the file: an archive is never loaded whole. */
  readonly read: (entry: ZipEntry) => Promise<Result<Uint8Array, ZipFailure>>;
};

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;
const ENCRYPTED = 1;

const corrupt = (detail: string): ZipFailure => ({ kind: "corrupt-zip", detail });

const readFailure = (error: unknown): ZipFailure => ({ kind: "read", message: String(error) });

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc;
});

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const bytesOf = async (blob: Blob, start: number, end: number): Promise<DataView> =>
  new DataView(await blob.slice(start, end).arrayBuffer());

/** Inflates exactly `size` bytes; a longer or shorter stream is corrupt. */
const inflate = async (data: Blob, size: number): Promise<Uint8Array | null> => {
  const reader = data.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const out = new Uint8Array(size);
  let filled = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (filled + chunk.value.length > size) {
      await reader.cancel();
      return null;
    }
    out.set(chunk.value, filled);
    filled += chunk.value.length;
  }
  return filled === size ? out : null;
};

const readEntry = async (blob: Blob, entry: ZipEntry): Promise<Result<Uint8Array, ZipFailure>> => {
  const header = await bytesOf(blob, entry.localHeader, entry.localHeader + 30);
  if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL)
    return err(corrupt(`no local header for ${entry.name}`));
  const start = entry.localHeader + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > blob.size) return err(corrupt(`${entry.name} is truncated`));
  const data = blob.slice(start, end);
  const bytes =
    entry.method === STORED
      ? new Uint8Array(await data.arrayBuffer())
      : await inflate(data, entry.size);
  if (bytes?.length !== entry.size) return err(corrupt(`${entry.name} has the wrong size`));
  return crc32(bytes) === entry.crc ? ok(bytes) : err(corrupt(`${entry.name} fails its checksum`));
};

const guardedRead =
  (blob: Blob) =>
  async (entry: ZipEntry): Promise<Result<Uint8Array, ZipFailure>> => {
    try {
      return await readEntry(blob, entry);
    } catch (error) {
      // An invalid deflate stream rejects with a TypeError.
      return err(error instanceof TypeError ? corrupt(String(error)) : readFailure(error));
    }
  };

const findEnd = (tail: DataView): number => {
  for (let at = tail.byteLength - END_SIZE; at >= 0; at--) {
    if (tail.getUint32(at, true) === END) return at;
  }
  return -1;
};

const parseDirectory = (
  directory: DataView,
  count: number,
): Result<ReadonlyMap<string, ZipEntry>, ZipFailure> => {
  const names = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== CENTRAL)
      return err(corrupt("bad central directory"));
    const nameLength = directory.getUint16(at + 28, true);
    const next =
      at +
      46 +
      nameLength +
      directory.getUint16(at + 30, true) +
      directory.getUint16(at + 32, true);
    if (next > directory.byteLength) return err(corrupt("bad central directory"));
    const name = names.decode(
      new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength),
    );
    const method = directory.getUint16(at + 10, true);
    if (directory.getUint16(at + 8, true) & ENCRYPTED) return err(corrupt(`${name} is encrypted`));
    if (method !== STORED && method !== DEFLATED)
      return err(corrupt(`${name} uses compression method ${String(method)}`));
    entries.set(name, {
      name,
      method,
      crc: directory.getUint32(at + 16, true),
      compressedSize: directory.getUint32(at + 20, true),
      size: directory.getUint32(at + 24, true),
      localHeader: directory.getUint32(at + 42, true),
    });
    at = next;
  }
  return ok(entries);
};

/** Reads the central directory of a single-disk ZIP archive (APPNOTE 6.3.10). */
export const openZip = async (blob: Blob): Promise<Result<ZipArchive, ZipFailure>> => {
  try {
    const tailStart = Math.max(0, blob.size - END_SIZE - MAX_COMMENT);
    const tail = await bytesOf(blob, tailStart, blob.size);
    const end = findEnd(tail);
    if (end < 0) return err({ kind: "not-zip" });
    const count = tail.getUint16(end + 10, true);
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
      return err({ kind: "zip64" });
    if (tail.getUint16(end + 4, true) !== 0 || tail.getUint16(end + 8, true) !== count)
      return err(corrupt("split archive"));
    if (offset + size > tailStart + end) return err(corrupt("central directory out of bounds"));
    const entries = parseDirectory(await bytesOf(blob, offset, offset + size), count);
    return entries.ok ? ok({ entries: entries.value, read: guardedRead(blob) }) : entries;
  } catch (error) {
    return err(readFailure(error));
  }
};
