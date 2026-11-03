import { SYNC_LIMITS } from "@openlinguo/core/sync";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ApiFailure } from "@/data/api";
import type { SyncFailure } from "@/data/sync";

const MEBIBYTE = 1024 * 1024;
const DAY_MS = 86_400_000;

/** `busy` is another tab syncing and `other-account` is read from the device: neither is an error. */
export type ShownFailure = Exclude<SyncFailure, { kind: "busy" } | { kind: "other-account" }>;

export const isShown = (failure: SyncFailure): failure is ShownFailure =>
  failure.kind !== "busy" && failure.kind !== "other-account";

/** For a failure no call of the section can return: shown as a device failure, never skipped. */
export const toShown = (failure: SyncFailure): ShownFailure =>
  isShown(failure) ? failure : { kind: "storage", message: failure.kind };

type Text = TFunction<"auth">;

/** Megabytes rounded up, so a space in use never reads as empty. */
export const megabytes = (t: Text, bytes: number): string =>
  t("sync.megabytes", { value: Math.ceil((bytes / MEBIBYTE) * 10) / 10 });

const limit = (t: Text): string => megabytes(t, SYNC_LIMITS.accountBytes);

const apiMessage = (t: Text, failure: ApiFailure): string => {
  switch (failure.kind) {
    case "offline":
      return t("sync.failure.offline");
    case "rate-limited":
      return t("sync.failure.tooMany");
    case "unexpected":
      return t("sync.failure.unexpected");
    case "refused":
      switch (failure.code) {
        case "SYNC_QUOTA":
          return t("sync.failure.quota", { limit: limit(t) });
        case "SYNC_STORE_FULL":
          return t("sync.failure.storeFull");
        case "SYNC_CHUNK_TOO_LARGE":
          return t("sync.failure.tooLarge");
        case "TOO_MANY_ATTEMPTS":
          return t("sync.failure.tooMany");
        default:
          return t("sync.failure.unexpected");
      }
  }
};

/** One sentence per failure kind, as drawn in the mockups. */
export const syncMessage = (t: Text, failure: ShownFailure): string => {
  switch (failure.kind) {
    case "api":
      return apiMessage(t, failure.failure);
    case "unreadable-chunk":
      return t("sync.failure.unreadable");
    case "newer-format":
      return t("sync.failure.newer");
    case "turned-off-elsewhere":
      return t("sync.failure.turnedOffElsewhere");
    case "entity-too-large":
      return t("sync.failure.tooLarge");
    case "invalid-row":
      return t("sync.failure.invalidRow");
    case "unavailable":
      return t("sync.failure.unavailable");
    case "storage":
      return t("sync.failure.storage");
  }
};

const dayStart = (time: number): number => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** « Activée. Dernière synchronisation aujourd'hui à 18:42. », by calendar day on this device. */
export const lastSync = (t: Text, language: string, at: number, now: number): string => {
  const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(at);
  const days = Math.round((dayStart(now) - dayStart(at)) / DAY_MS);
  if (days <= 0) return t("sync.lastToday", { time });
  if (days === 1) return t("sync.lastYesterday", { time });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
  return t("sync.lastOn", { date, time });
};

/** The sync section's wording, bound to the active language. */
export const useSyncText = () => {
  const { t, i18n } = useTranslation("auth");
  return {
    message: (failure: ShownFailure): string => syncMessage(t, failure),
    megabytes: (bytes: number): string => megabytes(t, bytes),
    lastSync: (at: number, now: number): string => lastSync(t, i18n.language, at, now),
  };
};
