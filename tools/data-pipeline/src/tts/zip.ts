import { err, ok, type Result } from "@openlinguo/core";
import { crc32 } from "node:zlib";

export type ZipFile = { readonly name: string; readonly bytes: Uint8Array };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const VERSION = 20;
const UTF8_NAMES = 0x0800;
/** 1980-01-01 00:00 in MS-DOS format: a fixed date keeps the archive byte-identical between builds. */
const DOS_DATE = (1 << 5) | 1;

/**
 * Stored (uncompressed) zip, the layout the app's reader expects (apps/web/src/lib/zip.ts): MP3 is already
 * compressed. No ZIP64, so at most 65,535 files and 4 GiB.
 */
export const storedZip = (files: readonly ZipFile[]): Result<Uint8Array, string> => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, LOCAL, true);
    header.setUint16(4, VERSION, true);
    header.setUint16(6, UTF8_NAMES, true);
    header.setUint16(12, DOS_DATE, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, CENTRAL, true);
    entry.setUint16(4, VERSION, true);
    entry.setUint16(6, VERSION, true);
    entry.setUint16(8, UTF8_NAMES, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    parts.push(local, bytes);
    centrals.push(central);
    offset += local.length + bytes.length;
  }
  const centralSize = centrals.reduce((total, central) => total + central.length, 0);
  if (files.length > 0xffff || offset + centralSize > 0xffffffff) {
    return err(`${String(files.length)} files, ${String(offset)} bytes: too large without ZIP64`);
  }
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, END, true);
  trailer.setUint16(8, files.length, true);
  trailer.setUint16(10, files.length, true);
  trailer.setUint32(12, centralSize, true);
  trailer.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...parts, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return ok(out);
};
