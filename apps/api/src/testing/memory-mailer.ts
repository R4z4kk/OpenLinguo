import { ok } from "@openlinguo/core/result";
import type { Mail, SendMail } from "../mail.ts";

/** A `SendMail` that keeps every mail in memory, for tests. */
export const memoryMailer = (): { readonly sendMail: SendMail; readonly sent: readonly Mail[] } => {
  const sent: Mail[] = [];
  const sendMail: SendMail = (mail) => {
    sent.push(mail);
    return Promise.resolve(ok(null));
  };
  return { sendMail, sent };
};
