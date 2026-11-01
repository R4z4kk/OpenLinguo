import { err, ok } from "@openlinguo/core/result";
import type { SendMail } from "./mail.ts";

export type LettermintConfig = { readonly token: string; readonly from: string };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// https://lettermint.co/docs/api-reference/sending/0.0.1/lettermint-sending-openapi.json (POST /v1/send, 2026-11-01)
const ENDPOINT = "https://api.lettermint.co/v1/send";
const TIMEOUT_MS = 5000;

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const html = (text: string) =>
  text
    .split("\n\n")
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

/** Lettermint over its REST API: tracking off on each mail, no attachment (ADR 0015). */
export const lettermintMailer =
  (config: LettermintConfig, fetcher: Fetcher = fetch): SendMail =>
  async (mail) => {
    let response: Response;
    try {
      response = await fetcher(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-lettermint-token": config.token,
        },
        body: JSON.stringify({
          from: `OpenLinguo <${config.from}>`,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: html(mail.text),
          // The API documents no default and the privacy notice promises no tracking.
          settings: { track_opens: false, track_clicks: false },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return err({ kind: "unreachable", message: `Lettermint unreachable: ${reason}` });
    }
    if (!response.ok) {
      return err({ kind: "rejected", message: `Lettermint answered ${String(response.status)}` });
    }
    return ok(null);
  };
