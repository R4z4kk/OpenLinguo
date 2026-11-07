import { DPF_STATUS, PROCESSOR_FACTS } from "@openlinguo/core/compliance-facts";
import type { Language } from "@/i18n/language";
import {
  Contact,
  External,
  List,
  Paragraph,
  REPOSITORY,
  Table,
  type LegalDocument,
} from "./legal-page";

const HISTORY = `${REPOSITORY}/commits/main/apps/web/src/legal/privacy.tsx`;

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
    updated: "2026-11-04",
    sections: [
      {
        id: "summary",
        heading: "En bref",
        body: (
          <List
            items={[
              "Sans compte, tout ce que vous apprenez reste sur votre appareil. Nous ne le recevons pas.",
              "Un compte sert à envoyer des textes à la bibliothèque partagée et, si vous l’activez, à synchroniser vos appareils. Il garde votre adresse e-mail et un pseudonyme, jamais de mot de passe.",
              "La synchronisation est facultative. Si vous l’activez, vos révisions, vos cartes, vos paquets, vos notes et vos mots « Je connais » vont sur le serveur, sans chiffrement de bout en bout.",
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
              appuyez sur un bouton qui le dit (IA, Wikidata, envoi à la bibliothèque), si vous
              exportez un fichier de sauvegarde ou, pour une partie d’entre eux, si vous activez la
              synchronisation.
            </Paragraph>
            <Paragraph>
              Ce stockage est strictement nécessaire au service que vous demandez, il n’a donc pas
              besoin de votre consentement (loi Informatique et Libertés, art. 82). Quand vous êtes
              connecté, un cookie de session sert seulement à vous garder connecté. Pendant une
              connexion avec Google ou GitHub, un cookie de dix minutes au plus protège l’échange.
              Il n’y a aucun autre cookie.
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
              Un compte sert à envoyer des textes à la bibliothèque et à synchroniser vos appareils.
              Nous gardons votre adresse e-mail, votre pseudonyme (vide tant que vous n’en
              choisissez pas), l’identifiant de votre compte Google ou GitHub si vous vous connectez
              ainsi, vos sessions (adresse IP, navigateur), la date de votre réponse sur l’âge et,
              si vous l’activez, la vérification en deux étapes (chiffrée). Pas de mot de passe, pas
              de nom ni de photo venant de Google ou GitHub.
            </Paragraph>
            <Paragraph>
              Base légale : le contrat, c’est-à-dire les conditions d’utilisation (RGPD, art.
              6(1)(b)). L’adresse e-mail est nécessaire pour avoir un compte : sans elle, vous
              utilisez l’application sans compte.
            </Paragraph>
            <List
              items={[
                "Code par e-mail : le code est envoyé par Lettermint, aux Pays-Bas, sans pixel de suivi.",
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
        id: "sync",
        heading: "La synchronisation",
        body: (
          <>
            <Paragraph>
              Elle vous fait retrouver vos cartes et votre progression sur vos autres appareils.
              Elle est éteinte tant que vous ne l’activez pas dans Profil › Compte, après une
              explication. Une fois activée, elle se fait toute seule : à l’ouverture de
              l’application, quand vous y revenez, quand vous la quittez avec des changements à
              envoyer, en fin de séance et au retour du réseau, et quand vous appuyez sur «
              Synchroniser maintenant ». Elle ne vous envoie jamais de notification. Base légale :
              le contrat (RGPD, art. 6(1)(b)).
            </Paragraph>
            <List
              items={[
                "Ce qui part sur le serveur : vos révisions (le mot, votre réponse, la date, l’heure, votre fuseau horaire, votre objectif du jour, si le mot est fini pour ce jour), vos cartes, vos paquets et leurs mots, vos notes, vos mots marqués « Je connais ».",
                "Ce qui reste sur cet appareil : votre journal, vos défis, vos textes, vos réglages, l’audio, votre voix et votre clé IA.",
              ]}
            />
            <Paragraph>
              Ces données ne sont pas chiffrées de bout en bout : l’administrateur d’OpenLinguo
              pourrait les lire, y compris les heures de vos révisions. Il ne le fait que pour un
              incident ou une demande officielle. Dans l’application, seuls vos appareils les
              reçoivent : aucun autre apprenant ne les voit.
            </Paragraph>
            <Paragraph>
              Les données de cet appareil et celles de votre compte sont fusionnées. Si un appareil
              a servi à un autre compte, ce qui en vient rejoint aussi le vôtre : l’écran vous
              prévient avant.
            </Paragraph>
            <Paragraph>
              Elles restent sur le serveur jusqu’à ce que vous les supprimiez ou que le compte soit
              supprimé. « Désactiver et supprimer du serveur », depuis un seul appareil, les
              supprime pour tous vos appareils ; elles restent sur vos appareils. Sur un appareil où
              la synchronisation est éteinte, « Supprimer les données du serveur » les supprime
              aussi pour tous vos appareils, mais elles ne sont peut-être pas toutes sur cet
              appareil. Pour vous le proposer, Profil › Compte demande au serveur s’il reste des
              données : cette question ne laisse pas de trace et rien n’est gardé sur l’appareil. Se
              déconnecter arrête la synchronisation sur cet appareil, mais ne supprime rien du
              serveur. Attention : changer ou supprimer une note ou un paquet sur un appareil ne
              l’efface pas du serveur. L’ancien envoi y reste, et dans le fichier de vos données,
              jusqu’à ce que ces données soient supprimées. Ce qui est supprimé disparaît des
              sauvegardes de la base au bout de {String(backupDays)} jours.
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
              Un hébergeur doit garder de quoi identifier qui a créé un contenu (LCEN, art. 6, V ;{" "}
              <External href={DECREE}>décret n° 2021-1362</External>), seulement avec ce qu’il
              collecte déjà :
            </Paragraph>
            <List
              items={[
                "pour chaque envoi, modification ou retrait d’un texte : l’adresse IP, les versions HTTP et TLS de la connexion et l’heure, un an ;",
                "pour chaque envoi à la synchronisation et chaque suppression de vos données synchronisées : l’adresse IP, les versions HTTP et TLS de la connexion et l’heure, un an. Recevoir vos données sur un appareil ne laisse pas de trace ;",
                "si vous supprimez un compte qui a encore des textes, des données synchronisées ou l’une de ces traces : votre adresse e-mail, cinq ans, et votre pseudonyme, un an.",
              ]}
            />
            <Paragraph>
              Ces données sont mises à part, ne sont lues par personne dans l’application, et ne
              sont données qu’à une autorité qui les demande par écrit selon la loi, ou à vous si
              vous les demandez. Base légale : l’obligation légale (RGPD, art. 6(1)(c)). Elles
              restent après la suppression du compte, comme l’écran de suppression le dit.
            </Paragraph>
            <Paragraph>
              Le décret ne dit pas clairement s’il vise aussi ce qui reste privé, comme la
              synchronisation. Ne pas l’appliquer pourrait être puni par la loi : par prudence, nous
              l’appliquons. Vos données synchronisées elles-mêmes sont supprimées, seules ces traces
              restent.
            </Paragraph>
          </>
        ),
      },
      {
        id: "security",
        heading: "Journaux de sécurité",
        body: (
          <Paragraph>
            Chaque connexion, échec, code envoyé, code de l’authentificateur et action
            d’administration est noté avec l’adresse IP, le navigateur et l’heure, pour repérer les
            abus et les intrusions, pendant six mois, même si le compte est supprimé entre-temps (la
            ligne n’est alors plus liée à un compte). Des compteurs limitent aussi le nombre de
            demandes, par adresse IP ou, pour la synchronisation, par compte : ils sont effacés
            chaque jour une fois vieux d’une heure. Un autre compteur limite à 10 par jour les codes
            demandés pour une même adresse e-mail : il garde une empreinte de l’adresse, jamais
            l’adresse, pendant 24 heures. Base légale : notre intérêt légitime à protéger le service
            et vos comptes (RGPD, art. 6(1)(f)).
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
              [
                "Compte sans réponse sur l’âge",
                "24 heures, effacé au passage quotidien suivant (2 jours au plus)",
              ],
              [
                "Sessions, codes de connexion",
                "Jusqu’à leur expiration (codes : 10 minutes), puis effacés au passage quotidien suivant",
              ],
              ["Textes en attente ou refusés", "Supprimés avec le compte"],
              [
                "Textes publiés",
                "Tant qu’ils sont publiés ; à la suppression du compte, vous choisissez : garder avec votre nom, garder anonyme (par défaut) ou retirer ; si le compte est supprimé pour inactivité ou sur une demande envoyée par e-mail (parent, droits), les textes publiés restent anonymes",
              ],
              ["Décisions de modération, signalements", "1 an après la décision"],
              [
                "Données synchronisées",
                "Jusqu’à ce que vous les supprimiez ou que le compte soit supprimé",
              ],
              ["Adresse IP, versions HTTP et TLS et heure de chaque envoi de texte", "1 an"],
              [
                "Adresse IP, versions HTTP et TLS et heure de chaque envoi à la synchronisation et de chaque suppression de ces données",
                "1 an",
              ],
              [
                "E-mail et pseudonyme d’un compte supprimé qui a encore des textes, des données synchronisées ou une trace",
                "E-mail 5 ans, pseudonyme 1 an",
              ],
              ["Journaux de sécurité", "6 mois"],
              ["Empreinte de l’adresse e-mail des codes demandés", "24 heures"],
              [
                "Trace d’une suppression de compte (identifiant, choix pour les textes publiés, adresse IP, heure), pour la refaire après une restauration de sauvegarde",
                "8 jours",
              ],
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
                "Lettermint B.V. envoie les e-mails, pour notre compte, depuis l’Union européenne (Pays-Bas). Elle garde le contenu, l’adresse et les métadonnées de chaque e-mail 28 jours, et les événements de remise au plus 90 jours, sans suivi des ouvertures ni des clics.",
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
              pseudonyme, télécharger vos données (JSON, avec vos données synchronisées), désactiver
              la synchronisation, supprimer les données du serveur et supprimer votre compte. Pour
              le reste, dont les traces gardées par la loi, qui ne sont pas dans ce fichier, écrivez
              à <Contact /> : nous répondons dans un mois, ou nous vous disons dans ce mois pourquoi
              il nous faut jusqu’à deux mois de plus.
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
            <Contact />, avec l’adresse e-mail du compte. Nous prévenons votre enfant par e-mail :
            le compte est supprimé 14 jours plus tard, sauf s’il nous dit avoir 15 ans ou plus, âge
            à partir duquel la loi le laisse décider seul.
          </Paragraph>
        ),
      },
      {
        id: "changes",
        heading: "Changements",
        body: (
          <Paragraph>
            La date en haut de la page est celle du dernier changement, et l’historique de la page
            est public : <External href={HISTORY}>chaque version avec sa date</External>. Si un
            changement ne vous convient pas, vous pouvez supprimer votre compte à tout moment.
          </Paragraph>
        ),
      },
    ],
  },
  en: {
    title: "Privacy",
    updated: "2026-11-04",
    sections: [
      {
        id: "summary",
        heading: "In short",
        body: (
          <List
            items={[
              "Without an account, everything you learn stays on your device. We do not receive it.",
              "An account is for sending texts to the shared library and, if you turn it on, for syncing your devices. It keeps your email address and a pseudonym, never a password.",
              "Sync is optional. If you turn it on, your reviews, cards, decks, notes and « I know it » words go to the server, with no end-to-end encryption.",
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
              Wikidata, sending to the library), when you export a backup file or, for some of them,
              when you turn on sync.
            </Paragraph>
            <Paragraph>
              This storage is strictly necessary for the service you ask for, so it needs no consent
              (French Data Protection Act, art. 82). When you are signed in, a session cookie only
              keeps you signed in. During a sign-in with Google or GitHub, a cookie of ten minutes
              at most protects the exchange. There is no other cookie.
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
              An account is for sending texts to the library and syncing your devices. We keep your
              email address, your pseudonym (empty until you choose one), your Google or GitHub
              account id if you sign in that way, your sessions (IP address, browser), the date of
              your answer about your age and, if you turn it on, two-step verification (encrypted).
              No password, no name or picture from Google or GitHub.
            </Paragraph>
            <Paragraph>
              Legal basis: the contract, that is the terms of use (GDPR art. 6(1)(b)). The email
              address is needed to have an account: without it, you use the app without one.
            </Paragraph>
            <List
              items={[
                "Code by email: the code is sent by Lettermint, in the Netherlands, with no tracking pixel.",
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
        id: "sync",
        heading: "Sync",
        body: (
          <>
            <Paragraph>
              It lets you find your cards and your progress on your other devices. It is off until
              you turn it on in Profile › Account, after an explanation. Once on, it runs by itself:
              when the app opens, when you come back to it, when you leave it with changes to send,
              at the end of a session and when the network comes back, and when you press « Sync now
              ». It never sends you a notification. Legal basis: the contract (GDPR art. 6(1)(b)).
            </Paragraph>
            <List
              items={[
                "What goes to the server: your reviews (the word, your answer, the date, the time, your time zone, your daily goal, whether the word is done for that day), your cards, your decks and their words, your notes, and the words you marked « I know it ».",
                "What stays on this device: your journal, your challenges, your texts, your settings, audio, your voice and your AI key.",
              ]}
            />
            <Paragraph>
              This data is not encrypted end to end, so OpenLinguo’s administrator could read it,
              including the times of your reviews. They only do so for an incident or an official
              request. In the app, only your devices receive it: no other learner sees it.
            </Paragraph>
            <Paragraph>
              The data on this device and the data in your account are merged. If a device was used
              by another account, what came from it joins yours too: the screen warns you first.
            </Paragraph>
            <Paragraph>
              It stays on the server until you delete it or the account is deleted. « Turn off and
              delete from the server », from just one device, deletes it for all your devices; it
              stays on your devices. On a device where sync is off, « Delete the data from the
              server » also deletes it for all your devices, but not all of it may be on that
              device. To offer this, Profile › Account asks the server whether any data remains:
              asking leaves no record and nothing is kept on the device. Signing out stops sync on
              this device but deletes nothing from the server. Careful: changing or deleting a note
              or a deck on a device does not erase it from the server. The older upload stays there,
              and in your data file, until that data is deleted. What is deleted leaves the database
              backups after {String(backupDays)} days.
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
              A host must keep what identifies whoever created a content (LCEN, art. 6, V;{" "}
              <External href={DECREE}>décret no. 2021-1362</External>), only with what it already
              collects:
            </Paragraph>
            <List
              items={[
                "for each submission, edit or withdrawal of a text: the IP address, the HTTP and TLS versions of the connection and the time, for one year;",
                "for each sync upload and each deletion of your synced data: the IP address, the HTTP and TLS versions of the connection and the time, for one year. Receiving your data on a device leaves no record;",
                "if you delete an account that still has texts, synced data or one of these records: your email address for five years, and your pseudonym for one year.",
              ]}
            />
            <Paragraph>
              These data are set apart, read by no one in the app, and given only to an authority
              that asks in writing under the law, or to you if you ask for them. Legal basis: legal
              obligation (GDPR art. 6(1)(c)). They remain after the account is deleted, as the
              deletion screen says.
            </Paragraph>
            <Paragraph>
              The decree does not say clearly whether it also covers what stays private, like sync.
              Not applying it could be punished by law: to be careful, we apply it. Your synced data
              itself is deleted; only these records stay.
            </Paragraph>
          </>
        ),
      },
      {
        id: "security",
        heading: "Security logs",
        body: (
          <Paragraph>
            Every sign-in, failure, code sent, authenticator code and admin action is logged with
            the IP address, the browser and the time, to spot abuse and intrusions, for six months,
            even if the account is deleted meanwhile (the line is then no longer tied to an
            account). Counters also limit the number of requests, per IP address or, for sync, per
            account: they are erased every day once an hour old. Another counter limits the codes
            asked for one email address to 10 a day: it keeps a fingerprint of the address, never
            the address, for 24 hours. Legal basis: our legitimate interest in protecting the
            service and your account (GDPR art. 6(1)(f)).
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
              [
                "Account with no answer about age",
                "24 hours, erased by the next daily run (2 days at most)",
              ],
              [
                "Sessions, sign-in codes",
                "Until they expire (codes: 10 minutes), then erased by the next daily run",
              ],
              ["Pending or rejected texts", "Deleted with the account"],
              [
                "Published texts",
                "While published; when you delete the account, you choose: keep with your name, keep as anonymous (default) or remove; if the account is deleted for inactivity or on a request sent by email (parent, rights), published texts stay anonymous",
              ],
              ["Moderation decisions, reports", "1 year after the decision"],
              ["Synced data", "Until you delete it or the account is deleted"],
              ["IP address, HTTP and TLS versions and time of each text submission", "1 year"],
              [
                "IP address, HTTP and TLS versions and time of each sync upload and each deletion of that data",
                "1 year",
              ],
              [
                "Email and pseudonym of a deleted account that still has texts, synced data or a record",
                "Email 5 years, pseudonym 1 year",
              ],
              ["Security logs", "6 months"],
              ["Fingerprint of the email address of codes asked", "24 hours"],
              [
                "Record of an account deletion (identifier, choice for published texts, IP address, time), to delete again after a backup restore",
                "8 days",
              ],
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
                "Lettermint B.V. sends the emails, on our behalf, from the European Union (the Netherlands). It keeps each email’s content, address and metadata for 28 days, and delivery events for at most 90 days, with no open or click tracking.",
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
              (JSON, with your synced data), turn sync off, delete the data from the server and
              delete your account. For anything else, including the records the law makes us keep,
              which are not in that file, write to <Contact />: we answer within one month, or tell
              you within that month why we need up to two more.
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
            , with the account’s email address. We tell your child by email: the account is deleted
            14 days later, unless they tell us they are 15 or over, the age from which the law lets
            them decide alone.
          </Paragraph>
        ),
      },
      {
        id: "changes",
        heading: "Changes",
        body: (
          <Paragraph>
            The date at the top of the page is that of the last change, and the history of the page
            is public: <External href={HISTORY}>every version with its date</External>. If a change
            does not suit you, you can delete your account at any time.
          </Paragraph>
        ),
      },
    ],
  },
};
