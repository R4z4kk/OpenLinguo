import { describe, expect, it } from "vitest";
import {
  localeOf,
  noticeDecisionMail,
  noticeReceiptMail,
  signInCodeMail,
  statementOfReasonsMail,
  suspensionMail,
} from "./mail-templates.ts";

describe("localeOf", () => {
  it("picks French for a French first language, English otherwise", () => {
    expect(localeOf("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeOf("FR")).toBe("fr");
    expect(localeOf("en-GB,fr;q=0.5")).toBe("en");
    expect(localeOf(null)).toBe("en");
  });
});

describe("signInCodeMail", () => {
  it("writes the code and its 10 minutes in French and in English", () => {
    const fr = signInCodeMail("fr", "a@example.test", "123456");
    expect(fr.to).toBe("a@example.test");
    expect(fr.subject).toBe("Votre code OpenLinguo : 123456");
    expect(fr.text).toContain("123456");
    expect(fr.text).toContain("10 minutes");
    const en = signInCodeMail("en", "a@example.test", "123456");
    expect(en.subject).toBe("Your OpenLinguo code: 123456");
    expect(en.text).toContain("10 minutes");
  });
});

const facts = { id: "n1", title: "我的猫", reason: "child-sexual-abuse" } as const;

describe("noticeReceiptMail", () => {
  it("gives the notice number, the text and the reason in French and in English", () => {
    const mail = noticeReceiptMail("lin@example.test", facts);
    expect(mail.subject).toContain("n1");
    expect(mail.text).toContain("« 我的猫 »");
    expect(mail.text).toContain("contenu pédopornographique");
    expect(mail.text).toContain("child sexual abuse material");
  });
});

describe("noticeDecisionMail", () => {
  it("says what was decided and how to ask for a review", () => {
    const kept = noticeDecisionMail(
      "lin@example.test",
      facts,
      { outcome: "kept", reply: "Le texte est une citation courte." },
      "contact@example.test",
    );
    expect(kept.text).toContain("reste publié");
    expect(kept.text).toContain("stays published");
    expect(kept.text).toContain("Le texte est une citation courte.");
    expect(kept.text).toContain("contact@example.test");
    const removed = noticeDecisionMail(
      "lin@example.test",
      facts,
      { outcome: "removed", reply: "x" },
      "c",
    );
    expect(removed.text).toContain("a été retiré");
  });
});

describe("statementOfReasonsMail", () => {
  it("says whether the decision follows a notice", () => {
    const statement = {
      id: "d1",
      submissionId: "s1",
      measure: "removed",
      source: "notice",
      ground: "copyright",
      facts: "f",
      explanation: "e",
      automated: false,
      decidedAt: "2026-11-01T10:00:00.000Z",
    } as const;
    const mail = statementOfReasonsMail("a@example.test", "我的猫", statement, "c");
    expect(mail.text).toContain("à la suite d'un signalement");
    expect(mail.text).toContain("after a notice");
    expect(mail.text).not.toContain("lin@example.test");
  });
});

describe("suspensionMail", () => {
  const suspension = {
    id: "a1",
    ground: "hate",
    facts: "Trois textes retirés en octobre.",
    explanation: "Chacun appelle à la haine contre un groupe.",
    endsAt: "2026-12-10T08:00:00.000Z",
    automated: false,
    decidedAt: "2026-11-10T08:00:00.000Z",
  } as const;

  it("gives the measure, its end, the ground, the facts and the redress in French and English", () => {
    const mail = suspensionMail("a@example.test", suspension, "contact@example.test");
    expect(mail.to).toBe("a@example.test");
    expect(mail.subject).toBe("OpenLinguo : votre compte est suspendu / your account is suspended");
    for (const part of [
      "Mesure : suspension du compte jusqu'au 2026-12-10.",
      "Origine : décision prise à l'initiative de l'administrateur, sans signalement sur le compte.",
      "Motif : contenu illégal envoyé plusieurs fois, provocation à la haine, diffamation ou injure discriminatoire (Loi du 29 juillet 1881, art. 24, 32 et 33), règle 4.1 des conditions d'utilisation.",
      "Faits : Trois textes retirés en octobre.",
      "Explication : Chacun appelle à la haine contre un groupe.",
      "Moyens automatisés : aucun.",
      "en écrivant à contact@example.test",
      "Measure: account suspended until 2026-12-10.",
      "Ground: illegal content sent several times, incitement to hatred",
      "rule 4.1 of the terms",
      "Automated means: none.",
      "by writing to contact@example.test",
    ]) {
      expect(mail.text).toContain(part);
    }
  });

  it("says when a suspension has no time limit", () => {
    const mail = suspensionMail("a@example.test", { ...suspension, endsAt: null }, "c");
    expect(mail.text).toContain("Mesure : suspension du compte, sans limite de durée.");
    expect(mail.text).toContain("Measure: account suspended, with no time limit.");
  });
});
