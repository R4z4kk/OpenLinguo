import { err, ok, type Result } from "@openlinguo/core";

const BLOCK = 512;
const decoder = new TextDecoder("utf-8", { fatal: true });

const field = (header: Uint8Array, start: number, length: number): string => {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
};

const octal = (header: Uint8Array, start: number, length: number): number => {
  const text = field(header, start, length).trim();
  return /^[0-7]+$/u.test(text) ? parseInt(text, 8) : Number.NaN;
};

const ustarPath = (header: Uint8Array): string => {
  const prefix = field(header, 345, 155);
  const name = field(header, 0, 100);
  return prefix === "" ? name : `${prefix}/${name}`;
};

const checksumOk = (header: Uint8Array): boolean => {
  let sum = 0;
  for (let index = 0; index < BLOCK; index++) {
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  return sum === octal(header, 148, 8);
};

/** `path` of a pax extended header: records `<length> <key>=<value>\n`, length in bytes. */
const paxPath = (data: Uint8Array): Result<string | null, string> => {
  let path: string | null = null;
  for (let offset = 0; offset < data.length;) {
    const space = data.indexOf(0x20, offset);
    const length = Number(decoder.decode(data.subarray(offset, space)));
    if (space < 0 || !Number.isInteger(length) || length <= 0 || offset + length > data.length) {
      return err("malformed pax header");
    }
    const record = decoder.decode(data.subarray(space + 1, offset + length - 1));
    const equals = record.indexOf("=");
    if (equals < 0) return err("malformed pax record");
    if (record.slice(0, equals) === "path") path = record.slice(equals + 1);
    offset += length;
  }
  return ok(path);
};

/** Regular files of an uncompressed ustar archive (pax `path` supported), by path. */
export const readTar = (bytes: Uint8Array): Result<ReadonlyMap<string, Uint8Array>, string> => {
  const files = new Map<string, Uint8Array>();
  let nextPath: string | null = null;
  for (let offset = 0; offset + BLOCK <= bytes.length;) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return ok(files);
    try {
      if (!checksumOk(header)) return err(`bad header checksum at byte ${String(offset)}`);
      const size = octal(header, 124, 12);
      const start = offset + BLOCK;
      if (Number.isNaN(size) || start + size > bytes.length) {
        return err(`truncated entry at byte ${String(offset)}`);
      }
      const data = bytes.subarray(start, start + size);
      const type = String.fromCharCode(header[156] ?? 0);
      if (type === "x") {
        const path = paxPath(data);
        if (!path.ok) return path;
        nextPath = path.value;
      } else {
        if (type === "0" || type === "\0") files.set(nextPath ?? ustarPath(header), data);
        nextPath = null;
      }
      offset = start + Math.ceil(size / BLOCK) * BLOCK;
    } catch (error) {
      return err(`invalid tar header at byte ${String(offset)}: ${String(error)}`);
    }
  }
  return err("archive has no end-of-archive marker");
};
