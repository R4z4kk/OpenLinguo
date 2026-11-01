import {
  type Ground,
  isLegalGround,
  LEGAL_GROUNDS,
  type NoticeDecision,
  type NoticeReason,
  type StatementOfReasons,
  TERMS_CLAUSES,
} from "@openlinguo/core/moderation";
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

const GROUNDS: Readonly<Record<Ground, Readonly<Record<Locale, string>>>> = {
  copyright: { fr: "atteinte au droit d'auteur", en: "copyright infringement" },
  defamation: { fr: "diffamation", en: "defamation" },
  hate: {
    fr: "provocation à la haine, diffamation ou injure discriminatoire",
    en: "incitement to hatred, discriminatory defamation or insult",
  },
  "personal-data": {
    fr: "données personnelles d'autrui, vie privée",
    en: "other people's personal data, privacy",
  },
  "serious-offences": { fr: "infraction grave", en: "serious criminal offence" },
  "not-chinese": { fr: "le texte n'est pas en chinois", en: "the text is not in Chinese" },
  "duplicate-or-spam": { fr: "doublon ou spam", en: "duplicate or spam" },
  "unsuitable-for-teenagers": {
    fr: "le texte ne convient pas à des adolescents",
    en: "the text is not suitable for teenagers",
  },
};

const groundLine = (locale: Locale, ground: Ground) => {
  const label = GROUNDS[ground][locale];
  if (isLegalGround(ground)) {
    const law = LEGAL_GROUNDS[ground];
    return locale === "fr"
      ? `contenu illégal, ${label} (${law})`
      : `illegal content, ${label} (${law})`;
  }
  const clause = TERMS_CLAUSES[ground];
  return locale === "fr"
    ? `règles de la bibliothèque, article ${clause} des conditions d'utilisation : ${label}`
    : `library rules, clause ${clause} of the terms: ${label}`;
};

const statementText = (
  locale: Locale,
  title: string,
  { measure, source, ground, facts, explanation }: StatementOfReasons,
  contact: string,
) =>
  locale === "fr"
    ? [
        measure === "rejected"
          ? `Votre texte « ${title} » n'a pas été publié dans la bibliothèque d'OpenLinguo.`
          : `Votre texte « ${title} » a été retiré de la bibliothèque d'OpenLinguo.`,
        "",
        measure === "rejected"
          ? "Mesure : refus de publication. Le texte n'est visible nulle part, sans limite de durée."
          : "Mesure : retrait. Le texte n'est plus visible nulle part, sans limite de durée. Les copies déjà importées restent sur les appareils.",
        source === "notice"
          ? "Origine : décision prise à la suite d'un signalement."
          : "Origine : décision prise à l'initiative de l'administrateur, sans signalement.",
        `Motif : ${groundLine("fr", ground)}.`,
        `Faits : ${facts}`,
        `Explication : ${explanation}`,
        "Moyens automatisés : aucun. Une personne a lu le texte et pris la décision.",
        `Recours : vous pouvez demander un réexamen en écrivant à ${contact}. Vous pouvez aussi saisir le tribunal compétent.`,
      ].join("\n")
    : [
        measure === "rejected"
          ? `Your text "${title}" was not published in the OpenLinguo library.`
          : `Your text "${title}" was removed from the OpenLinguo library.`,
        "",
        measure === "rejected"
          ? "Measure: publication refused. The text is visible nowhere, with no time limit."
          : "Measure: removal. The text is no longer visible anywhere, with no time limit. Copies already imported stay on devices.",
        source === "notice"
          ? "Origin: a decision taken after a notice."
          : "Origin: the admin's own initiative, without a notice.",
        `Ground: ${groundLine("en", ground)}.`,
        `Facts: ${facts}`,
        `Explanation: ${explanation}`,
        "Automated means: none. A person read the text and took the decision.",
        `Redress: you may ask for a review by writing to ${contact}. You may also go to the competent court.`,
      ].join("\n");

/** DSA art. 17: French then English, since the submitter's language is not kept. */
export const statementOfReasonsMail = (
  to: string,
  title: string,
  statement: StatementOfReasons,
  contact: string,
): Mail => ({
  to,
  subject:
    statement.measure === "rejected"
      ? "OpenLinguo : votre texte n'a pas été publié / your text was not published"
      : "OpenLinguo : votre texte a été retiré / your text was removed",
  text: `${statementText("fr", title, statement, contact)}\n\n---\n\n${statementText("en", title, statement, contact)}`,
});

const REASONS: Readonly<Record<NoticeReason, Readonly<Record<Locale, string>>>> = {
  copyright: GROUNDS.copyright,
  defamation: GROUNDS.defamation,
  hate: GROUNDS.hate,
  "personal-data": GROUNDS["personal-data"],
  "child-sexual-abuse": {
    fr: "contenu pédopornographique ou abus sexuel sur mineur",
    en: "child sexual abuse material",
  },
  "serious-offences": GROUNDS["serious-offences"],
  "library-rules": {
    fr: "ne respecte pas les règles de la bibliothèque",
    en: "breaks the library rules",
  },
};

export type NoticeMailFacts = {
  readonly id: string;
  readonly title: string;
  readonly reason: NoticeReason;
};

/** DSA art. 16(4): French then English, since the notifier has no account. */
export const noticeReceiptMail = (to: string, { id, title, reason }: NoticeMailFacts): Mail => ({
  to,
  subject: `OpenLinguo : signalement ${id} reçu / notice ${id} received`,
  text: [
    `Nous avons reçu votre signalement ${id} sur le texte « ${title} » (motif : ${REASONS[reason].fr}).`,
    "Une personne va le lire et décider. Vous recevrez la décision par e-mail : sous 24 heures pour une infraction grave, sous 7 jours sinon.",
    "",
    "---",
    "",
    `We received your notice ${id} about the text "${title}" (reason: ${REASONS[reason].en}).`,
    "A person will read it and decide. You will get the decision by email: within 24 hours for a serious offence, within 7 days otherwise.",
  ].join("\n"),
});

/** DSA art. 16(5): the decision and the redress; the submitter's identity is never given. */
export const noticeDecisionMail = (
  to: string,
  { id, title }: NoticeMailFacts,
  { outcome, reply }: Pick<NoticeDecision, "outcome" | "reply">,
  contact: string,
): Mail => ({
  to,
  subject: `OpenLinguo : décision sur le signalement ${id} / decision on notice ${id}`,
  text: [
    outcome === "removed"
      ? `Le texte « ${title} » que vous avez signalé (signalement ${id}) a été retiré de la bibliothèque.`
      : `Le texte « ${title} » que vous avez signalé (signalement ${id}) reste publié.`,
    `Explication : ${reply}`,
    "Moyens automatisés : aucun. Une personne a lu le texte et votre signalement.",
    `Recours : vous pouvez demander un réexamen en écrivant à ${contact}. Vous pouvez aussi saisir le tribunal compétent.`,
    "",
    "---",
    "",
    outcome === "removed"
      ? `The text "${title}" you reported (notice ${id}) was removed from the library.`
      : `The text "${title}" you reported (notice ${id}) stays published.`,
    `Explanation: ${reply}`,
    "Automated means: none. A person read the text and your notice.",
    `Redress: you may ask for a review by writing to ${contact}. You may also go to the competent court.`,
  ].join("\n"),
});

/** ADR 0015: 30 days before the deletion of an unused account, French then English. */
export const inactivityNoticeMail = (to: string, deletionOn: Date, appUrl: string): Mail => {
  const day = deletionOn.toISOString().slice(0, 10);
  const link = `${appUrl}/profile/account`;
  return {
    to,
    subject: `OpenLinguo : votre compte sera supprimé le ${day} / your account will be deleted on ${day}`,
    text: [
      "Aucune connexion à votre compte OpenLinguo depuis 2 ans.",
      `Sans connexion d'ici le ${day}, il sera supprimé ce jour-là. Pour le garder, connectez-vous : ${link}`,
      "Vos textes publiés dans la bibliothèque y resteront, sans nom. Si vous avez envoyé des textes, la loi (décret 2021-1362) nous oblige à garder votre e-mail 5 ans et vos pseudonymes 1 an, sous clé. Vos données d'apprentissage sur vos appareils ne sont pas touchées.",
      "---",
      "No one has signed in to your OpenLinguo account for 2 years.",
      `Unless you sign in by ${day}, it will be deleted that day. To keep it, sign in: ${link}`,
      "Your texts published in the library stay there, with no name. If you sent texts, French law (décret 2021-1362) makes us keep your email for 5 years and your pseudonyms for 1 year, locked away. Your learning data on your devices is not touched.",
    ].join("\n\n"),
  };
};
