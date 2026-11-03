import type { AuthMessages } from "./en.ts";

export const authFr: AuthMessages = {
  retry: "Réessayer",
  profile: "Profil",
  account: "Compte",
  signIn: "Se connecter",
  back: "Retour au compte",
  intro:
    "Un compte sert à envoyer des textes à la bibliothèque partagée. Tout le reste marche sans compte.",
  email: "Adresse e-mail",
  emailInvalid: "Saisissez une adresse e-mail, par exemple nom@exemple.fr.",
  getCode: "Recevoir un code",
  or: "ou",
  google: "Continuer avec Google",
  github: "Continuer avec GitHub",
  redirecting: "Ouverture de la page du fournisseur…",
  mailNote: "L’e-mail part de Lettermint, aux Pays-Bas, sans pistage.",
  codeIntro: "Nous avons envoyé un code à {{email}}. Il est valable {{minutes}}\u00a0minutes.",
  code: "Code reçu par e-mail",
  codeInvalid: "Saisissez les {{length}}\u00a0chiffres du code.",
  codeWrong_one: "Code incorrect. Il reste {{count}}\u00a0essai.",
  codeWrong_other: "Code incorrect. Il reste {{count}}\u00a0essais.",
  confirm: "Se connecter",
  checking: "Vérification…",
  sending: "Envoi du code…",
  resend: "Renvoyer le code",
  resent: "Un nouveau code a été envoyé à {{email}}.",
  otherEmail: "Utiliser une autre adresse",
  codeExpired: "Ce code a expiré.",
  codeSpent: "Trop d’essais incorrects avec ce code.",
  newCode: "Recevoir un nouveau code",
  closedTitle: "Les inscriptions sont fermées pour l’instant",
  closedBody: "Aucun compte n’a été créé. L’application et la bibliothèque marchent sans compte.",
  loading: "Vérification de votre compte…",
  signedOut: "Vous n’êtes pas connecté.",
  signedOutNow: "Vous êtes déconnecté.",
  method: "Connecté en tant que {{email}}. Vous pouvez vous connecter avec {{methods}}.",
  methods: { email: "un code par e-mail", google: "Google", github: "GitHub" },
  signInSection: "Connexion",
  signOut: "Se déconnecter",
  failure: {
    offline:
      "Pas de connexion. Se connecter demande Internet\u00a0; le reste de l’application marche hors ligne.",
    mail: "Le code n’a pas pu être envoyé. Réessayez dans quelques minutes.",
    tooMany_one: "Trop de demandes. Réessayez dans {{count}}\u00a0minute.",
    tooMany_other: "Trop de demandes. Réessayez dans {{count}}\u00a0minutes.",
    tooManyLater: "Trop de demandes. Réessayez plus tard.",
    codeLimit:
      "Trop de codes demandés pour cette adresse aujourd’hui. Réessayez demain, ou connectez-vous avec Google ou GitHub.",
    provider:
      "La connexion avec le fournisseur a échoué ({{code}}). Réessayez ou utilisez un code par e-mail.",
    unexpected: "Le serveur n’a pas répondu comme prévu (erreur {{status}}). Réessayez plus tard.",
  },
  age: {
    title: "Quel âge avez-vous\u00a0?",
    why: "Nous le demandons une fois, car un compte ne s’ouvre qu’à partir de 15\u00a0ans.",
    over: "J’ai 15\u00a0ans ou plus",
    overLine: "Votre compte est prêt.",
    under: "J’ai moins de 15\u00a0ans",
    underLine:
      "Votre compte est supprimé tout de suite. L’application reste utilisable sans compte.",
    deletedTitle: "Compte supprimé",
    deletedBody:
      "Rien n’a été gardé. L’application et la bibliothèque restent utilisables sans compte.",
  },
  data: {
    title: "Mes données",
    intro:
      "Tout ce que le serveur garde sur votre compte, dans un fichier JSON : le compte, comment il se connecte, ses sessions, les textes envoyés, les décisions sur ces textes, les événements de sécurité et, si vous avez utilisé la synchronisation, vos données synchronisées. Vos données d’apprentissage restent sur cet appareil : Profil › Données les sauvegarde.",
    download: "Télécharger mes données (.json)",
    downloading: "Préparation du fichier…",
    downloaded: "Fichier enregistré : {{name}}",
    syncedUnreadable:
      "Le fichier n’a pas été créé : une donnée synchronisée sur le serveur est illisible. Écrivez-nous : openlinguo@gmail.com.",
    syncedUnavailable:
      "Le fichier n’a pas été créé : ce navigateur ne peut pas lire vos données synchronisées. Essayez un autre navigateur.",
  },
  sync: {
    title: "Synchronisation",
    intro:
      "Retrouvez vos cartes et votre progression sur vos autres appareils. C’est facultatif : sans elle, tout continue de marcher sur cet appareil.",
    sentTitle: "Ce qui part sur le serveur",
    sent: "Vos révisions avec leur date et leur heure, vos cartes, vos paquets et leurs mots, vos notes, vos mots marqués « Je connais ».",
    stayedTitle: "Ce qui reste sur cet appareil",
    stayed:
      "Votre journal, vos défis, vos textes, vos réglages, l’audio, votre voix et votre clé IA.",
    knowTitle: "Ce qu’il faut savoir",
    know: {
      merge: "Les données de cet appareil et celles de votre compte seront fusionnées.",
      readable:
        "Elles ne sont pas chiffrées de bout en bout : l’administrateur d’OpenLinguo pourrait les lire. Il ne le fait que pour un incident ou une demande officielle.",
      off: "Si vous désactivez la synchronisation, elles sont supprimées du serveur.",
      law: "La loi française nous fait garder des traces : l’adresse IP de chaque envoi pendant 1 an et, après la suppression du compte, votre e-mail pendant 5 ans et votre pseudonyme pendant 1 an.",
    },
    activate: "Activer la synchronisation",
    activating: "Activation de la synchronisation…",
    never: "Activée. Aucune synchronisation terminée pour l’instant.",
    lastToday: "Activée. Dernière synchronisation aujourd’hui à {{time}}.",
    lastYesterday: "Activée. Dernière synchronisation hier à {{time}}.",
    lastOn: "Activée. Dernière synchronisation le {{date}} à {{time}}.",
    running: "Synchronisation en cours…",
    usage: "Espace utilisé : {{used}} sur {{limit}}",
    megabytes: "{{value, number(maximumFractionDigits: 1)}} Mo",
    usageLabel: "{{ratio, number(style: percent)}} de l’espace utilisé",
    details: "Ce qui est synchronisé",
    syncNow: "Synchroniser maintenant",
    turnOff: "Désactiver et supprimer du serveur",
    schedule:
      "La synchronisation se fait à l’ouverture de l’app, en fin de séance et au retour du réseau. Elle ne vous envoie jamais de notification.",
    offTitle: "Désactiver la synchronisation ?",
    offBody:
      "Vos données seront supprimées du serveur, pour tous vos appareils. Elles restent sur cet appareil. Vos autres appareils arrêteront de se synchroniser et vous le diront.",
    offLaw: "La trace de chaque envoi reste gardée 1 an, comme la loi française nous le demande.",
    offCancel: "Annuler",
    offConfirm: "Désactiver et supprimer",
    offWorking: "Suppression sur le serveur…",
    offFailed:
      "La synchronisation n’a pas pu être désactivée et reste activée. Réessayez plus tard.",
    otherAccount:
      "Cet appareil était synchronisé avec un autre compte : la synchronisation est coupée. Si vous l’activez ici, tout ce qui se trouve sur cet appareil, y compris ce qui vient de l’autre compte, rejoindra ce compte.",
    activateHere: "Activer pour ce compte",
    failure: {
      offline: "Pas de connexion. Vos changements partiront à la prochaine synchronisation.",
      quota:
        "Votre espace de synchronisation est plein ({{limit}}). Rien n’est perdu sur cet appareil, mais vos nouveaux changements ne partent plus.",
      storeFull:
        "Le serveur est plein pour le moment. Rien n’est perdu sur cet appareil. Réessayez plus tard.",
      tooMany: "Trop d’envois en une heure. La synchronisation reprendra d’elle-même.",
      unexpected:
        "Le serveur n’a pas répondu comme prévu. Vos changements attendent sur cet appareil. Réessayez plus tard.",
      unreadable:
        "Une donnée reçue du serveur est illisible. La synchronisation est arrêtée et rien n’a été modifié ici. Écrivez-nous : openlinguo@gmail.com.",
      newer:
        "Ces données viennent d’une version plus récente d’OpenLinguo. Mettez l’application à jour pour continuer.",
      turnedOffElsewhere:
        "La synchronisation a été désactivée depuis un autre appareil et les données du serveur ont été supprimées. Tout est encore sur cet appareil. Réactivez-la pour tout renvoyer.",
      tooLarge:
        "Un élément est trop volumineux pour être envoyé. Rien n’est perdu, mais la synchronisation est arrêtée. Écrivez-nous : openlinguo@gmail.com.",
      invalidRow:
        "Un élément de cet appareil n’a pas pu être envoyé. Rien n’est perdu, mais la synchronisation est arrêtée. Écrivez-nous : openlinguo@gmail.com.",
      unavailable:
        "Ce navigateur ne permet pas la synchronisation. Vous pouvez continuer à apprendre sur cet appareil.",
      storage:
        "Cet appareil n’a pas pu lire ou écrire vos données. Réessayez, et écrivez-nous si cela continue : openlinguo@gmail.com.",
    },
  },
  deletion: {
    title: "Supprimer mon compte",
    intro:
      "Supprime votre compte sur le serveur. Vos données d’apprentissage sur cet appareil restent.",
    open: "Supprimer mon compte",
    dialogTitle: "Supprimer votre compte ?",
    dialogBody:
      "Votre compte, ses sessions et ses moyens de connexion sont supprimés tout de suite. C’est définitif.",
    published: "Vos textes publiés",
    choices: {
      "keep-anonymous": "Les garder, sans nom",
      "keep-named": "Les garder avec mon pseudonyme",
      remove: "Les retirer de la bibliothèque",
    },
    pending: "Les textes en attente de relecture ou refusés sont supprimés.",
    copies:
      "Les copies déjà importées par d’autres apprenants restent sur leurs appareils : la licence CC BY-SA ne peut pas être retirée.",
    keptTitle: "Ce que la loi nous oblige à garder",
    kept: "Si vous avez envoyé des textes à la bibliothèque, la loi française (décret 2021-1362) nous oblige à garder votre e-mail 5 ans et vos pseudonymes 1 an, sous clé : seules les autorités que la loi y autorise peuvent les demander. L’adresse et l’heure de chaque changement sur vos textes sont gardées 1 an.",
    keptSync:
      "Si vous avez utilisé la synchronisation, vos données synchronisées sont supprimées, mais la loi française nous fait garder votre e-mail pendant 5 ans, votre pseudonyme pendant 1 an, et la trace de chaque envoi pendant 1 an. Ils ne servent qu’à répondre à une autorité.",
    cancel: "Annuler",
    confirm: "Supprimer définitivement",
    deleting: "Suppression de votre compte…",
    doneTitle: "Compte supprimé",
    doneBody:
      "Votre compte est supprimé. L’application et la bibliothèque restent utilisables sans compte.",
  },
  pseudonym: {
    title: "Pseudonyme",
    none: "Aucun pour l’instant. Vous le choisissez la première fois que vous signez un texte.",
    field: "Pseudonyme",
    help: "{{max}}\u00a0caractères au plus. Il n’est jamais repris de Google ou de GitHub.",
    invalid: "Saisissez {{max}}\u00a0caractères au plus, sur une ligne.",
    kept: "Les textes déjà envoyés gardent le nom avec lequel ils ont été envoyés.",
    identity:
      "N’utilisez ni votre nom complet, ni votre école, ni votre ville : un pseudonyme ne doit pas dire qui vous êtes.",
    save: "Enregistrer",
    saved: "Pseudonyme enregistré.",
  },
  twoFactor: {
    title: "Vérification en deux étapes",
    on: "Activée. Chaque nouvelle connexion demande un code de votre application d’authentification.",
    off: "Désactivée. Vous pouvez demander un code d’une application d’authentification à chaque nouvelle connexion.",
    required: "Obligatoire pour modérer la bibliothèque.",
    enable: "Activer",
    step1: "Ouvrez votre application d’authentification et scannez ce QR code.",
    qr: "QR code de la clé d’authentification",
    step2: "Ou saisissez cette clé\u00a0:",
    copyKey: "Copier la clé",
    keyCopied: "Clé copiée.",
    step3: "Saisissez le code à {{length}}\u00a0chiffres affiché par l’application.",
    code: "Code de l’application",
    verify: "Vérifier",
    wrong: "Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.",
    backupTitle: "Codes de secours",
    backupIntro:
      "Chacun sert une seule fois si vous perdez votre téléphone. Ils ne seront plus affichés.",
    backupFile: "Codes de secours OpenLinguo. Chacun sert une seule fois.",
    download: "Télécharger (.txt)",
    copyCodes: "Copier les codes",
    codesCopied: "Codes copiés.",
    copyFailed: "La copie a échoué. Sélectionnez les codes et copiez-les à la main.",
    stored: "J’ai rangé ces codes en lieu sûr",
    storeFirst: "Cochez la case une fois les codes rangés.",
    done: "Terminer",
    promptTitle: "Vérification en deux étapes",
    promptIntro: "Saisissez le code de votre application d’authentification.",
    useBackup: "Utiliser un code de secours",
    useApp: "Utiliser l’application d’authentification",
    backupCode: "Code de secours",
    backupWrong: "Ce code de secours est incorrect ou déjà utilisé.",
    locked: "Trop de codes incorrects. Réessayez dans {{minutes}}\u00a0minutes.",
  },
};
