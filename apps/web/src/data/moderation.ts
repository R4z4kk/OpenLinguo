import {
  ok,
  parseWith,
  type LookupError,
  type Result,
  type TextReadingFeature,
} from "@openlinguo/core";
import {
  type Approval,
  type BandEstimate,
  estimateBand,
  type KeepNotice,
  type NewStatementOfReasons,
  Notice,
  NoticeDecided,
  Notices,
  type Restriction,
  StatementOfReasons,
} from "@openlinguo/core/moderation";
import { Submission, Submissions } from "@openlinguo/core/submission";
import type { Database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import { type ApiFailure, call } from "./api.ts";

const path = (id: string) => `/api/admin/submissions/${encodeURIComponent(id)}`;

export const loadQueue = (): Promise<Result<readonly Submission[], ApiFailure>> =>
  call("/api/admin/queue", { method: "GET" }, (body) => parseWith(Submissions, body));

export const loadForReview = (id: string): Promise<Result<Submission, ApiFailure>> =>
  call(path(id), { method: "GET" }, (body) => parseWith(Submission, body));

export const approveSubmission = (
  id: string,
  approval: Approval,
): Promise<Result<null, ApiFailure>> =>
  call(`${path(id)}/approve`, { method: "POST", body: JSON.stringify(approval) }, () => ok(null));

export const restrictSubmission = (
  id: string,
  measure: Restriction,
  statement: NewStatementOfReasons,
): Promise<Result<StatementOfReasons, ApiFailure>> =>
  call(
    `${path(id)}/${measure === "rejected" ? "reject" : "remove"}`,
    { method: "POST", body: JSON.stringify(statement) },
    (body) => parseWith(StatementOfReasons, body),
  );

/**
 * The text's band from the offline dictionary's HSK 2025 levels, whatever referential the admin
 * follows; segmented without the admin's personal lexicon so every device estimates alike.
 */
export const estimateText = async (
  db: Database,
  feature: TextReadingFeature,
  body: string,
): Promise<Result<BandEstimate | null, LookupError | ReviewLogFailure>> => {
  const tokens = await feature.annotate(body);
  if (!tokens.ok) return tokens;
  const words = [...new Set(tokens.value.filter(({ isWord }) => isWord).map(({ text }) => text))];
  return guarded(() =>
    db.transaction("r", db.entries, async () => {
      // One `equals` per key: `anyOf` walks the whole index in WebKit.
      const rows = await Promise.all(
        words.map((word) => db.entries.where("simplified").equals(word).toArray()),
      );
      const levelOf = new Map(
        words.map((word, index) => {
          const levels = (rows[index] ?? []).flatMap(({ hsk2025 }) =>
            hsk2025 === null ? [] : [hsk2025],
          );
          return [word, levels.length === 0 ? null : Math.min(...levels)] as const;
        }),
      );
      return ok(estimateBand(tokens.value, levelOf));
    }),
  );
};

export const loadNotices = (): Promise<Result<readonly Notice[], ApiFailure>> =>
  call("/api/admin/notices", { method: "GET" }, (body) => parseWith(Notices, body));

const noticePath = (id: string) => `/api/admin/notices/${encodeURIComponent(id)}`;

export const loadNotice = (id: string): Promise<Result<Notice, ApiFailure>> =>
  call(noticePath(id), { method: "GET" }, (body) => parseWith(Notice, body));

export const keepNotice = (
  id: string,
  keep: KeepNotice,
): Promise<Result<NoticeDecided, ApiFailure>> =>
  call(`${noticePath(id)}/keep`, { method: "POST", body: JSON.stringify(keep) }, (body) =>
    parseWith(NoticeDecided, body),
  );

/** Removes the reported text; every open notice on it is decided with it. */
export const removeByNotice = (
  id: string,
  statement: NewStatementOfReasons,
): Promise<Result<NoticeDecided, ApiFailure>> =>
  call(`${noticePath(id)}/remove`, { method: "POST", body: JSON.stringify(statement) }, (body) =>
    parseWith(NoticeDecided, body),
  );
