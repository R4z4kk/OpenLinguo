import { err, ok, type Result } from "@openlinguo/core";

export type NameRecord = {
  readonly platform: number;
  readonly encoding: number;
  readonly language: number;
  readonly nameId: number;
  readonly bytes: Uint8Array;
};

type Table = { readonly tag: string; readonly data: Uint8Array };
type Sfnt = { readonly version: number; readonly tables: readonly Table[] };

const TABLE_RECORD = 16;
const NAME_RECORD = 12;
const CHECKSUM_MAGIC = 0xb1b0afba;
const WINDOWS_ENGLISH = { platform: 3, encoding: 1, language: 0x409 } as const;

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const readSfnt = (font: Uint8Array): Result<Sfnt, string> => {
  if (font.length < 12) return err("not a font");
  const data = view(font);
  const version = data.getUint32(0);
  if (version === 0x74746366) return err("font collections are not supported");
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
    return err("not a TrueType or OpenType font");
  }
  const count = data.getUint16(4);
  if (12 + count * TABLE_RECORD > font.length) return err("truncated table directory");
  const tables: Table[] = [];
  for (let index = 0; index < count; index++) {
    const record = 12 + index * TABLE_RECORD;
    const offset = data.getUint32(record + 8);
    const length = data.getUint32(record + 12);
    if (offset + length > font.length) return err("table outside the font");
    tables.push({
      tag: String.fromCharCode(...font.subarray(record, record + 4)),
      data: font.subarray(offset, offset + length),
    });
  }
  return ok({ version, tables });
};

const checksum = (bytes: Uint8Array): number => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const data = view(padded);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    sum = (sum + data.getUint32(offset)) >>> 0;
  }
  return sum;
};

/** The font with its tables in the same order, checksums and `head.checkSumAdjustment` recomputed. */
const writeSfnt = ({ version, tables }: Sfnt): Result<Uint8Array, string> => {
  const head = tables.find(({ tag }) => tag === "head");
  if (head == null || head.data.length < 12) return err("the font has no head table");
  const directory = 12 + tables.length * TABLE_RECORD;
  const size = tables.reduce(
    (total, { data }) => total + Math.ceil(data.length / 4) * 4,
    directory,
  );
  const font = new Uint8Array(size);
  const data = view(font);
  const power = 2 ** Math.floor(Math.log2(Math.max(tables.length, 1)));
  data.setUint32(0, version);
  data.setUint16(4, tables.length);
  data.setUint16(6, power * 16);
  data.setUint16(8, Math.log2(power));
  data.setUint16(10, tables.length * 16 - power * 16);
  let offset = directory;
  let headOffset = 0;
  tables.forEach(({ tag, data: table }, index) => {
    const record = 12 + index * TABLE_RECORD;
    for (let char = 0; char < 4; char++) font[record + char] = tag.charCodeAt(char);
    font.set(table, offset);
    if (tag === "head") {
      headOffset = offset;
      data.setUint32(offset + 8, 0);
    }
    data.setUint32(record + 4, checksum(font.subarray(offset, offset + table.length)));
    data.setUint32(record + 8, offset);
    data.setUint32(record + 12, table.length);
    offset += Math.ceil(table.length / 4) * 4;
  });
  data.setUint32(headOffset + 8, (CHECKSUM_MAGIC - checksum(font)) >>> 0);
  return ok(font);
};

const nameTable = (sfnt: Sfnt): Result<Uint8Array, string> => {
  const name = sfnt.tables.find(({ tag }) => tag === "name");
  return name == null ? err("the font has no name table") : ok(name.data);
};

/** Records of a format 0 `name` table. */
export const readNames = (font: Uint8Array): Result<readonly NameRecord[], string> => {
  const sfnt = readSfnt(font);
  if (!sfnt.ok) return sfnt;
  const table = nameTable(sfnt.value);
  if (!table.ok) return table;
  const bytes = table.value;
  if (bytes.length < 6) return err("truncated name table");
  const data = view(bytes);
  if (data.getUint16(0) !== 0) return err("only format 0 name tables are supported");
  const count = data.getUint16(2);
  const strings = data.getUint16(4);
  if (6 + count * NAME_RECORD > bytes.length) return err("truncated name records");
  const records: NameRecord[] = [];
  for (let index = 0; index < count; index++) {
    const record = 6 + index * NAME_RECORD;
    const start = strings + data.getUint16(record + 10);
    const end = start + data.getUint16(record + 8);
    if (end > bytes.length) return err("name string outside the table");
    records.push({
      platform: data.getUint16(record),
      encoding: data.getUint16(record + 2),
      language: data.getUint16(record + 4),
      nameId: data.getUint16(record + 6),
      bytes: bytes.subarray(start, end),
    });
  }
  return ok(records);
};

/** Text of a Unicode or Windows record (UTF-16BE), or of a Macintosh Roman one read as Latin-1. */
export const nameText = (record: NameRecord): string => {
  if (record.platform === 1) return String.fromCharCode(...record.bytes);
  let text = "";
  for (let offset = 0; offset + 1 < record.bytes.length; offset += 2) {
    text += String.fromCharCode(
      ((record.bytes[offset] ?? 0) << 8) | (record.bytes[offset + 1] ?? 0),
    );
  }
  return text;
};

const utf16 = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    bytes[index * 2] = unit >> 8;
    bytes[index * 2 + 1] = unit & 0xff;
  }
  return bytes;
};

/**
 * Replaces every record of the given name ids by one Windows English record, or drops them
 * (`null`): a modified OFL font must not keep a Reserved Font Name.
 */
export const renameFont = (
  font: Uint8Array,
  names: ReadonlyMap<number, string | null>,
): Result<Uint8Array, string> => {
  const sfnt = readSfnt(font);
  if (!sfnt.ok) return sfnt;
  const records = readNames(font);
  if (!records.ok) return records;
  const kept: NameRecord[] = [
    ...records.value.filter(({ nameId }) => !names.has(nameId)),
    ...[...names].flatMap(([nameId, value]) =>
      value === null ? [] : [{ ...WINDOWS_ENGLISH, nameId, bytes: utf16(value) }],
    ),
  ].sort(
    (a, b) =>
      a.platform - b.platform ||
      a.encoding - b.encoding ||
      a.language - b.language ||
      a.nameId - b.nameId,
  );
  const header = 6 + kept.length * NAME_RECORD;
  const strings = kept.reduce((total, { bytes }) => total + bytes.length, 0);
  if (header > 0xffff || strings > 0xffff) return err("name table too large");
  const table = new Uint8Array(header + strings);
  const data = view(table);
  data.setUint16(2, kept.length);
  data.setUint16(4, header);
  let offset = 0;
  kept.forEach(({ platform, encoding, language, nameId, bytes }, index) => {
    const record = 6 + index * NAME_RECORD;
    data.setUint16(record, platform);
    data.setUint16(record + 2, encoding);
    data.setUint16(record + 4, language);
    data.setUint16(record + 6, nameId);
    data.setUint16(record + 8, bytes.length);
    data.setUint16(record + 10, offset);
    table.set(bytes, header + offset);
    offset += bytes.length;
  });
  return writeSfnt({
    version: sfnt.value.version,
    tables: sfnt.value.tables.map((entry) =>
      entry.tag === "name" ? { ...entry, data: table } : entry,
    ),
  });
};
