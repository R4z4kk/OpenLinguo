import type { Mail } from "./mail.ts";

export type Locale = "fr" | "en";

/** French when the first language of `Accept-Language` is French, which the PWA sets to its own. */
export const localeOf = (acceptLanguage: string | null): Locale =>
  acceptLanguage?.trim().toLowerCase().startsWith("fr") ? "fr" : "en";

export const signInCodeMail = (locale: Locale, to: string, code: string): Mail =>
  locale === "fr"
    ? {
        to,
        subject: `Votre code OpenLinguo\u00a0: ${code}`,
        text: `Votre code de connexion à OpenLinguo est ${code}.\n\nIl est valable 10 minutes. Si vous n'avez rien demandé, ignorez ce message.`,
      }
    : {
        to,
        subject: `Your OpenLinguo code: ${code}`,
        text: `Your OpenLinguo sign-in code is ${code}.\n\nIt is valid for 10 minutes. If you did not ask for it, ignore this message.`,
      };
