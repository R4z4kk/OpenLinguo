import type { Messages } from "./en.ts";

export const fr: Messages = {
  shell: {
    skipToContent: "Aller au contenu",
    navigation: "Navigation principale",
  },
  nav: {
    today: "Aujourd’hui",
    learn: "Apprendre",
    read: "Lire",
    profile: "Profil",
  },
  today: { title: "Aujourd’hui", intro: "La séance du jour commence ici." },
  learn: {
    title: "Apprendre",
    intro: "Paquets, dictionnaire, studios de prononciation et d’écriture.",
    dictionary: "Dictionnaire",
    dictionaryIntro: "Chercher un mot par ses caractères, son pinyin, en français ou en anglais.",
  },
  dictionary: {
    title: "Dictionnaire",
    label: "Rechercher dans le dictionnaire",
    hint: "Caractères chinois, pinyin avec ou sans tons, français ou anglais.",
    results_one: "{{count}} résultat",
    results_other: "{{count}} résultats",
    noResults: "Aucun résultat.",
    shown: "{{shown}} affichés sur {{total}}.",
    more: "Afficher plus de résultats",
    level: "HSK {{level}}",
    glossesIn: { en: "anglais", fr: "français" },
    sources: "Sources",
    credits: {
      "cc-cedict": "Traductions anglaises",
      cfdict: "Traductions françaises",
      "wiktionary-fr": "Traductions françaises",
      wordfreq: "Fréquences des mots",
    },
  },
  read: { title: "Lire", intro: "Textes gradués et lecteur." },
  profile: { title: "Profil", display: "Affichage", learning: "Apprentissage", data: "Données" },
  referential: {
    legend: "Niveaux HSK",
    "hsk-2025": "Examen HSK 2025",
    "gf0025-2021": "Standard GF0025-2021",
    notSaved:
      "Les niveaux s’appliquent maintenant mais le choix ne peut pas être enregistré dans ce navigateur\u00a0: {{reason}}",
  },
  dataImport: {
    title: "Préparation du dictionnaire hors ligne",
    progress: "{{percent}} %",
    failedTitle: "Le dictionnaire n’a pas pu être préparé",
    network: "{{file}} n’a pas pu être téléchargé\u00a0: {{message}}",
    integrity: "{{file}} est corrompu\u00a0: son empreinte ne correspond pas.",
    format: "{{file}} est invalide\u00a0: {{message}}",
    storage: "Le navigateur a refusé d’enregistrer les données ({{file}})\u00a0: {{message}}",
    missing: "Données du dictionnaire manquantes\u00a0: {{dataset}}.",
    unreadable: "Le dictionnaire n’a pas pu être lu\u00a0: {{message}}",
    retry: "Réessayer",
  },
  persistence: {
    granted: "Stockage persistant\u00a0: le navigateur ne supprimera pas vos données hors ligne.",
    denied: "Le navigateur peut effacer vos données hors ligne si l’espace manque.",
    unsupported:
      "Ce navigateur ne permet pas un stockage persistant\u00a0; il peut effacer vos données hors ligne.",
  },
  theme: {
    legend: "Thème",
    system: "Système",
    light: "Clair",
    dark: "Sombre",
    notSaved:
      "Le thème s’applique maintenant mais ne peut pas être enregistré dans ce navigateur\u00a0: {{reason}}",
  },
  language: {
    legend: "Langue",
    notSaved:
      "La langue s’applique maintenant mais ne peut pas être enregistrée dans ce navigateur\u00a0: {{reason}}",
  },
  update: {
    available: "Une nouvelle version d’OpenLinguo est disponible.",
    reload: "Recharger",
    later: "Plus tard",
    offlineUnavailable: "Le mode hors ligne est indisponible\u00a0: {{reason}}",
  },
  moduleError: { title: "Cette section n’a pas pu se charger", retry: "Réessayer" },
  notFound: { title: "Page introuvable", back: "Retour à Aujourd’hui" },
};
