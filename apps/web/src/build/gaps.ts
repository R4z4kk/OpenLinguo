import { err, ok, parseWith, proficiencyFrameworks, type Result } from "@openlinguo/core";
import { z } from "zod";
import type { CharacterRow, EntryRow } from "../data/format.ts";

/** A TSV list under data/. */
export type Table = {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

export const parseTable = (text: string): Table => {
  const [head = "", ...lines] = text.split("\n");
  return {
    header: head.split("\t"),
    rows: lines.filter((line) => line !== "").map((line) => line.split("\t")),
  };
};

/** A word or character and its HSK 2025 level (1-based band), `null` outside HSK. */
export type Gap = { readonly item: string; readonly band: number | null };

export type GapList = {
  readonly label: string;
  /** Under data/, or `null` for a count with no list of its own. */
  readonly path: string | null;
  /** `row` when the rows name no word or character: only the total is counted. */
  readonly unit: "word" | "character" | "row";
  readonly gaps: readonly Gap[];
  readonly total: number;
};

export type GapCategory = {
  readonly title: string;
  readonly description: string;
  readonly fix: string;
  readonly lists: readonly GapList[];
};

// New categories (the reader's unknown words #34, user reports in M7) are added here.
const CATEGORIES = [
  {
    id: "french",
    title: "Missing French translation",
    description:
      "CC-CEDICT entries with neither a CFDICT nor a French Wiktionary gloss: the French interface shows their English glosses with a notice.",
    fix: "add the translation upstream (CFDICT, French Wiktionary) or as a manual entry. An erhua form (…儿) whose base word is translated is a candidate for a repair rule.",
  },
  {
    id: "doubtful",
    title: "Doubtful translation",
    description:
      "French glosses attached although their tone differs from CC-CEDICT, and Wiktionary entries with several readings, of which only the first is used.",
    fix: "check the source, then fix it upstream or add a repair rule to the dataset builder.",
  },
  {
    id: "rejected",
    title: "Rejected or invalid source entries",
    description:
      "Source entries left out because their reading or headword is invalid, or their gloss is a wiki example. They are never guessed.",
    fix: "fix the entry upstream (CFDICT, French Wiktionary); the next data refresh picks it up.",
  },
  {
    id: "readings",
    title: "Unresolved HSK readings",
    description:
      "Graded words absent from CC-CEDICT, or polyphones whose graded reading is unknown, so every reading gets the level.",
    fix: "take the reading from another source (the official syllabus once #56 allows it) or add an explicit repair rule.",
  },
  {
    id: "characters",
    title: "Unsupported characters",
    description:
      "Characters a font has no glyph for (they fall back to the next font, down to OpenLinguo Han Fallback for the CJK extension planes), that no self-hosted font draws, without stroke order, or whose decomposition has an unknown component (？).",
    fix: "another self-hosted fallback font (#67), or the data upstream (Make Me a Hanzi, hanzi-writer-data).",
  },
  {
    id: "repairs",
    title: "Repairs applied to a source",
    description: "Corrections the dataset builders apply to a raw source.",
    fix: "report them upstream, then drop the repair once the source is fixed.",
  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

type TsvList = {
  readonly category: CategoryId;
  readonly label: string;
  readonly path: string;
  readonly column: { readonly name: string; readonly unit: "word" | "character" } | null;
  /** Keeps the rows of one `issue`; every issue of a filtered table must be kept by a list. */
  readonly issue: string | null;
};

const word = (name: string) => ({ name, unit: "word" }) as const;
const character = { name: "character", unit: "character" } as const;
const wiktionaryIssue = (issue: string, label: string): TsvList => ({
  category: issue === "several-readings" ? "doubtful" : "rejected",
  label,
  path: "wiktionary-fr-zh/issues.tsv",
  column: word("title"),
  issue,
});

const TSV_LISTS: readonly TsvList[] = [
  {
    category: "doubtful",
    label: "CFDICT tone conflicts",
    path: "cfdict/tone-conflicts.tsv",
    column: word("simplified"),
    issue: null,
  },
  {
    category: "doubtful",
    label: "Wiktionary tone conflicts",
    path: "wiktionary-fr-zh/tone-conflicts.tsv",
    column: word("simplified"),
    issue: null,
  },
  wiktionaryIssue("several-readings", "Wiktionary entries with several readings"),
  {
    category: "rejected",
    label: "CFDICT rejected entries",
    path: "cfdict/rejected.tsv",
    column: word("simplified"),
    issue: null,
  },
  wiktionaryIssue("no-pinyin", "Wiktionary entries without pinyin"),
  wiktionaryIssue("invalid-reading", "Wiktionary entries with an invalid reading"),
  wiktionaryIssue("non-han-title", "Wiktionary titles not only in Chinese characters"),
  wiktionaryIssue("multiline-gloss", "Wiktionary multi-line glosses"),
  {
    category: "readings",
    label: "HSK 2025 words",
    path: "hsk-2025-words/issues.tsv",
    column: word("word"),
    issue: null,
  },
  {
    category: "readings",
    label: "GF0025-2021 words",
    path: "gf0025-2021-words/issues.tsv",
    column: word("word"),
    issue: null,
  },
  {
    category: "characters",
    label: "No glyph in Noto Sans SC 400",
    path: "font-noto-sans-sc-400/missing.tsv",
    column: character,
    issue: null,
  },
  {
    category: "characters",
    label: "No glyph in Noto Sans SC 700",
    path: "font-noto-sans-sc-700/missing.tsv",
    column: character,
    issue: null,
  },
  {
    category: "characters",
    label: "No glyph in LXGW WenKai GB",
    path: "font-lxgw-wenkai-gb/missing.tsv",
    column: character,
    issue: null,
  },
  {
    category: "characters",
    label: "No glyph in any self-hosted font",
    path: "font-plangothic-p2/missing.tsv",
    column: character,
    issue: null,
  },
  {
    category: "characters",
    label: "No stroke order",
    path: "hanzi-writer-data/missing.tsv",
    column: character,
    issue: null,
  },
  { category: "repairs", label: "CFDICT", path: "cfdict/repairs.tsv", column: null, issue: null },
  {
    category: "repairs",
    label: "GF0025-2021 characters",
    path: "gf0025-2021-chars/repairs.tsv",
    column: null,
    issue: null,
  },
  {
    category: "repairs",
    label: "GF0025-2021 words",
    path: "gf0025-2021-words/repairs.tsv",
    column: null,
    issue: null,
  },
];

/** The TSV lists the report reads, under data/. */
export const GAP_TABLES: readonly string[] = [...new Set(TSV_LISTS.map((list) => list.path))];

export type GapSources = {
  readonly entries: readonly EntryRow[];
  /** Lowest HSK 2025 level of each graded word. */
  readonly wordLevels: ReadonlyMap<string, number>;
  readonly characterLevels: ReadonlyMap<string, number>;
  readonly characters: readonly CharacterRow[];
  /** The `GAP_TABLES`, by path. */
  readonly tables: ReadonlyMap<string, Table>;
};

export type GapReport = {
  readonly categories: readonly GapCategory[];
  /** Generated files, by path under data/. */
  readonly files: ReadonlyMap<string, string>;
};

const MISSING_FRENCH = "gaps/missing-french.tsv";
const UNKNOWN_COMPONENTS = "gaps/unknown-components.tsv";
const BANDS = proficiencyFrameworks["hsk-2025"];

const nullsLast = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;

const byBand = <Item extends { readonly band: number | null }>(items: readonly Item[]): Item[] =>
  [...items].sort((a, b) => nullsLast(a.band, b.band));

const bandLabel = (band: number | null): string => (band === null ? "" : (BANDS[band - 1] ?? ""));

const tsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header, ...rows].map((row) => row.join("\t")).join("\n") + "\n";

const tableList = (
  list: TsvList,
  table: Table,
  band: (item: string, unit: "word" | "character") => number | null,
): Result<GapList, string> => {
  const columnOf = (name: string): Result<number, string> => {
    const index = table.header.indexOf(name);
    return index === -1 ? err(`data/${list.path} has no "${name}" column`) : ok(index);
  };
  let rows = table.rows;
  if (list.issue !== null) {
    const issue = columnOf("issue");
    if (!issue.ok) return issue;
    rows = rows.filter((row) => row[issue.value] === list.issue);
  }
  if (list.column === null) {
    return ok({ label: list.label, path: list.path, unit: "row", gaps: [], total: rows.length });
  }
  const { name, unit } = list.column;
  const column = columnOf(name);
  if (!column.ok) return column;
  const gaps = rows.map((row) => {
    const item = row[column.value] ?? "";
    return { item, band: band(item, unit) };
  });
  return ok({ label: list.label, path: list.path, unit, gaps, total: gaps.length });
};

/** Issues of a filtered table that no list keeps would be silently uncounted. */
const unclassifiedIssues = (tables: ReadonlyMap<string, Table>): string | null => {
  for (const path of GAP_TABLES) {
    const kept = TSV_LISTS.filter((list) => list.path === path).map((list) => list.issue);
    if (kept.every((issue) => issue === null)) continue;
    const table = tables.get(path);
    if (table == null) return `data/${path} was not read`;
    const column = table.header.indexOf("issue");
    if (column === -1) return `data/${path} has no "issue" column`;
    const unknown = new Set(
      table.rows.map((row) => row[column] ?? "").filter((issue) => !kept.includes(issue)),
    );
    if (unknown.size > 0) return `data/${path} has unclassified issues: ${[...unknown].join(", ")}`;
  }
  return null;
};

/** Gathers every gap list by category and builds the lists that are computed here. */
export const gapReport = (sources: GapSources): Result<GapReport, string> => {
  const simplifiedOf = new Map<string, string>();
  for (const [simplified, , , variants] of sources.entries) {
    for (const variant of variants)
      if (!simplifiedOf.has(variant)) simplifiedOf.set(variant, simplified);
  }
  const band = (item: string, unit: "word" | "character"): number | null => {
    const levels = unit === "word" ? sources.wordLevels : sources.characterLevels;
    return levels.get(item) ?? levels.get(simplifiedOf.get(item) ?? item) ?? null;
  };

  const missing = sources.entries.filter(
    ([, , , , [english, cfdict, wiktionary]]) =>
      english.length > 0 && cfdict.length === 0 && wiktionary.length === 0,
  );
  const graded = missing
    .filter(([, , , , , hsk, gf]) => hsk !== null || gf !== null)
    .sort(
      (a, b) =>
        nullsLast(a[5], b[5]) ||
        nullsLast(a[6], b[6]) ||
        nullsLast(b[8], a[8]) ||
        (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
  const unknownComponents = byBand(
    sources.characters
      .filter(([, decomposition]) => decomposition.includes("？"))
      .map(([item, decomposition]) => ({ item, decomposition, band: band(item, "character") })),
  );

  const lists = new Map<CategoryId, GapList[]>([
    [
      "french",
      [
        {
          label: "Graded words (HSK 2025, GF0025-2021)",
          path: MISSING_FRENCH,
          unit: "word",
          gaps: graded.map(([item, , , , , level]) => ({ item, band: level })),
          total: graded.length,
        },
        {
          label: "All CC-CEDICT entries",
          path: null,
          unit: "word",
          gaps: missing.map(([item, , , , , level]) => ({ item, band: level })),
          total: missing.length,
        },
      ],
    ],
  ]);
  const unclassified = unclassifiedIssues(sources.tables);
  if (unclassified !== null) return err(unclassified);
  for (const list of TSV_LISTS) {
    const table = sources.tables.get(list.path);
    if (table == null) return err(`data/${list.path} was not read`);
    const built = tableList(list, table, band);
    if (!built.ok) return built;
    lists.set(list.category, [...(lists.get(list.category) ?? []), built.value]);
  }
  lists.set("characters", [
    ...(lists.get("characters") ?? []),
    {
      label: "Unknown decomposition component",
      path: UNKNOWN_COMPONENTS,
      unit: "character",
      gaps: unknownComponents,
      total: unknownComponents.length,
    },
  ]);

  return ok({
    categories: CATEGORIES.map(({ id, ...category }) => ({
      ...category,
      lists: lists.get(id) ?? [],
    })),
    files: new Map([
      [
        MISSING_FRENCH,
        tsv(
          ["simplified", "reading", "hsk_2025", "gf0025_2021", "zipf"],
          graded.map(([simplified, , reading, , , hsk, gf, , zipf]) => [
            simplified,
            reading,
            bandLabel(hsk),
            bandLabel(gf),
            zipf === null ? "" : String(zipf),
          ]),
        ),
      ],
      [
        UNKNOWN_COMPONENTS,
        tsv(
          ["character", "decomposition", "hsk_2025"],
          unknownComponents.map(({ item, decomposition, band: level }) => [
            item,
            decomposition,
            bandLabel(level),
          ]),
        ),
      ],
    ]),
  });
};

const formatter = new Intl.NumberFormat("en-US");
const number = (value: number): string => formatter.format(value);

/** Per HSK band, then outside HSK. */
const bandCounts = (gaps: readonly Gap[]): readonly number[] => {
  const counts = Array.from({ length: BANDS.length + 1 }, () => 0);
  for (const { band } of gaps) {
    const index = band === null || band > BANDS.length ? BANDS.length : band - 1;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
};

const link = (list: GapList): string =>
  list.path === null ? list.label : `[${list.label}](${list.path})`;

const HSK_SHOWN = 20;

/** Each HSK item once: a source list may have one row per written form. */
const hskLine = (list: GapList): string | null => {
  const items = new Map<string, Gap>();
  for (const gap of list.gaps)
    if (gap.band !== null && !items.has(gap.item)) items.set(gap.item, gap);
  const hsk = byBand([...items.values()]);
  if (list.unit === "row" || list.path === null || hsk.length === 0) return null;
  const shown = hsk
    .slice(0, HSK_SHOWN)
    .map(({ item, band }) => `${item} (HSK ${bandLabel(band)})`)
    .join(", ");
  const more = hsk.length > HSK_SHOWN ? `, and ${number(hsk.length - HSK_SHOWN)} more` : "";
  return `- ${link(list)}: ${number(hsk.length)} HSK ${list.unit}s: ${shown}${more}.`;
};

/** `data/GAPS.md`: counts per list and HSK band, then each category with its HSK items first. */
export const renderReport = (categories: readonly GapCategory[]): string => {
  const columns = [...BANDS.map((band) => `HSK ${band}`), "Outside HSK", "Total"];
  const lines = [
    "# Data gaps",
    "",
    'Generated by `pnpm data:gaps` from the committed datasets: do not edit. CI fails when it is out of date, so every data change shows its effect on the gaps in the pull request diff. A monthly "Gap review" issue tracks the counts.',
    "",
    "The report proposes and a human validates: nothing is corrected automatically. Each gap is fixed upstream, by a repair rule, from an alternative source or by a manual entry, always in a reviewed pull request.",
    "",
    `| Gaps | ${columns.join(" | ")} |`,
    `| :-- | ${columns.map(() => "--:").join(" | ")} |`,
  ];
  for (const category of categories) {
    lines.push(`| **${category.title}** |${" |".repeat(columns.length)}`);
    for (const list of category.lists) {
      const cells =
        list.unit === "row"
          ? [...columns.slice(0, -1).map(() => "—"), number(list.total)]
          : [...bandCounts(list.gaps).map(number), number(list.total)];
      lines.push(`| ${link(list)} | ${cells.join(" | ")} |`);
    }
  }
  for (const category of categories) {
    lines.push("", `## ${category.title}`, "", category.description, "");
    lines.push(`How gaps get fixed: ${category.fix}`);
    const hsk = category.lists.map(hskLine).filter((line) => line !== null);
    if (hsk.length > 0) lines.push("", ...hsk);
  }
  return lines.join("\n") + "\n";
};

const Counts = z.record(
  z.string(),
  z.object({ hsk: z.number().int().nullable(), total: z.number().int() }),
);
export type GapCounts = z.output<typeof Counts>;

export const gapCounts = (categories: readonly GapCategory[]): GapCounts =>
  Object.fromEntries(
    categories.flatMap((category) =>
      category.lists.map((list) => [
        `${category.title}: ${list.label}`,
        {
          hsk: list.unit === "row" ? null : list.gaps.filter((gap) => gap.band !== null).length,
          total: list.total,
        },
      ]),
    ),
  );

const MARKER = /<!-- gap-counts (.*) -->/u;

/** The counts a previous review issue carries in its body. */
export const parseReviewCounts = (body: string): Result<GapCounts, string> => {
  const json = MARKER.exec(body)?.[1] ?? null;
  if (json === null) return err("the previous gap review has no gap-counts block");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return err(`the previous gap-counts block is not JSON: ${String(error)}`);
  }
  const parsed = parseWith(Counts, value);
  return parsed.ok ? parsed : err("the previous gap-counts block does not match its schema");
};

const change = (now: number | null, before: number | null): string => {
  if (now === null || before === null) return "—";
  const delta = now - before;
  return delta > 0 ? `+${number(delta)}` : delta < 0 ? `−${number(-delta)}` : "0";
};

/** The monthly review issue: counts, their change since the previous review, and the counts block. */
export const reviewBody = (
  counts: GapCounts,
  previous: GapCounts | null,
  reportUrl: string,
): string => {
  const rows = Object.entries(counts).map(([name, { hsk, total }]) => {
    const before = previous?.[name] ?? null;
    const changes =
      previous === null
        ? ["—", "—"]
        : before === null
          ? ["new", "new"]
          : [change(hsk, before.hsk), change(total, before.total)];
    return `| ${name} | ${hsk === null ? "—" : number(hsk)} | ${changes[0] ?? ""} | ${number(total)} | ${changes[1] ?? ""} |`;
  });
  const dropped = Object.keys(previous ?? {}).filter((name) => !(name in counts));
  return [
    `Monthly review of the [data gaps](${reportUrl}). ${previous === null ? "This is the first review." : "Changes are counted since the previous review."}`,
    "",
    "| Gaps | HSK | Change | Total | Change |",
    "| :-- | --: | --: | --: | --: |",
    ...rows,
    ...(dropped.length > 0 ? ["", `No longer counted: ${dropped.join(", ")}.`] : []),
    "",
    "Review the lists, then fix each gap upstream, by a repair rule, from an alternative source or by a manual entry, in a reviewed pull request. Nothing is corrected automatically.",
    "",
    `<!-- gap-counts ${JSON.stringify(counts)} -->`,
    "",
  ].join("\n");
};
