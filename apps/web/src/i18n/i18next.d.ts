import "i18next";
import type { authEn } from "./auth/en.ts";
import type { en } from "./en.ts";
import type { moderationEn } from "./moderation/en.ts";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof en;
      auth: typeof authEn;
      moderation: typeof moderationEn;
    };
    strictKeyChecks: true;
  }
}
