import { err, ok, type Result } from "@openlinguo/core";

/**
 * Decodes the MessagePack subset used by wordfreq lists: nil, booleans, unsigned integers,
 * strings, arrays and maps. Any other type, a truncated value or trailing bytes fail.
 */
export const decodeMsgpack = (bytes: Uint8Array): Result<unknown, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;

  const take = (length: number): number => {
    if (offset + length > bytes.length) throw new RangeError(`truncated at byte ${String(offset)}`);
    const start = offset;
    offset += length;
    return start;
  };
  const uint = (size: 1 | 2 | 4): number => {
    const start = take(size);
    return size === 1
      ? view.getUint8(start)
      : size === 2
        ? view.getUint16(start)
        : view.getUint32(start);
  };
  const string = (length: number): string => {
    const start = take(length);
    return text.decode(bytes.subarray(start, start + length));
  };
  // Each element takes at least one byte: a longer count is truncated, checked before allocating.
  const count = (length: number): number => {
    if (length > bytes.length - offset) {
      throw new RangeError(`truncated at byte ${String(bytes.length)}`);
    }
    return length;
  };
  const array = (length: number): unknown[] => Array.from({ length: count(length) }, () => value());
  const map = (length: number): Record<string, unknown> => {
    count(length);
    const entries: [string, unknown][] = [];
    for (let index = 0; index < length; index++) {
      const key = value();
      if (typeof key !== "string") throw new TypeError("map key is not a string");
      entries.push([key, value()]);
    }
    return Object.fromEntries(entries);
  };

  const value = (): unknown => {
    const at = offset;
    const type = uint(1);
    if (type <= 0x7f) return type;
    if (type >= 0x80 && type <= 0x8f) return map(type & 0x0f);
    if (type >= 0x90 && type <= 0x9f) return array(type & 0x0f);
    if (type >= 0xa0 && type <= 0xbf) return string(type & 0x1f);
    switch (type) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc:
        return uint(1);
      case 0xcd:
        return uint(2);
      case 0xce:
        return uint(4);
      case 0xd9:
        return string(uint(1));
      case 0xda:
        return string(uint(2));
      case 0xdb:
        return string(uint(4));
      case 0xdc:
        return array(uint(2));
      case 0xdd:
        return array(uint(4));
      case 0xde:
        return map(uint(2));
      case 0xdf:
        return map(uint(4));
      default:
        throw new TypeError(`unsupported type 0x${type.toString(16)} at byte ${String(at)}`);
    }
  };

  try {
    const decoded = value();
    if (offset !== bytes.length) {
      return err(`${String(bytes.length - offset)} trailing bytes after the value`);
    }
    return ok(decoded);
  } catch (error) {
    return err(`invalid MessagePack: ${String(error)}`);
  }
};
