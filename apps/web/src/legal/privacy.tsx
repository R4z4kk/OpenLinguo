import { DPF_STATUS, PROCESSOR_FACTS } from "@openlinguo/core/compliance-facts";
import type { Language } from "@/i18n/language";
import { Contact, External, List, Paragraph, Table, type LegalDocument } from "./legal-page";

const CNIL_COMPLAINT = "https://www.cnil.fr/fr/plaintes";
const DECREE = "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000044228912";
const DPF_DECISION = "https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj";
const GROQ_TERMS = "https://console.groq.com/docs/legal/services-agreement";
const OPENROUTER_DATA = "https://openrouter.ai/docs/guides/privacy/data-collection";
const MISTRAL_HELP = "https://help.mistral.ai/en/articles/347617";
const CNIL_AI =
  "https://www.cnil.fr/fr/les-questions-reponses-de-la-cnil-sur-lutilisation-dun-systeme-dia-generative";
const WIKIMEDIA_RETENTION =
  "https://foundation.wikimedia.org/wiki/Policy:Data_retention_guidelines";
const WIKIMEDIA_PRIVACY = "https://foundation.wikimedia.org/wiki/Policy:Privacy_policy";
const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const GITHUB_PRIVACY =
  "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement";

const backupDays = PROCESSOR_FACTS.d1TimeTravelDays.value;
const checked = (language: Language): string =>
  new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(DPF_STATUS.cloudflare.checkedOn),
  );

export const PRIVACY: Readonly<Record<Language, LegalDocument>> = {
  fr: {
    title: "Confidentialité",
    updated: "2026-10-31",
    sections: [
      {
        id: "summary",
        heading: "En bref",
        body: (
          <List
            items={[
              "Sans compte, tout ce que vous apprenez reste sur votre appareil. Nous ne le recevons pas.",
              "Un compte sert seulement à envoyer des textes à la bibliothèque partagée. Il garde votre adresse e-mail et un pseudonyme, jamais de mot de passe.",
              "Pas de publicité, pas de statistiques de visite, pas de pistage, rien n’est vendu.",
              "Vous pouvez télécharger vos données et supprimer votre compte à tout moment.",
              "La loi nous oblige à garder quelques données un an ou cinq ans après certains envois : elles sont détaillées plus bas.",
            ]}
          />
        ),
      },
      {
        id: "controller",
        heading: "Qui est responsable",
        body: (
          <Paragraph>
            Le responsable du traitement est l’éditeur d’OpenLinguo, une personne physique, décrit
            dans les mentions légales. Pour toute question sur vos données : <Contact />. Il n’y a
            pas de délégué à la protection des données : la loi n’en demande pas pour ce service.
          </Paragraph>
        ),
      },
      {
        id: "device",
        heading: "Sur votre appareil",
        body: (
          <>
            <Paragraph>
              Vos cartes, vos révisions, vos textes, votre journal, vos enregistrements et vos
              réglages sont stockés dans votre navigateur. Ils ne quittent l’appareil que si vous
              appuyez sur un bouton qui le dit (IA, Wikidata, envoi à la bibliothèque) ou si vous
              exportez un fichier de sauvegarde.
            </Paragraph>
            <Paragraph>
              Ce stockage est strictement nécessaire au service que vous demandez, il n’a donc pas
              besoin de votre consentement (loi Informatique et Libertés, art. 82). Quand vous êtes
              connecté, un cookie de session sert seulement à vous garder connecté.
            </Paragraph>
            <Paragraph>
              Pour afficher l’application, Cloudflare, notre hébergeur, voit votre adresse IP comme
              n’importe quel site. Nous n’activons aucun journal de visite.
            </Paragraph>
          </>
        ),
      },
      {
        id: "ai",
        heading: "Fonctions d’IA",
        body: (
          <>
            <Paragraph>
              Elles sont éteintes tant que vous ne les réglez pas. Pour avoir des corrections, des
              suggestions de mots, des traductions ou des histoires, choisissez un fournisseur dans
              Profil › Assistant IA et collez votre propre clé : Groq, OpenRouter, Mistral, ou un
              serveur sur cet appareil comme Ollama.
            </Paragraph>
            <Paragraph>
              Une demande part seulement quand vous appuyez sur un bouton d’IA. Elle va directement
              de votre navigateur au fournisseur choisi, sans passer par OpenLinguo : nous ne
              recevons rien. Votre fournisseur la traite selon ses propres conditions, et voit votre
              adresse IP. Ce que chaque bouton envoie est écrit sous le bouton, « Envoyé à … », avec
              les instructions d’OpenLinguo et la langue de l’interface.
            </Paragraph>
            <Paragraph>
              Votre clé est gardée dans votre navigateur, ou en mémoire seulement avec « Ne pas
              mémoriser la clé ». Elle n’est jamais dans le fichier de sauvegarde ni envoyée
              ailleurs qu’à votre fournisseur. « Oublier la clé » l’efface. Utilisez une clé créée
              pour OpenLinguo, avec un plafond de dépense si possible.
            </Paragraph>
            <Paragraph>
              Vérifiez si votre fournisseur entraîne ses modèles sur vos demandes :
            </Paragraph>
            <List
              items={[
                <>
                  Groq n’en a pas le droit sauf si vous l’autorisez (
                  <External href={GROQ_TERMS}>contrat de services</External>, §4.2).
                </>,
                <>
                  OpenRouter ne garde pas vos demandes sauf si vous l’acceptez ; certaines
                  entreprises derrière ses modèles peuvent les garder (
                  <External href={OPENROUTER_DATA}>collecte des données</External>).
                </>,
                <>
                  Le mode gratuit de Mistral peut s’entraîner sur vos échanges jusqu’à ce que vous
                  refusiez (<External href={MISTRAL_HELP}>aide Mistral</External>).
                </>,
                "Avec un serveur sur cet appareil, rien ne sort de l’appareil.",
              ]}
            />
            <Paragraph>
              N’écrivez rien sur votre santé, votre religion, vos opinions politiques ou votre vie
              sexuelle dans le journal ou vos centres d’intérêt : votre fournisseur reçoit ce que
              vous envoyez (<External href={CNIL_AI}>conseils de la CNIL</External>). Chaque réponse
              d’IA porte « Généré par IA · modèle ».
            </Paragraph>
          </>
        ),
      },
      {
        id: "wikidata",
        heading: "Recherche de noms sur Wikidata",
        body: (
          <>
            <Paragraph>
              Dans le panneau des mots inconnus, « Chercher sur Wikidata » envoie, après un avis
              montré la première fois, les suites de caractères que le dictionnaire ne connaît pas
              (50 au plus par demande) au service de la Wikimedia Foundation, aux États-Unis,
              directement depuis votre navigateur. Ni les phrases, ni le reste du texte, ni son
              titre ne sont envoyés ; votre adresse IP et votre navigateur le sont, comme pour tout
              site, sans cookie ni page d’origine.
            </Paragraph>
            <Paragraph>
              Wikimedia supprime, agrège ou anonymise ses journaux après 90 jours au plus, et ses
              sauvegardes peuvent durer 5 ans (
              <External href={WIKIMEDIA_RETENTION}>règles de conservation</External>). Sa{" "}
              <External href={WIKIMEDIA_PRIVACY}>politique de confidentialité</External> explique
              comment lui demander l’accès ou l’effacement. Les réponses sont gardées sur votre
              appareil.
            </Paragraph>
          </>
        ),
      },
      {
        id: "account",
        heading: "Votre compte",
        body: (
          <>
            <Paragraph>
              Un compte sert à envoyer des textes à la bibliothèque. Nous gardons votre adresse
              e-mail, votre pseudonyme (vide tant que vous n’en choisissez pas), l’identifiant de
              votre compte Google ou GitHub si vous vous connectez ainsi, vos sessions (adresse IP,
              navigateur), la date de votre réponse sur l’âge et, si vous l’activez, la vérification
              en deux étapes (chiffrée). Pas de mot de passe, pas de nom ni de photo venant de
              Google ou GitHub.
            </Paragraph>
            <Paragraph>
              Base légale : le contrat, c’est-à-dire les conditions d’utilisation (RGPD, art.
              6(1)(b)). L’adresse e-mail est nécessaire pour avoir un compte : sans elle, vous
              utilisez l’application sans compte.
            </Paragraph>
            <List
              items={[
                "Code par e-mail : le code est envoyé par Scaleway, en France, sans pixel de suivi.",
                <>
                  Google ou GitHub : ils agissent sous leur propre responsabilité, selon leur{" "}
                  <External href={GOOGLE_PRIVACY}>politique (Google)</External> ou leur{" "}
                  <External href={GITHUB_PRIVACY}>déclaration (GitHub)</External>. Pour l’Europe,
                  Google est représenté par Google Ireland Limited.
                </>,
              ]}
            />
            <Paragraph>
              Il faut avoir 15 ans ou plus pour avoir un compte. Juste après la première connexion,
              nous vous demandons votre âge. « J’ai moins de 15 ans » supprime le compte tout de
              suite ; l’application reste utilisable sans compte.
            </Paragraph>
          </>
        ),
      },
      {
        id: "library",
        heading: "La bibliothèque partagée",
        body: (
          <>
            <Paragraph>
              Quand vous envoyez un texte, nous gardons le texte, son origine, sa licence, votre
              signature (pseudonyme ou anonyme), vos déclarations et leur date. Une personne le lit
              avant toute publication. Un texte publié est public, avec la signature choisie. Si un
              texte est refusé ou retiré, vous recevez par e-mail les raisons de la décision.
            </Paragraph>
            <Paragraph>
              N’y mettez rien qui permette de reconnaître quelqu’un, vous compris : nom complet,
              école, ville, téléphone.
            </Paragraph>
            <Paragraph>
              Tout le monde peut signaler un texte, sans compte. Un signalement contient le texte
              visé, les raisons, et un nom et une adresse e-mail (facultatifs pour un contenu
              pédopornographique). La personne qui a écrit le texte reçoit la décision, jamais le
              nom de qui l’a signalé. Base légale : l’obligation légale (règlement (UE) 2022/2065,
              art. 16 et 17).
            </Paragraph>
          </>
        ),
      },
      {
        id: "legal-retention",
        heading: "Ce que la loi nous oblige à garder",
        body: (
          <>
            <Paragraph>
              Un hébergeur doit garder de quoi identifier qui a publié un contenu (LCEN, art. 6, V ;{" "}
              <External href={DECREE}>décret n° 2021-1362</External>), seulement avec ce qu’il
              collecte déjà :
            </Paragraph>
            <List
              items={[
                "pour chaque envoi, modification ou retrait d’un texte : l’adresse IP et l’heure, un an ;",
                "si vous supprimez un compte qui a envoyé des textes : votre adresse e-mail, cinq ans, et votre pseudonyme, un an.",
              ]}
            />
            <Paragraph>
              Ces données sont mises à part, ne sont lues par personne dans l’application, et ne
              sont données qu’à une autorité qui les demande par écrit selon la loi. Base légale :
              l’obligation légale (RGPD, art. 6(1)(c)). Elles restent après la suppression du
              compte, comme l’écran de suppression le dit.
            </Paragraph>
          </>
        ),
      },
      {
        id: "security",
        heading: "Journaux de sécurité",
        body: (
          <Paragraph>
            Chaque connexion, échec, code envoyé et action d’administration est noté avec l’adresse
            IP, le navigateur et l’heure, pour repérer les abus et les intrusions, pendant six mois.
            Base légale : notre intérêt légitime à protéger le service et vos comptes (RGPD, art.
            6(1)(f)).
          </Paragraph>
        ),
      },
      {
        id: "objection",
        heading: "Votre droit d’opposition",
        body: (
          <Paragraph>
            Vous pouvez vous opposer à tout moment aux journaux de sécurité, pour des raisons tenant
            à votre situation (RGPD, art. 21) : écrivez à <Contact />. Nous arrêtons, sauf si un
            motif impérieux l’emporte, par exemple une attaque en cours contre votre compte. Ce
            droit ne s’applique pas aux données gardées par obligation légale.
          </Paragraph>
        ),
      },
      {
        id: "retention",
        heading: "Combien de temps",
        body: (
          <Table
            caption="Durées de conservation"
            head={["Données", "Durée"]}
            rows={[
              [
                "Compte",
                "Jusqu’à sa suppression ; après 2 ans sans action, un e-mail, puis suppression 30 jours plus tard",
              ],
              ["Compte sans réponse sur l’âge", "24 heures"],
              ["Sessions, codes de connexion", "Jusqu’à leur expiration (codes : 10 minutes)"],
              ["Textes en attente ou refusés", "Supprimés avec le compte"],
              [
                "Textes publiés",
                "Tant qu’ils sont publiés ; à la suppression du compte, vous choisissez : garder avec votre nom, garder anonyme (par défaut) ou retirer",
              ],
              ["Décisions de modération, signalements", "1 an après la décision"],
              ["Adresse IP et heure de chaque envoi de texte", "1 an"],
              [
                "E-mail et pseudonyme d’un compte supprimé qui a envoyé des textes",
                "E-mail 5 ans, pseudonyme 1 an",
              ],
              ["Journaux de sécurité", "6 mois"],
              ["Sauvegardes de la base", `${String(backupDays)} jours`],
              ["Demandes par e-mail (droits, aide)", "Jusqu’à la réponse, puis 5 ans comme preuve"],
            ]}
          />
        ),
      },
      {
        id: "recipients",
        heading: "Qui d’autre voit vos données",
        body: (
          <>
            <List
              items={[
                "Cloudflare, Inc. héberge l’application, l’API et la base de données, pour notre compte et selon nos instructions (contrat de sous-traitance). La base est stockée et traitée dans l’Union européenne.",
                "Scaleway SAS envoie les e-mails, pour notre compte, en France. Le contenu d’un e-mail est effacé une fois remis ; Scaleway garde l’adresse et le statut d’envoi tant que notre domaine d’envoi est actif.",
                "Google Ireland ou GitHub, seulement si vous vous connectez avec eux. Google héberge aussi la boîte de contact (Gmail) : il reçoit les messages que vous y envoyez.",
                "Les autorités, seulement sur demande écrite prévue par la loi, ou quand nous devons signaler une infraction grave.",
              ]}
            />
            <Paragraph>
              Cloudflare, Inc. est une société américaine : des données peuvent passer par ses
              serveurs hors de l’Union. Ce transfert repose sur la{" "}
              <External href={DPF_DECISION}>
                décision d’adéquation de la Commission européenne
              </External>{" "}
              pour le Data Privacy Framework, auquel Cloudflare adhère (vérifié le {checked("fr")}),
              et sur les clauses contractuelles types de son contrat. GitHub, et Google pour la
              boîte de contact, peuvent aussi traiter des données aux États-Unis, sous le même
              cadre.
            </Paragraph>
          </>
        ),
      },
      {
        id: "rights",
        heading: "Vos droits",
        body: (
          <>
            <Paragraph>
              Vous pouvez accéder à vos données, les corriger, les effacer, les récupérer, limiter
              leur usage ou vous y opposer. Dans Profil › Compte, vous pouvez changer votre
              pseudonyme, télécharger vos données (JSON) et supprimer votre compte. Pour le reste,
              écrivez à <Contact /> : nous répondons dans un mois, ou nous vous disons dans ce mois
              pourquoi il nous faut jusqu’à deux mois de plus.
            </Paragraph>
            <Paragraph>
              Aucune décision vous concernant n’est prise par une machine seule. Si vous pensez que
              vos droits ne sont pas respectés, vous pouvez{" "}
              <External href={CNIL_COMPLAINT}>adresser une plainte à la CNIL</External>.
            </Paragraph>
          </>
        ),
      },
      {
        id: "parents",
        heading: "Parents",
        body: (
          <Paragraph>
            Si votre enfant a un compte, vous pouvez demander qu’il soit supprimé en écrivant à{" "}
            <Contact />, avec l’adresse e-mail du compte. Nous prévenons votre enfant par e-mail
            avant de le supprimer.
          </Paragraph>
        ),
      },
      {
        id: "changes",
        heading: "Changements",
        body: (
          <Paragraph>
            Si cette page change sur un point important, l’application le dit avant que le
            changement s’applique. La date en haut de la page est celle du dernier changement.
          </Paragraph>
        ),
      },
    ],
  },
  en: {
    title: "Privacy",
    updated: "2026-10-31",
    sections: [
      {
        id: "summary",
        heading: "In short",
        body: (
          <List
            items={[
              "Without an account, everything you learn stays on your device. We do not receive it.",
              "An account is only for sending texts to the shared library. It keeps your email address and a pseudonym, never a password.",
              "No ads, no visit statistics, no tracking, nothing is sold.",
              "You can download your data and delete your account at any time.",
              "The law makes us keep a few data for one or five years after some submissions: they are listed below.",
            ]}
          />
        ),
      },
      {
        id: "controller",
        heading: "Who is responsible",
        body: (
          <Paragraph>
            The controller is the publisher of OpenLinguo, a private person, described in the legal
            notice. For any question about your data: <Contact />. There is no data protection
            officer: the law does not require one for this service.
          </Paragraph>
        ),
      },
      {
        id: "device",
        heading: "On your device",
        body: (
          <>
            <Paragraph>
              Your cards, reviews, texts, journal, recordings and settings are stored in your
              browser. They leave the device only when you press a button that says so (AI,
              Wikidata, sending to the library) or when you export a backup file.
            </Paragraph>
            <Paragraph>
              This storage is strictly necessary for the service you ask for, so it needs no consent
              (French Data Protection Act, art. 82). When you are signed in, a session cookie only
              keeps you signed in.
            </Paragraph>
            <Paragraph>
              To show the app, Cloudflare, our host, sees your IP address like any website. We turn
              on no visit logs.
            </Paragraph>
          </>
        ),
      },
      {
        id: "ai",
        heading: "AI features",
        body: (
          <>
            <Paragraph>
              They are off until you set them up. To get corrections, word suggestions, translations
              or stories, choose a provider in Profile › AI assistant and paste your own key: Groq,
              OpenRouter, Mistral, or a server on this device such as Ollama.
            </Paragraph>
            <Paragraph>
              A request leaves only when you press an AI button. It goes straight from your browser
              to the provider you chose, never through OpenLinguo: we receive nothing. Your provider
              handles it under its own terms, and sees your IP address. What each button sends is
              written under it, « Sent: … », along with OpenLinguo’s instructions and the interface
              language.
            </Paragraph>
            <Paragraph>
              Your key is kept in your browser, or in memory only with « Don’t remember the key ».
              It is never in the backup file or sent anywhere but to your provider. « Forget the key
              » deletes it. Use a key made for OpenLinguo, with a spending cap if you can.
            </Paragraph>
            <Paragraph>Check whether your provider trains its models on your requests:</Paragraph>
            <List
              items={[
                <>
                  Groq may not, unless you allow it (
                  <External href={GROQ_TERMS}>services agreement</External>, §4.2).
                </>,
                <>
                  OpenRouter does not store your requests unless you opt in; some companies behind
                  its models may keep them (
                  <External href={OPENROUTER_DATA}>data collection</External>).
                </>,
                <>
                  Mistral’s free mode may train on your exchanges until you opt out (
                  <External href={MISTRAL_HELP}>Mistral help</External>).
                </>,
                "With a server on this device, nothing leaves the device.",
              ]}
            />
            <Paragraph>
              Don’t write about your health, religion, political opinions or sex life in the journal
              or your interests: your provider receives what you send (
              <External href={CNIL_AI}>CNIL advice</External>). Every AI answer shows « Generated by
              AI · model ».
            </Paragraph>
          </>
        ),
      },
      {
        id: "wikidata",
        heading: "Looking up names on Wikidata",
        body: (
          <>
            <Paragraph>
              In the unknown-words panel, « Search on Wikidata » sends, after a notice shown the
              first time, the character sequences the dictionary does not know (50 at most per
              request) to the Wikimedia Foundation’s service, in the United States, straight from
              your browser. Neither the sentences, nor the rest of the text, nor its title are sent;
              your IP address and browser are, as for any website, with no cookie and no referrer.
            </Paragraph>
            <Paragraph>
              Wikimedia deletes, aggregates or de-identifies its logs after at most 90 days, and its
              backups can last 5 years (
              <External href={WIKIMEDIA_RETENTION}>retention guidelines</External>). Its{" "}
              <External href={WIKIMEDIA_PRIVACY}>privacy policy</External> says how to ask it for
              access or removal. The answers are kept on your device.
            </Paragraph>
          </>
        ),
      },
      {
        id: "account",
        heading: "Your account",
        body: (
          <>
            <Paragraph>
              An account is for sending texts to the library. We keep your email address, your
              pseudonym (empty until you choose one), your Google or GitHub account id if you sign
              in that way, your sessions (IP address, browser), the date of your answer about your
              age and, if you turn it on, two-step verification (encrypted). No password, no name or
              picture from Google or GitHub.
            </Paragraph>
            <Paragraph>
              Legal basis: the contract, that is the terms of use (GDPR art. 6(1)(b)). The email
              address is needed to have an account: without it, you use the app without one.
            </Paragraph>
            <List
              items={[
                "Code by email: the code is sent by Scaleway, in France, with no tracking pixel.",
                <>
                  Google or GitHub: they act under their own responsibility, under their{" "}
                  <External href={GOOGLE_PRIVACY}>policy (Google)</External> or{" "}
                  <External href={GITHUB_PRIVACY}>statement (GitHub)</External>. In Europe, Google
                  acts through Google Ireland Limited.
                </>,
              ]}
            />
            <Paragraph>
              You must be 15 or older to have an account. Right after the first sign-in, we ask your
              age. « I am under 15 » deletes the account at once; the app stays usable without an
              account.
            </Paragraph>
          </>
        ),
      },
      {
        id: "library",
        heading: "The shared library",
        body: (
          <>
            <Paragraph>
              When you send a text, we keep the text, its origin, its licence, your signature
              (pseudonym or anonymous), your statements and their date. A person reads it before
              anything is published. A published text is public, with the signature you chose. If a
              text is rejected or removed, you get the reasons for the decision by email.
            </Paragraph>
            <Paragraph>
              Leave out anything that identifies someone, yourself included: full name, school,
              town, phone.
            </Paragraph>
            <Paragraph>
              Anyone can report a text, with no account. A report holds the text concerned, the
              reasons, and a name and email address (optional for child sexual abuse material). The
              person who wrote the text gets the decision, never the name of who reported it. Legal
              basis: legal obligation (Regulation (EU) 2022/2065, arts 16 and 17).
            </Paragraph>
          </>
        ),
      },
      {
        id: "legal-retention",
        heading: "What the law makes us keep",
        body: (
          <>
            <Paragraph>
              A host must keep what identifies whoever published a content (LCEN, art. 6, V;{" "}
              <External href={DECREE}>décret no. 2021-1362</External>), only with what it already
              collects:
            </Paragraph>
            <List
              items={[
                "for each submission, edit or withdrawal of a text: the IP address and the time, for one year;",
                "if you delete an account that sent texts: your email address for five years, and your pseudonym for one year.",
              ]}
            />
            <Paragraph>
              These data are set apart, read by no one in the app, and given only to an authority
              that asks in writing under the law. Legal basis: legal obligation (GDPR art. 6(1)(c)).
              They remain after the account is deleted, as the deletion screen says.
            </Paragraph>
          </>
        ),
      },
      {
        id: "security",
        heading: "Security logs",
        body: (
          <Paragraph>
            Every sign-in, failure, code sent and admin action is logged with the IP address, the
            browser and the time, to spot abuse and intrusions, for six months. Legal basis: our
            legitimate interest in protecting the service and your account (GDPR art. 6(1)(f)).
          </Paragraph>
        ),
      },
      {
        id: "objection",
        heading: "Your right to object",
        body: (
          <Paragraph>
            You may object at any time to the security logs, on grounds relating to your situation
            (GDPR art. 21): write to <Contact />. We stop, unless a compelling reason overrides it,
            such as an attack on your account in progress. This right does not apply to the data
            kept under a legal obligation.
          </Paragraph>
        ),
      },
      {
        id: "retention",
        heading: "How long",
        body: (
          <Table
            caption="Retention periods"
            head={["Data", "Kept"]}
            rows={[
              [
                "Account",
                "Until deleted; after 2 years without action, an email, then deletion 30 days later",
              ],
              ["Account with no answer about age", "24 hours"],
              ["Sessions, sign-in codes", "Until they expire (codes: 10 minutes)"],
              ["Pending or rejected texts", "Deleted with the account"],
              [
                "Published texts",
                "While published; when you delete the account, you choose: keep with your name, keep as anonymous (default) or remove",
              ],
              ["Moderation decisions, reports", "1 year after the decision"],
              ["IP address and time of each text submission", "1 year"],
              [
                "Email and pseudonym of a deleted account that sent texts",
                "Email 5 years, pseudonym 1 year",
              ],
              ["Security logs", "6 months"],
              ["Database backups", `${String(backupDays)} days`],
              ["Requests by email (rights, help)", "Until answered, then 5 years as proof"],
            ]}
          />
        ),
      },
      {
        id: "recipients",
        heading: "Who else sees your data",
        body: (
          <>
            <List
              items={[
                "Cloudflare, Inc. hosts the app, the API and the database, on our behalf and on our instructions (processing agreement). The database is stored and processed in the European Union.",
                "Scaleway SAS sends the emails, on our behalf, in France. An email’s content is erased once delivered; Scaleway keeps the address and delivery status while our sending domain is active.",
                "Google Ireland or GitHub, only if you sign in with them. Google also hosts the contact mailbox (Gmail): it receives the messages you send there.",
                "Authorities, only on a written request provided for by law, or when we must report a serious offence.",
              ]}
            />
            <Paragraph>
              Cloudflare, Inc. is a U.S. company: data may pass through its servers outside the EU.
              This transfer relies on the{" "}
              <External href={DPF_DECISION}>European Commission’s adequacy decision</External> for
              the Data Privacy Framework, which Cloudflare has joined (checked on {checked("en")}),
              and on the standard contractual clauses of its agreement. GitHub, and Google for the
              contact mailbox, may also process data in the U.S., under the same framework.
            </Paragraph>
          </>
        ),
      },
      {
        id: "rights",
        heading: "Your rights",
        body: (
          <>
            <Paragraph>
              You may access your data, correct it, erase it, take it with you, restrict its use or
              object to it. In Profile › Account, you can change your pseudonym, download your data
              (JSON) and delete your account. For anything else, write to <Contact />: we answer
              within one month, or tell you within that month why we need up to two more.
            </Paragraph>
            <Paragraph>
              No decision about you is made by a machine alone. If you think your rights are not
              respected, you may{" "}
              <External href={CNIL_COMPLAINT}>lodge a complaint with the CNIL</External>, the French
              data protection authority.
            </Paragraph>
          </>
        ),
      },
      {
        id: "parents",
        heading: "Parents",
        body: (
          <Paragraph>
            If your child has an account, you may ask for it to be deleted by writing to <Contact />
            , with the account’s email address. We tell your child by email before deleting it.
          </Paragraph>
        ),
      },
      {
        id: "changes",
        heading: "Changes",
        body: (
          <Paragraph>
            If this page changes on an important point, the app says so before the change applies.
            The date at the top of the page is that of the last change.
          </Paragraph>
        ),
      },
    ],
  },
};
