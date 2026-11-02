import { parseWith, type Result } from "@openlinguo/core";
import { type NewNotice, NoticeReceipt } from "@openlinguo/core/moderation";
import { type ApiFailure, call } from "./api.ts";

/** « Signaler »: no account needed (DSA art. 16). */
export const sendNotice = (notice: NewNotice): Promise<Result<NoticeReceipt, ApiFailure>> =>
  call("/api/notices", { method: "POST", body: JSON.stringify(notice) }, (body) =>
    parseWith(NoticeReceipt, body),
  );
