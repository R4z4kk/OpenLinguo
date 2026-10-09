import { ok, type Result } from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { readStored, writeStored } from "@/lib/stored";

export const referentials: readonly ZhProficiency[] = ["hsk-2025", "gf0025-2021"];

/** The 2025 exam syllabus unless the learner chose the national standard. */
export const DEFAULT_REFERENTIAL: ZhProficiency = "hsk-2025";

const STORAGE_KEY = "openlinguo.referential";

export const loadReferential = (
  storage: () => Pick<Storage, "getItem">,
): Result<ZhProficiency, string> => {
  const stored = readStored(storage, STORAGE_KEY);
  if (!stored.ok) return stored;
  return ok(
    referentials.find((referential) => referential === stored.value) ?? DEFAULT_REFERENTIAL,
  );
};

export const saveReferential = (
  storage: () => Pick<Storage, "setItem">,
  referential: ZhProficiency,
): Result<null, string> => writeStored(storage, STORAGE_KEY, referential);
