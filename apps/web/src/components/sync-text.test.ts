import { SYNC_LIMITS } from "@openlinguo/core/sync";
import { describe, expect, it } from "vitest";
import type { SyncFailure } from "@/data/sync";
import { createI18n } from "@/i18n";
import { isShown, lastSync, megabytes, syncMessage, type ShownFailure } from "./sync-text";

const plain = (text: string): string => text.replaceAll(/\s/gu, " ").replaceAll("’", "'");

const t = (language: "fr" | "en") => createI18n(language).getFixedT(null, "auth");

const api = (failure: Extract<SyncFailure, { kind: "api" }>["failure"]): ShownFailure => ({
  kind: "api",
  failure,
});

/** The twelve messages of the approved mockup (« Failures »), word for word. */
const DRAWN: readonly (readonly [string, ShownFailure, string])[] = [
  [
    "Hors ligne",
    api({ kind: "offline" }),
    "Pas de connexion. Vos changements partiront à la prochaine synchronisation.",
  ],
  [
    "Espace du compte plein",
    api({ kind: "refused", code: "SYNC_QUOTA" }),
    "Votre espace de synchronisation est plein (10 Mo). Rien n'est perdu sur cet appareil, mais vos nouveaux changements ne partent plus.",
  ],
  [
    "Serveur plein",
    api({ kind: "refused", code: "SYNC_STORE_FULL" }),
    "Le serveur est plein pour le moment. Rien n'est perdu sur cet appareil. Réessayez plus tard.",
  ],
  [
    "Trop d'envois",
    api({ kind: "rate-limited", retryAfterSeconds: 60 }),
    "Trop d'envois en une heure. La synchronisation reprendra d'elle-même.",
  ],
  [
    "Réponse inattendue",
    api({ kind: "unexpected", status: 500 }),
    "Le serveur n'a pas répondu comme prévu. Vos changements attendent sur cet appareil. Réessayez plus tard.",
  ],
  [
    "Lot illisible",
    { kind: "unreadable-chunk", chunkId: 3 },
    "Une donnée reçue du serveur est illisible. La synchronisation est arrêtée et rien n'a été modifié ici. Écrivez-nous : openlinguo@gmail.com.",
  ],
  [
    "Version plus récente",
    { kind: "newer-format", version: 2 },
    "Ces données viennent d'une version plus récente d'OpenLinguo. Mettez l'application à jour pour continuer.",
  ],
  [
    "Désactivée ailleurs",
    { kind: "turned-off-elsewhere" },
    "La synchronisation a été désactivée depuis un autre appareil et les données du serveur ont été supprimées. Tout est encore sur cet appareil. Réactivez-la pour tout renvoyer.",
  ],
  [
    "Élément trop gros",
    { kind: "entity-too-large", entityId: "notes:big" },
    "Un élément est trop volumineux pour être envoyé. Rien n'est perdu, mais la synchronisation est arrêtée. Écrivez-nous : openlinguo@gmail.com.",
  ],
  [
    "Élément invalide",
    { kind: "invalid-row", entityId: "notes:bad" },
    "Un élément de cet appareil n'a pas pu être envoyé. Rien n'est perdu, mais la synchronisation est arrêtée. Écrivez-nous : openlinguo@gmail.com.",
  ],
  [
    "Navigateur",
    { kind: "unavailable" },
    "Ce navigateur ne permet pas la synchronisation. Vous pouvez continuer à apprendre sur cet appareil.",
  ],
  [
    "Stockage",
    { kind: "storage", message: "QuotaExceededError" },
    "Cet appareil n'a pas pu lire ou écrire vos données. Réessayez, et écrivez-nous si cela continue : openlinguo@gmail.com.",
  ],
];

describe("syncMessage", () => {
  it.each(DRAWN)("%s reads as drawn", (_name, failure, text) => {
    expect(plain(syncMessage(t("fr"), failure))).toBe(text);
  });

  it("each of the twelve has its own message in English, none a missing key", () => {
    const messages = DRAWN.map(([, failure]) => syncMessage(t("en"), failure));
    expect(new Set(messages).size).toBe(12);
    for (const message of messages) expect(message).not.toMatch(/^(sync|failure)\./u);
  });

  it("the quota message names the limit the server enforces", () => {
    const message = syncMessage(t("en"), api({ kind: "refused", code: "SYNC_QUOTA" }));
    expect(SYNC_LIMITS.accountBytes).toBe(10 * 1024 * 1024);
    expect(message).toContain("(10 MB)");
  });

  it.each([
    [api({ kind: "refused", code: "TOO_MANY_ATTEMPTS" }), "Trop d'envois"],
    [api({ kind: "refused", code: "SYNC_CHUNK_TOO_LARGE" }), "Élément trop gros"],
    [api({ kind: "refused", code: "UNAUTHORIZED" }), "Réponse inattendue"],
    [api({ kind: "rate-limited", retryAfterSeconds: null }), "Trop d'envois"],
  ] as const)("maps the other API failures", (failure, name) => {
    const expected = DRAWN.find(([drawn]) => drawn === name)?.[2];
    expect(plain(syncMessage(t("fr"), failure))).toBe(expected);
  });
});

describe("isShown", () => {
  it("hides another tab syncing and another account, which the section shows from the device", () => {
    expect(isShown({ kind: "busy" })).toBe(false);
    expect(isShown({ kind: "other-account" })).toBe(false);
    expect(isShown({ kind: "storage", message: "x" })).toBe(true);
  });
});

describe("lastSync", () => {
  const now = new Date(2026, 10, 3, 18, 42).getTime();

  it.each([
    ["fr", new Date(2026, 10, 3, 9, 5), "Activée. Dernière synchronisation aujourd'hui à 09:05."],
    ["fr", new Date(2026, 10, 2, 21, 5), "Activée. Dernière synchronisation hier à 21:05."],
    [
      "fr",
      new Date(2026, 9, 28, 21, 5),
      "Activée. Dernière synchronisation le 28 octobre à 21:05.",
    ],
    [
      "fr",
      new Date(2025, 11, 31, 21, 5),
      "Activée. Dernière synchronisation le 31 décembre 2025 à 21:05.",
    ],
  ] as const)("%s %s", (language, at, text) => {
    expect(plain(lastSync(t(language), language, at.getTime(), now))).toBe(text);
  });

  it("reads in English with the English clock", () => {
    const text = lastSync(t("en"), "en", new Date(2026, 10, 2, 21, 5).getTime(), now);
    expect(plain(text)).toBe("On. Last sync yesterday at 09:05 PM.");
  });
});

describe("megabytes", () => {
  it.each([
    [0, "0 Mo"],
    [1, "0,1 Mo"],
    [1_258_291, "1,2 Mo"],
    [SYNC_LIMITS.accountBytes, "10 Mo"],
  ])("%d bytes read %s, rounded up so a used space never reads empty", (bytes, text) => {
    expect(plain(megabytes(t("fr"), bytes))).toBe(text);
  });
});
