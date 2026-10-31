import { ok, parseWith, type Result } from "@openlinguo/core";
import { SessionAnswer } from "@openlinguo/core/account";
import {
  ATTESTATION_VERSION,
  type Attribution,
  type NewSubmission,
  Submission,
  Submissions,
} from "@openlinguo/core/submission";
import { type ApiFailure, call } from "./api.ts";
import type { StoredText } from "./database.ts";

export type { ApiFailure };

export type Account = { readonly pseudonym: string | null };

/** The signed-in account, `null` when signed out. */
export const loadAccount = (): Promise<Result<Account | null, ApiFailure>> =>
  call("/api/auth/get-session", { method: "GET" }, (body) => {
    const answer = parseWith(SessionAnswer, body);
    if (!answer.ok) return answer;
    if (answer.value === null) return ok(null);
    const { name } = answer.value.user;
    return ok({ pseudonym: name === "" ? null : name });
  });

/** The request for a local text: the licence follows from its origin on the server. */
export const newSubmission = (text: StoredText, attribution: Attribution): NewSubmission => {
  const draft = {
    title: text.title,
    body: text.body,
    attribution,
    attestationVersion: ATTESTATION_VERSION,
  } as const;
  return text.source === "ai"
    ? { ...draft, origin: "ai", provenance: text.provenance }
    : { ...draft, origin: "human", provenance: null };
};

export const sendSubmission = (
  submission: NewSubmission,
): Promise<Result<Submission, ApiFailure>> =>
  call("/api/submissions", { method: "POST", body: JSON.stringify(submission) }, (body) =>
    parseWith(Submission, body),
  );

export const listSubmissions = (): Promise<Result<readonly Submission[], ApiFailure>> =>
  call("/api/submissions", { method: "GET" }, (body) => parseWith(Submissions, body));

export const withdrawSubmission = (id: string): Promise<Result<null, ApiFailure>> =>
  call(`/api/submissions/${encodeURIComponent(id)}`, { method: "DELETE" }, () => ok(null));
