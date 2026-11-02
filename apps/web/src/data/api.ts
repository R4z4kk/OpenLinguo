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

/** Every answer is checked: a refusal by its code, a success by `read`, anything else is unexpected. */
export const call = async <T>(
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
  if (!response.ok) {
    const refusal = parseWith(Refusal, body);
    if (refusal.ok) return err({ kind: "refused", code: refusal.value.code });
    return response.status === 429
      ? err({ kind: "rate-limited", retryAfterSeconds: retryAfter(response) })
      : err({ kind: "unexpected", status: response.status });
  }
  if (body === NOT_JSON) return err({ kind: "unexpected", status: response.status });
  const parsed = read(body);
  return parsed.ok ? ok(parsed.value) : err({ kind: "unexpected", status: response.status });
};

export const post = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
