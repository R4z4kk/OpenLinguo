import type { Language } from "@/i18n/language";
import { Contact, External, List, Paragraph, type LegalDocument } from "./legal-page";

const REPOSITORY = "https://github.com/R4z4kk/OpenLinguo";
/** LCEN art. 1-1, read on Légifrance on 2026-10-31 (version in force since 2024-05-23). */
const LCEN_1_1 = "https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000049568614";
const PHAROS = "https://www.internet-signalement.gouv.fr";

/** Cloudflare's own privacy policy and website terms, read on 2026-10-31. */
const HOST = ["Cloudflare, Inc.", "101 Townsend St", "San Francisco, CA 94107"] as const;

const Host = ({ country }: { readonly country: string }) => (
  <address className="mt-3 not-italic">
    {[...HOST, country].map((line) => (
      <span key={line} className="block">
        {line}
      </span>
    ))}
  </address>
);

export const LEGAL_NOTICE: Readonly<Record<Language, LegalDocument>> = {
  fr: {
    title: "Mentions légales",
    updated: "2026-10-31",
    sections: [
      {
        id: "publisher",
        heading: "Éditeur",
        body: (
          <>
            <Paragraph>
              OpenLinguo est édité par une personne physique, à titre non professionnel et sans
              rémunération. Comme le permet l’
              <External href={LCEN_1_1}>
                article 1-1, II de la loi n° 2004-575 du 21 juin 2004
              </External>{" "}
              (LCEN), elle ne publie pas son nom ni son adresse : elle les a communiqués à
              l’hébergeur ci-dessous.
            </Paragraph>
            <Paragraph>
              Directeur de la publication : l’éditeur lui-même (loi n° 82-652 du 29 juillet 1982,
              art. 93-2).
            </Paragraph>
          </>
        ),
      },
      {
        id: "host",
        heading: "Hébergeur",
        body: (
          <>
            <Host country="États-Unis" />
            <Paragraph>
              La base de données des comptes et de la bibliothèque est stockée et traitée dans
              l’Union européenne.
            </Paragraph>
          </>
        ),
      },
      {
        id: "contact",
        heading: "Contact",
        body: (
          <>
            <Paragraph>
              Une seule adresse pour tout le monde : <Contact />. Une personne lit chaque message,
              en français ou en anglais.
            </Paragraph>
            <List
              items={[
                "Les utilisateurs et les parents (règlement (UE) 2022/2065, art. 12).",
                "Les autorités (même règlement, art. 11).",
                "Les injonctions de retrait de contenus à caractère terroriste (règlement (UE) 2021/784, art. 15).",
              ]}
            />
          </>
        ),
      },
      {
        id: "reply",
        heading: "Droit de réponse",
        body: (
          <Paragraph>
            Si un texte de la bibliothèque vous met en cause, vous pouvez demander à y répondre dans
            les trois mois qui suivent sa publication. Comme l’éditeur est anonyme, la demande peut
            être adressée à l’hébergeur, qui la transmet (LCEN, art. 1-1, III). Vous pouvez aussi
            écrire à <Contact />.
          </Paragraph>
        ),
      },
      {
        id: "report",
        heading: "Signaler un contenu",
        body: (
          <Paragraph>
            Chaque texte de la bibliothèque a un bouton « Signaler », utilisable sans compte. Pour
            un contenu illégal vu ailleurs sur Internet, utilisez{" "}
            <External href={PHAROS}>PHAROS</External>, la plateforme du ministère de l’Intérieur.
          </Paragraph>
        ),
      },
      {
        id: "licence",
        heading: "Code source et licences",
        body: (
          <Paragraph>
            Le code d’OpenLinguo est libre, sous licence AGPL-3.0, sur{" "}
            <External href={REPOSITORY}>GitHub</External>. Les textes de la bibliothèque gardent la
            licence indiquée sur chacun : CC BY-SA 4.0 pour un texte écrit par un apprenant, CC0 1.0
            pour une histoire écrite par une IA. Les données et les polices utilisées sont citées
            dans « À propos ».
          </Paragraph>
        ),
      },
    ],
  },
  en: {
    title: "Legal notice",
    updated: "2026-10-31",
    sections: [
      {
        id: "publisher",
        heading: "Publisher",
        body: (
          <>
            <Paragraph>
              OpenLinguo is published by a private person, as a non-professional and without pay. As{" "}
              <External href={LCEN_1_1}>article 1-1, II of French law no. 2004-575</External> of 21
              June 2004 (LCEN) allows, they do not publish their name or address: they gave them to
              the host below.
            </Paragraph>
            <Paragraph>
              Publication director: the publisher themself (law no. 82-652 of 29 July 1982, art.
              93-2).
            </Paragraph>
          </>
        ),
      },
      {
        id: "host",
        heading: "Host",
        body: (
          <>
            <Host country="United States" />
            <Paragraph>
              The database of accounts and of the library is stored and processed in the European
              Union.
            </Paragraph>
          </>
        ),
      },
      {
        id: "contact",
        heading: "Contact",
        body: (
          <>
            <Paragraph>
              One address for everyone: <Contact />. A person reads every message, in French or in
              English.
            </Paragraph>
            <List
              items={[
                "Users and parents (Regulation (EU) 2022/2065, art. 12).",
                "Authorities (same Regulation, art. 11).",
                "Removal orders for terrorist content (Regulation (EU) 2021/784, art. 15).",
              ]}
            />
          </>
        ),
      },
      {
        id: "reply",
        heading: "Right of reply",
        body: (
          <Paragraph>
            If a library text names you, you may ask to reply to it within three months of its
            publication. Since the publisher is anonymous, the request can go to the host, which
            passes it on (LCEN, art. 1-1, III). You may also write to <Contact />.
          </Paragraph>
        ),
      },
      {
        id: "report",
        heading: "Report content",
        body: (
          <Paragraph>
            Every library text has a « Report » button, which needs no account. For illegal content
            seen elsewhere on the Internet, use <External href={PHAROS}>PHAROS</External>, the
            French Interior Ministry’s platform.
          </Paragraph>
        ),
      },
      {
        id: "licence",
        heading: "Source code and licences",
        body: (
          <Paragraph>
            OpenLinguo’s code is free software, under the AGPL-3.0, on{" "}
            <External href={REPOSITORY}>GitHub</External>. Library texts keep the licence shown on
            each: CC BY-SA 4.0 for a text written by a learner, CC0 1.0 for a story written by an
            AI. The data and fonts used are credited in « About ».
          </Paragraph>
        ),
      },
    ],
  },
};
