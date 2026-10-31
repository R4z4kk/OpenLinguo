import { err, ok } from "@openlinguo/core/result";
import type { SendMail } from "./mail.ts";

export type ScalewayConfig = {
  readonly secretKey: string;
  readonly projectId: string;
  readonly from: string;
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// https://github.com/scaleway/scaleway-sdk-js/blob/main/packages_generated/tem/src/v1alpha1/api.gen.ts (createEmail)
const ENDPOINT = "https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails";
const TIMEOUT_MS = 5000;

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const html = (text: string) =>
  text
    .split("\n\n")
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

/** Scaleway Transactional Email over its REST API: no tracking, no attachment (ADR 0015). */
export const scalewayMailer =
  (config: ScalewayConfig, fetcher: Fetcher = fetch): SendMail =>
  async (mail) => {
    let response: Response;
    try {
      response = await fetcher(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": config.secretKey },
        body: JSON.stringify({
          from: { email: config.from, name: "OpenLinguo" },
          to: [{ email: mail.to }],
          subject: mail.subject,
          text: mail.text,
          html: html(mail.text),
          project_id: config.projectId,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return err({ kind: "unreachable", message: `Scaleway unreachable: ${reason}` });
    }
    if (!response.ok) {
      return err({ kind: "rejected", message: `Scaleway answered ${String(response.status)}` });
    }
    return ok(null);
  };
