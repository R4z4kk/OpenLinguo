import { TERMS_CLAUSES } from "@openlinguo/core/moderation";
import type { ReactNode } from "react";
import type { Language } from "@/i18n/language";
import { Contact, External, List, Paragraph, type LegalDocument } from "./legal-page";

const BY_SA = "https://creativecommons.org/licenses/by-sa/4.0/deed.fr";
const BY_SA_EN = "https://creativecommons.org/licenses/by-sa/4.0/legalcode.en";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/deed.fr";
const CC0_EN = "https://creativecommons.org/publicdomain/zero/1.0/legalcode.en";

/** Rule 3.1 has no entry in `TERMS_CLAUSES`: a statement cites the law itself. */
const Rule = ({
  number,
  title,
  children,
}: {
  readonly number: string;
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <section aria-labelledby={`rule-${number}`} className="mt-4">
    <h3 id={`rule-${number}`} className="font-semibold">
      {number} {title}
    </h3>
    {children}
  </section>
);

export const TERMS: Readonly<Record<Language, LegalDocument>> = {
  fr: {
    title: "Conditions d’utilisation",
    updated: "2026-10-31",
    sections: [
      {
        id: "service",
        heading: "Le service",
        body: (
          <Paragraph>
            OpenLinguo est une application gratuite et libre pour apprendre le chinois. Elle
            fonctionne entièrement sans compte. Un compte, facultatif, sert à envoyer des textes à
            la bibliothèque partagée, que tout le monde peut lire et importer. Il faut avoir 15 ans
            ou plus pour avoir un compte.
          </Paragraph>
        ),
      },
      {
        id: "account",
        heading: "Votre compte",
        body: (
          <List
            items={[
              "Vous vous connectez avec un code reçu par e-mail, ou avec Google ou GitHub. Il n’y a pas de mot de passe.",
              "Un compte est personnel. Protégez l’accès à votre boîte e-mail : elle donne accès au compte.",
              "Vous pouvez supprimer votre compte à tout moment dans Profil › Compte.",
              "Si un compte envoie plusieurs fois des contenus illégaux (règle 3.1), nous pouvons le suspendre, avec les raisons par e-mail.",
            ]}
          />
        ),
      },
      {
        id: "rules",
        heading: "Règles de la bibliothèque",
        body: (
          <>
            <Paragraph>
              Un texte qui ne respecte pas l’une de ces règles est refusé, ou retiré s’il a déjà été
              publié. Chaque décision cite le numéro de la règle.
            </Paragraph>
            <Rule number="3.1" title="Contenu illégal">
              <Paragraph>
                Pas de texte copié sans le droit de le faire (paroles de chansons, livres,
                articles), de diffamation ou d’insulte, de haine ou d’appel à la violence,
                d’informations permettant de reconnaître une autre personne, ni d’aucun contenu
                interdit par la loi.
              </Paragraph>
            </Rule>
            <Rule number={TERMS_CLAUSES["not-chinese"]} title="Pas en chinois">
              <Paragraph>
                La bibliothèque sert à lire du chinois : le texte doit être en chinois.
              </Paragraph>
            </Rule>
            <Rule number={TERMS_CLAUSES["duplicate-or-spam"]} title="Doublon ou spam">
              <Paragraph>
                Pas de texte déjà dans la bibliothèque, de publicité ni de texte sans sens.
              </Paragraph>
            </Rule>
            <Rule
              number={TERMS_CLAUSES["unsuitable-for-teenagers"]}
              title="Inadapté aux adolescents"
            >
              <Paragraph>
                Des adolescents lisent la bibliothèque : pas de contenu sexuel, de violence
                détaillée ni d’incitation à des conduites dangereuses.
              </Paragraph>
            </Rule>
          </>
        ),
      },
      {
        id: "submit",
        heading: "Envoyer un texte",
        body: (
          <>
            <List
              items={[
                <>
                  Un texte que vous avez écrit est publié sous{" "}
                  <External href={BY_SA}>CC BY-SA 4.0</External> : tout le monde peut le lire, le
                  copier et l’adapter, même pour le vendre, en vous citant. Vous déclarez l’avoir
                  écrit et en détenir les droits. Une fois publié, la licence ne peut plus être
                  retirée ; vous pouvez seulement demander que votre nom n’apparaisse plus.
                </>,
                <>
                  Une histoire écrite par une IA dans OpenLinguo est publiée sous{" "}
                  <External href={CC0}>CC0 1.0</External>, sans auteur, avec son badge IA. Vous
                  déclarez qu’elle ne contient aucun texte écrit par quelqu’un d’autre.
                </>,
                "Texte brut, 20 000 caractères au plus, 5 textes en attente au plus par compte. Un texte envoyé ne se modifie pas : retirez-le et envoyez-le de nouveau.",
                "Vous choisissez la signature : votre pseudonyme ou anonyme.",
              ]}
            />
          </>
        ),
      },
      {
        id: "moderation",
        heading: "Modération",
        body: (
          <>
            <Paragraph>
              Une personne, l’éditeur, lit chaque texte avant sa publication et le compare à ces
              règles. Aucune décision n’est prise par une machine : l’application estime seulement
              le niveau HSK du texte, pour le classer.
            </Paragraph>
            <Paragraph>
              Si un texte est refusé ou retiré, vous recevez par e-mail une explication : la mesure,
              les faits, la règle ou la loi en cause, si elle fait suite à un signalement, et vos
              recours.
            </Paragraph>
          </>
        ),
      },
      {
        id: "report",
        heading: "Signaler un texte",
        body: (
          <>
            <Paragraph>
              Tout le monde peut signaler un texte de la bibliothèque avec « Signaler », sans compte
              : le texte, les raisons, votre nom et votre e-mail (facultatifs pour un contenu
              pédopornographique), et une déclaration de bonne foi. Vous recevez un accusé de
              réception si vous donnez votre e-mail, puis la décision.
            </Paragraph>
            <Paragraph>
              Signaler un contenu en sachant que c’est faux est puni d’un an de prison et de 15 000
              € d’amende (LCEN, art. 6, VII).
            </Paragraph>
          </>
        ),
      },
      {
        id: "redress",
        heading: "Contester une décision",
        body: (
          <Paragraph>
            Si vous n’êtes pas d’accord avec une décision, écrivez à <Contact /> dans les six mois :
            une personne la réexamine et vous répond. Vous pouvez aussi saisir les tribunaux
            français.
          </Paragraph>
        ),
      },
      {
        id: "copies",
        heading: "Copies importées",
        body: (
          <Paragraph>
            Un texte importé est copié sur l’appareil de la personne qui l’importe. Si le texte est
            ensuite retiré de la bibliothèque, ces copies restent sur les appareils : nous ne
            pouvons pas les atteindre, et la licence ne peut pas être reprise.
          </Paragraph>
        ),
      },
      {
        id: "availability",
        heading: "Disponibilité",
        body: (
          <Paragraph>
            Le service est gratuit et tenu par une seule personne. Il peut s’interrompre ou
            s’arrêter ; vos données d’apprentissage restent alors sur votre appareil, et
            l’application continue de marcher hors ligne. Les réponses des IA peuvent être fausses.
          </Paragraph>
        ),
      },
      {
        id: "changes",
        heading: "Changements",
        body: (
          <Paragraph>
            Si ces conditions changent sur un point important, l’application le dit avant que le
            changement s’applique. Vous pouvez alors supprimer votre compte.
          </Paragraph>
        ),
      },
      {
        id: "law",
        heading: "Droit applicable",
        body: (
          <Paragraph>
            Ces conditions relèvent du droit français. La version française fait foi. Contact :{" "}
            <Contact />.
          </Paragraph>
        ),
      },
    ],
  },
  en: {
    title: "Terms of use",
    updated: "2026-10-31",
    sections: [
      {
        id: "service",
        heading: "The service",
        body: (
          <Paragraph>
            OpenLinguo is a free, open-source app for learning Chinese. It works entirely without an
            account. An optional account is for sending texts to the shared library, which anyone
            can read and import. You must be 15 or older to have an account.
          </Paragraph>
        ),
      },
      {
        id: "account",
        heading: "Your account",
        body: (
          <List
            items={[
              "You sign in with a code sent by email, or with Google or GitHub. There is no password.",
              "An account is personal. Protect access to your mailbox: it gives access to the account.",
              "You can delete your account at any time in Profile › Account.",
              "If an account sends illegal content several times (rule 3.1), we may suspend it, with the reasons by email.",
            ]}
          />
        ),
      },
      {
        id: "rules",
        heading: "Library rules",
        body: (
          <>
            <Paragraph>
              A text that breaks one of these rules is rejected, or removed if already published.
              Each decision cites the number of the rule.
            </Paragraph>
            <Rule number="3.1" title="Illegal content">
              <Paragraph>
                No text copied without the right to do so (song lyrics, books, articles), no
                defamation or insult, no hatred or call to violence, no information that identifies
                another person, and no content the law forbids.
              </Paragraph>
            </Rule>
            <Rule number={TERMS_CLAUSES["not-chinese"]} title="Not in Chinese">
              <Paragraph>
                The library is for reading Chinese: the text must be in Chinese.
              </Paragraph>
            </Rule>
            <Rule number={TERMS_CLAUSES["duplicate-or-spam"]} title="Duplicate or spam">
              <Paragraph>
                No text already in the library, no advertising and no meaningless text.
              </Paragraph>
            </Rule>
            <Rule
              number={TERMS_CLAUSES["unsuitable-for-teenagers"]}
              title="Unsuitable for teenagers"
            >
              <Paragraph>
                Teenagers read the library: no sexual content, no detailed violence and no
                incitement to dangerous behaviour.
              </Paragraph>
            </Rule>
          </>
        ),
      },
      {
        id: "submit",
        heading: "Sending a text",
        body: (
          <List
            items={[
              <>
                A text you wrote is published under{" "}
                <External href={BY_SA_EN}>CC BY-SA 4.0</External>: anyone may read, copy and adapt
                it, even to sell it, if they credit you. You state that you wrote it and hold the
                rights. Once published, the licence cannot be withdrawn; you can only ask for your
                name to stop appearing.
              </>,
              <>
                A story written by an AI in OpenLinguo is published under{" "}
                <External href={CC0_EN}>CC0 1.0</External>, with no author, with its AI badge. You
                state that it contains no text written by someone else.
              </>,
              "Plain text, 20,000 characters at most, 5 pending texts at most per account. A text sent cannot be edited: withdraw it and send it again.",
              "You choose the signature: your pseudonym or anonymous.",
            ]}
          />
        ),
      },
      {
        id: "moderation",
        heading: "Moderation",
        body: (
          <>
            <Paragraph>
              A person, the publisher, reads every text before it is published and checks it against
              these rules. No decision is made by a machine: the app only estimates the text’s HSK
              level, to file it.
            </Paragraph>
            <Paragraph>
              If a text is rejected or removed, you get an explanation by email: the measure, the
              facts, the rule or law concerned, whether it follows a report, and your redress.
            </Paragraph>
          </>
        ),
      },
      {
        id: "report",
        heading: "Reporting a text",
        body: (
          <>
            <Paragraph>
              Anyone can report a library text with « Report », with no account: the text, the
              reasons, your name and email (optional for child sexual abuse material), and a
              statement of good faith. You get a receipt if you give your email, then the decision.
            </Paragraph>
            <Paragraph>
              Reporting content you know to be false is punished by one year in prison and a €15,000
              fine (LCEN, art. 6, VII).
            </Paragraph>
          </>
        ),
      },
      {
        id: "redress",
        heading: "Contesting a decision",
        body: (
          <Paragraph>
            If you disagree with a decision, write to <Contact /> within six months: a person
            reviews it and answers you. You may also go to the French courts.
          </Paragraph>
        ),
      },
      {
        id: "copies",
        heading: "Imported copies",
        body: (
          <Paragraph>
            An imported text is copied to the device of whoever imports it. If the text is later
            removed from the library, those copies stay on the devices: we cannot reach them, and
            the licence cannot be taken back.
          </Paragraph>
        ),
      },
      {
        id: "availability",
        heading: "Availability",
        body: (
          <Paragraph>
            The service is free and run by one person. It may be interrupted or stop; your learning
            data then stays on your device, and the app keeps working offline. AI answers can be
            wrong.
          </Paragraph>
        ),
      },
      {
        id: "changes",
        heading: "Changes",
        body: (
          <Paragraph>
            If these terms change on an important point, the app says so before the change applies.
            You may then delete your account.
          </Paragraph>
        ),
      },
      {
        id: "law",
        heading: "Applicable law",
        body: (
          <Paragraph>
            These terms are governed by French law. The French version prevails. Contact:{" "}
            <Contact />.
          </Paragraph>
        ),
      },
    ],
  },
};
