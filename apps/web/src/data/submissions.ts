import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { ApiError, type ApiErrorCode } from "@openlinguo/core/api-error";
import {
  ATTESTATION_VERSION,
  type Attribution,
  type NewSubmission,
  Submission,
  Submissions,
} from "@openlinguo/core/submission";
import { z } from "zod";
import type { StoredText } from "./database.ts";

export type ApiFailure =
  | { readonly kind: "offline" }
  | { readonly kind: "refused"; readonly code: ApiErrorCode }
  | { readonly kind: "unexpected"; readonly status: number };

/** The parts of Better Auth's `get-session` answer the submit page needs. */
const SessionAnswer = z.object({ user: z.object({ name: z.string() }) }).nullable();
export type Account = { readonly pseudonym: string | null };

const NOT_JSON = Symbol("not JSON");

const call = async <T>(
  path: string,
  init: RequestInit,
  read: (body: unknown) => Result<T, unknown>,
): Promise<Result<T, ApiFailure>> => {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
  } catch {
    return err({ kind: "offline" });
  }
  const body: unknown =
    response.status === 204 ? null : await response.json().catch(() => NOT_JSON);
  if (body === NOT_JSON) return err({ kind: "unexpected", status: response.status });
  if (!response.ok) {
    const refusal = parseWith(ApiError, body);
    return refusal.ok
      ? err({ kind: "refused", code: refusal.value.code })
      : err({ kind: "unexpected", status: response.status });
  }
  const parsed = read(body);
  return parsed.ok ? ok(parsed.value) : err({ kind: "unexpected", status: response.status });
};

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
