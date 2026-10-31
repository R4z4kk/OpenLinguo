import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 with SHA-1, 6 digits and 30 seconds, from the secret of an otpauth URI. */
export const totp = (uri: string, at = Date.now()) => {
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const bits = secret
    .toUpperCase()
    .replace(/./g, (char) => BASE32.indexOf(char).toString(2).padStart(5, "0"));
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};
