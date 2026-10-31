import type { Result } from "@openlinguo/core/result";

export type Mail = { readonly to: string; readonly subject: string; readonly text: string };

export type MailError = { readonly kind: "rejected" | "unreachable"; readonly message: string };

/** A failed send is an error for the caller, never a silent success (ADR 0015). */
export type SendMail = (mail: Mail) => Promise<Result<null, MailError>>;
