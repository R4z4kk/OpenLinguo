import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { AuthErrorCode } from "@openlinguo/core/account";
import { ApiErrorCode } from "@openlinguo/core/api-error";
import { z } from "zod";

export type ApiFailure =
  | { readonly kind: "offline" }
  | { readonly kind: "refused"; readonly code: ApiErrorCode | AuthErrorCode }
  /** Better Auth's rate limit answers 429 with `X-Retry-After` and no code. */
  | { readonly kind: "rate-limited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "unexpected"; readonly status: number };

/** The API's own refusals (`core` `ApiError`) and the Better Auth ones the screens read. */
const Refusal = z.object({
  code: z.union([ApiErrorCode, AuthErrorCode]),
  message: z.string(),
});

const NOT_JSON = Symbol("not JSON");

const retryAfter = (response: Response): number | null => {
  const seconds = Number(response.headers.get("x-retry-after") ?? Number.NaN);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};

/** A refused answer, read by the code of its body. */
export const refusedWith = (response: Response, body: unknown): ApiFailure => {
  const refusal = parseWith(Refusal, body);
  if (refusal.ok) return { kind: "refused", code: refusal.value.code };
  return response.status === 429
    ? { kind: "rate-limited", retryAfterSeconds: retryAfter(response) }
    : { kind: "unexpected", status: response.status };
};

/** The answer to a request, `offline` when there is none. */
export const request = async (
  path: string,
  init: RequestInit,
): Promise<Result<Response, ApiFailure>> => {
  try {
    return ok(await fetch(path, { ...init, credentials: "same-origin" }));
  } catch {
    return err({ kind: "offline" });
  }
};

/** Every answer is checked: a refusal by its code, a success by `read`, anything else is unexpected. */
export const call = async <T>(
  path: string,
  init: RequestInit,
  read: (body: unknown) => Result<T, unknown>,
): Promise<Result<T, ApiFailure>> => {
  const answer = await request(path, { ...init, headers: { "content-type": "application/json" } });
  if (!answer.ok) return answer;
  const response = answer.value;
  const body: unknown =
    response.status === 204 ? null : await response.json().catch(() => NOT_JSON);
  if (!response.ok) return err(refusedWith(response, body));
  if (body === NOT_JSON) return err({ kind: "unexpected", status: response.status });
  const parsed = read(body);
  return parsed.ok ? ok(parsed.value) : err({ kind: "unexpected", status: response.status });
};

export const post = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
