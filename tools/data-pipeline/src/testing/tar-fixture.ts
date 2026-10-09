const BLOCK = 512;
const encoder = new TextEncoder();

export type TarEntry = { readonly name: string; readonly content: string; readonly type: string };

export const file = (name: string, content: string): TarEntry => ({ name, content, type: "0" });

const header = (name: string, size: number, type: string): Uint8Array => {
  const block = new Uint8Array(BLOCK);
  const put = (text: string, offset: number): void => {
    block.set(encoder.encode(text), offset);
  };
  put(name, 0);
  put("0000644\0", 100);
  put(`${size.toString(8).padStart(11, "0")}\0`, 124);
  put(" ".repeat(8), 148);
  put(type, 156);
  put("ustar\x0000", 257);
  const sum = block.reduce((total, byte) => total + byte, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
};

const padded = (bytes: Uint8Array): Uint8Array => {
  const block = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
  block.set(bytes);
  return block;
};

const paxRecord = (key: string, value: string): string => {
  const body = ` ${key}=${value}\n`;
  let length = encoder.encode(body).length + 1;
  while (String(length).length + encoder.encode(body).length !== length) length += 1;
  return `${String(length)}${body}`;
};

/** Minimal ustar writer; non-ASCII names get a pax `path` header like npm tarballs. */
export const tar = (entries: readonly TarEntry[]): Uint8Array => {
  const blocks: Uint8Array[] = [];
  for (const { name, content, type } of entries) {
    const data = encoder.encode(content);
    if (/[^\x20-\x7e]/u.test(name)) {
      const pax = encoder.encode(paxRecord("path", name));
      blocks.push(header("PaxHeader/entry", pax.length, "x"), padded(pax));
      blocks.push(header("package/????", data.length, type), padded(data));
    } else {
      blocks.push(header(name, data.length, type), padded(data));
    }
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  const archive = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
};
