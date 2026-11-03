import { SYNC_LIMITS } from "@openlinguo/core/sync";
import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/i18n";
import type { SyncView } from "@/shell/use-sync";
import { DeletionDialog } from "./account-data";
import { SyncPanel, TurnOffDialog } from "./account-sync";

const NOW = new Date(2026, 10, 3, 18, 42).getTime();
const YESTERDAY = new Date(2026, 10, 2, 21, 5).getTime();

const IDLE: SyncView = { running: false, usage: null, failure: null };
const USAGE = { used: 1_258_291, limit: SYNC_LIMITS.accountBytes, oldest: 1 };

const noop = (): void => {};

const panel = (
  props: Partial<ComponentProps<typeof SyncPanel>> = {},
  language: "fr" | "en" = "fr",
): string => {
  createI18n(language);
  return renderToStaticMarkup(
    <SyncPanel
      mode={{ kind: "off" }}
      view={IDLE}
      now={NOW}
      headingRef={createRef()}
      activating={false}
      problem={null}
      onActivate={noop}
      onSyncNow={noop}
      onTurnOff={noop}
      {...props}
    />,
  );
};

const on = (view: SyncView = IDLE, props: Partial<ComponentProps<typeof SyncPanel>> = {}) =>
  panel({ mode: { kind: "on", lastSyncAt: YESTERDAY }, view, ...props });

/** The text of the markup, as a reader hears it: no tags, no no-break spaces, plain apostrophes. */
const text = (html: string): string =>
  html
    .replaceAll(/<[^>]*>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("’", "'")
    .replaceAll(/\s+/gu, " ");

const alerts = (html: string): string[] =>
  [...html.matchAll(/<p[^>]*role="alert"[^>]*>(.*?)<\/p>/gu)].map(([, body = ""]) =>
    text(body).trim(),
  );

const statuses = (html: string): string[] =>
  [...html.matchAll(/<p[^>]*role="status"[^>]*>(.*?)<\/p>/gu)].map(([, body = ""]) =>
    text(body).trim(),
  );

const button = (html: string, label: string): string | null =>
  [...html.matchAll(/<button[^>]*>.*?<\/button>/gu)].find(([tag = ""]) =>
    text(tag).includes(label),
  )?.[0] ?? null;

describe("the section while sync is off", () => {
  it("explains before it offers the button: what goes, what stays, what is kept and for how long", () => {
    const html = panel();
    const shown = text(html);

    for (const phrase of [
      "Retrouvez vos cartes et votre progression",
      "Ce qui part sur le serveur",
      "Ce qui reste sur cet appareil",
      "seront fusionnées",
      "l'administrateur d'OpenLinguo pourrait les lire",
      "l'adresse IP de chaque envoi pendant 1 an",
      "votre e-mail pendant 5 ans et votre pseudonyme pendant 1 an",
    ])
      expect(shown).toContain(phrase);
    expect(shown.indexOf("seront fusionnées")).toBeLessThan(
      shown.indexOf("Activer la synchronisation"),
    );
    expect(shown.indexOf("5 ans")).toBeLessThan(shown.indexOf("Activer la synchronisation"));
  });

  it("is a heading and a real button, not a switch", () => {
    const html = panel();
    expect(html).toMatch(/<h2[^>]*tabindex="-1"[^>]*>Synchronisation<\/h2>/u);
    expect(button(html, "Activer la synchronisation")).toMatch(/^<button type="button"/u);
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("Synchroniser maintenant");
  });

  it("says in English what it says in French", () => {
    const shown = text(panel({}, "en"));
    expect(shown).toContain("Sync");
    expect(shown).toContain("your email for 5 years and your pseudonym for 1 year");
    expect(shown).toContain("the IP address of each upload for 1 year");
    expect(shown).toContain("OpenLinguo's administrator could read it");
    expect(shown).toContain("will be merged");
    expect(shown).toContain("Start syncing");
  });

  it("shows nothing of a failure that was kept in memory", () => {
    expect(alerts(panel({ view: { ...IDLE, failure: { kind: "unavailable" } } }))).toEqual([]);
  });

  it("shows an activation that failed, in an alert", () => {
    expect(
      alerts(panel({ problem: "Cet appareil n'a pas pu lire ou écrire vos données." })),
    ).toEqual(["Cet appareil n'a pas pu lire ou écrire vos données."]);
  });

  it("an activation under way disables the button and says so", () => {
    const html = panel({ activating: true });
    expect(button(html, "Activer la synchronisation")).toContain('aria-disabled="true"');
    expect(statuses(html)).toContain("Activation de la synchronisation…");
  });
});

describe("the section while sync is on", () => {
  it("gives the last sync and the usage, with a text alternative for the bar", () => {
    const html = on({ ...IDLE, usage: USAGE });

    expect(statuses(html)).toEqual(["Activée. Dernière synchronisation hier à 21:05."]);
    expect(text(html)).toContain("Espace utilisé : 1,2 Mo sur 10 Mo");
    expect(html).toMatch(/role="img" aria-label="12\s% de l’espace utilisé"/u);
    expect(html).toContain("width:12%");
  });

  it("shows no usage before one is known, rather than a made-up one", () => {
    const html = on();
    expect(text(html)).not.toContain("Espace utilisé");
    expect(html).not.toContain('role="img"');
  });

  it("a space almost full still reads at most 100 %", () => {
    const html = on({ ...IDLE, usage: { ...USAGE, used: SYNC_LIMITS.accountBytes + 5 } });
    expect(html).toContain("width:100%");
  });

  it("says when nothing has finished yet", () => {
    expect(statuses(panel({ mode: { kind: "on", lastSyncAt: null } }))).toEqual([
      "Activée. Aucune synchronisation terminée pour l'instant.",
    ]);
  });

  it("holds the explanation in a closed details, from the same strings as the off state", () => {
    const html = on();
    const details = /<details[^>]*>(.*?)<\/details>/su.exec(html)?.[1] ?? "";

    expect(/<details[^>]*>/u.exec(html)?.[0]).not.toContain("open");
    expect(text(details)).toContain("Ce qui est synchronisé");
    const off = text(panel());
    for (const block of [
      "Ce qui part sur le serveur",
      "Ce qui reste sur cet appareil",
      "Ce qu'il faut savoir",
    ]) {
      expect(text(details)).toContain(block);
      expect(off).toContain(block);
    }
    expect(text(details)).not.toContain("Retrouvez vos cartes");
  });

  it("offers « Synchroniser maintenant » and the turn-off, and no activation", () => {
    const html = on();
    expect(button(html, "Synchroniser maintenant")).not.toBeNull();
    expect(button(html, "Désactiver et supprimer du serveur")).not.toBeNull();
    expect(button(html, "Activer la synchronisation")).toBeNull();
    expect(text(html)).toContain("Elle ne vous envoie jamais de notification.");
  });

  it("a sync under way says so and disables « Synchroniser maintenant »", () => {
    const html = on({ ...IDLE, running: true });
    expect(statuses(html)).toEqual(["Synchronisation en cours…"]);
    expect(button(html, "Synchroniser maintenant")).toContain('aria-disabled="true"');
  });

  it("reads a failure in an alert, and keeps the last sync in the status", () => {
    const html = on({ ...IDLE, failure: { kind: "api", failure: { kind: "offline" } } });
    expect(alerts(html)).toEqual([
      "Pas de connexion. Vos changements partiront à la prochaine synchronisation.",
    ]);
    expect(statuses(html)).toEqual(["Activée. Dernière synchronisation hier à 21:05."]);
  });

  it("reads each failure kind in its own alert", () => {
    const seen = new Set<string>();
    for (const failure of [
      { kind: "api", failure: { kind: "offline" } },
      { kind: "api", failure: { kind: "refused", code: "SYNC_QUOTA" } },
      { kind: "unreadable-chunk", chunkId: 2 },
      { kind: "newer-format", version: 2 },
      { kind: "entity-too-large", entityId: "x" },
      { kind: "invalid-row", entityId: "x" },
      { kind: "unavailable" },
      { kind: "storage", message: "x" },
    ] as const) {
      const [alert = ""] = alerts(on({ ...IDLE, failure }));
      expect(alert).not.toBe("");
      seen.add(alert);
    }
    expect(seen.size).toBe(8);
  });

  it("shows nothing for another tab syncing", () => {
    expect(alerts(on({ ...IDLE, failure: { kind: "busy" } }))).toEqual([]);
  });

  it("turned off elsewhere says so and offers to turn on again, which uploads everything", () => {
    const html = on({ ...IDLE, failure: { kind: "turned-off-elsewhere" } });
    expect(alerts(html)[0]).toContain("désactivée depuis un autre appareil");
    expect(button(html, "Activer la synchronisation")).not.toBeNull();
  });

  it("reads in English", () => {
    const html = panel(
      { mode: { kind: "on", lastSyncAt: YESTERDAY }, view: { ...IDLE, usage: USAGE } },
      "en",
    );
    expect(statuses(html)).toEqual(["On. Last sync yesterday at 09:05 PM."]);
    expect(text(html)).toContain("Space used: 1.2 MB of 10 MB");
    expect(html).toContain('aria-label="12% of the space used"');
    expect(button(html, "Sync now")).not.toBeNull();
    expect(button(html, "Turn off and delete from the server")).not.toBeNull();
  });
});

describe("the section for another account", () => {
  it("cuts sync and repeats the merge warning before it offers to turn it on here", () => {
    const html = panel({
      mode: { kind: "other-account" },
      view: { ...IDLE, failure: { kind: "other-account" } },
    });

    expect(statuses(html)).toEqual([
      "Cet appareil était synchronisé avec un autre compte : la synchronisation est coupée. Si vous l'activez ici, tout ce qui se trouve sur cet appareil, y compris ce qui vient de l'autre compte, rejoindra ce compte.",
    ]);
    expect(alerts(html)).toEqual([]);
    expect(button(html, "Activer pour ce compte")).not.toBeNull();
    expect(button(html, "Synchroniser maintenant")).toBeNull();
  });
});

describe("the section when the device cannot be read", () => {
  it("shows the failure, and offers nothing that could not work", () => {
    const html = panel({
      mode: { kind: "unreadable", failure: { kind: "storage", message: "x" } },
    });
    expect(alerts(html)).toEqual([
      "Cet appareil n'a pas pu lire ou écrire vos données. Réessayez, et écrivez-nous si cela continue : openlinguo@gmail.com.",
    ]);
    expect(button(html, "Activer la synchronisation")).toBeNull();
  });

  it("shows only the heading while it reads the device", () => {
    const html = panel({ mode: { kind: "loading" } });
    expect(statuses(html)).toEqual([""]);
    expect(alerts(html)).toEqual([]);
    expect(html).not.toContain("<button");
  });
});

describe("the turn-off confirmation", () => {
  const dialog = (
    props: Partial<ComponentProps<typeof TurnOffDialog>> = {},
    language: "fr" | "en" = "fr",
  ) => {
    createI18n(language);
    return renderToStaticMarkup(
      <TurnOffDialog working={false} problem={null} onClose={noop} onConfirm={noop} {...props} />,
    );
  };

  it("asks first, says what is deleted and what stays, and starts on « Annuler »", () => {
    const html = dialog();
    const shown = text(html);

    expect(shown).toContain("Désactiver la synchronisation ?");
    expect(shown).toContain("Vos données seront supprimées du serveur, pour tous vos appareils.");
    expect(shown).toContain("Elles restent sur cet appareil.");
    expect(shown).toContain(
      "La trace de chaque envoi reste gardée 1 an, comme la loi française nous le demande.",
    );
    expect(button(html, "Annuler")).toContain("data-autofocus");
    expect(button(html, "Désactiver et supprimer")).toContain("border-danger");
  });

  it("reads a failure to turn off in an alert inside the dialog, and says the deletion is under way", () => {
    expect(alerts(dialog({ problem: "Échec." }))).toEqual(["Échec."]);
    const working = dialog({ working: true });
    expect(statuses(working)).toEqual(["Suppression sur le serveur…"]);
    expect(button(working, "Désactiver et supprimer")).toContain('aria-disabled="true"');
  });

  it("reads in English", () => {
    const shown = text(dialog({}, "en"));
    expect(shown).toContain("Turn off sync?");
    expect(shown).toContain("deleted from the server, for all your devices");
  });
});

describe("the account deletion screen", () => {
  const deletion = (language: "fr" | "en") => {
    createI18n(language);
    return text(renderToStaticMarkup(<DeletionDialog onClose={noop} onDeleted={noop} />));
  };

  it("always says what survives if the account has synced", () => {
    expect(deletion("fr")).toContain(
      "Si vous avez utilisé la synchronisation, vos données synchronisées sont supprimées, mais la loi française nous fait garder votre e-mail pendant 5 ans, votre pseudonyme pendant 1 an, et la trace de chaque envoi pendant 1 an. Ils ne servent qu'à répondre à une autorité.",
    );
    expect(deletion("en")).toContain(
      "If you used sync, your synced data is deleted, but French law makes us keep your email for 5 years, your pseudonym for 1 year, and the record of each upload for 1 year.",
    );
  });
});
