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
  },
  read: { title: "Lire", intro: "Textes gradués et lecteur." },
  profile: { title: "Profil", display: "Affichage" },
  theme: {
    legend: "Thème",
    system: "Système",
    light: "Clair",
    dark: "Sombre",
    notSaved:
      "Le thème s’applique maintenant mais ne peut pas être enregistré dans ce navigateur : {{reason}}",
  },
  language: {
    legend: "Langue",
    notSaved:
      "La langue s’applique maintenant mais ne peut pas être enregistrée dans ce navigateur : {{reason}}",
  },
  update: {
    available: "Une nouvelle version d’OpenLinguo est disponible.",
    reload: "Recharger",
    later: "Plus tard",
    offlineUnavailable: "Le mode hors ligne est indisponible : {{reason}}",
  },
  moduleError: { title: "Cette section n’a pas pu se charger", retry: "Réessayer" },
  notFound: { title: "Page introuvable", back: "Retour à Aujourd’hui" },
};
