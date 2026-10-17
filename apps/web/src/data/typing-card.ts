import { ok, type Grade, type LanguagePack, type LookupError, type Result } from "@openlinguo/core";
import { readText } from "@/data/transcript";

/** The headword typed exactly is good, anything else again (ADR 0011). */
export const gradeTyping = (headword: string, typed: string): Grade =>
  typed === headword ? "good" : "again";

/**
 * The reading of what was typed (numbered pinyin): the card's own when right, else the dictionary's
 * for each word; `null` when nothing was typed or a character has no reading.
 */
export const typedReading = async (
  pack: LanguagePack,
  { headword, readingKey }: { readonly headword: string; readonly readingKey: string },
  typed: string,
): Promise<Result<string | null, LookupError>> => {
  if (typed === headword) return ok(readingKey);
  if (typed === "") return ok(null);
  const chars = await readText(pack, typed);
  if (!chars.ok) return chars;
  const readings = chars.value.map(({ reading }) => reading);
  return ok(readings.every((reading) => reading !== null) ? readings.join(" ") : null);
};
