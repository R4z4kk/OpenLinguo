import type { Language } from "@/i18n/language";
import { Contact, External, List, Paragraph, REPOSITORY, type LegalDocument } from "./legal-page";

/** Only what the E2E tests (`apps/web/e2e/accessibility.e2e.ts`) and the app do: a claim here without one of them is wrong. */
export const ACCESSIBILITY: Readonly<Record<Language, LegalDocument>> = {
  fr: {
    title: "Accessibilité",
    updated: "2026-11-04",
    sections: [
      {
        id: "status",
        heading: "Conformité",
        body: (
          <Paragraph>
            La conformité au WCAG 2.2, niveau AA, n’est pas revendiquée. C’est l’objectif du projet,
            pas un engagement : OpenLinguo est fait et maintenu par une seule personne, et cette
            déclaration dit seulement ce qui est vérifié.
          </Paragraph>
        ),
      },
      {
        id: "checked",
        heading: "Ce qui est vérifié",
        body: (
          <>
            <Paragraph>
              À chaque modification, des tests automatiques contrôlent chaque écran :
            </Paragraph>
            <List
              items={[
                "avec les règles axe du WCAG 2.0 à 2.2, niveaux A et AA, en thème clair et en thème sombre ;",
                "le texte chinois est marqué comme tel, pour qu’un lecteur d’écran puisse le prononcer en chinois ;",
                "aucun écran ne défile latéralement à 320 px de large ;",
                "rien ne reste en mouvement quand le système demande de réduire les animations ;",
                "avec Chromium, la touche Tab ne reste jamais bloquée et chaque arrêt montre où se trouve le focus.",
              ]}
            />
          </>
        ),
      },
      {
        id: "unchecked",
        heading: "Ce qui n’est pas vérifié",
        body: (
          <>
            <Paragraph>
              Aucun test n’a été fait avec une technologie d’assistance : lecteurs d’écran, commande
              vocale, loupes. Les tests automatiques ne trouvent qu’une partie des problèmes.
            </Paragraph>
            <List
              items={[
                "Avec NVDA, des mots chinois du lecteur ont été mal prononcés ; la cause (la voix de synthèse ou l’application) n’est pas établie.",
                "Les tests regardent les écrans à l’ouverture : les fenêtres et les panneaux ouverts ensuite ne sont pas couverts.",
                "Le parcours au clavier n’est pas testé avec Safari.",
              ]}
            />
          </>
        ),
      },
      {
        id: "alternatives",
        heading: "Alternatives prévues",
        body: (
          <List
            items={[
              "Écrire un mot : « Écrire sur papier » remplace le tracé à l’écran, puis on note soi-même.",
              "Fiche de ton : « Impossible de parler maintenant ? Écoutez et choisissez le ton » remplace la prononciation à voix haute.",
              "Exercice de saisie : le minuteur est désactivé par défaut.",
            ]}
          />
        ),
      },
      {
        id: "contact",
        heading: "Signaler un problème",
        body: (
          <>
            <Paragraph>
              Écrivez à <Contact /> ou ouvrez une{" "}
              <External href={`${REPOSITORY}/issues`}>demande sur GitHub</External>. Indiquez
              l’écran, le navigateur, la technologie d’assistance s’il y en a une, et ce que vous
              attendiez. Le mainteneur répond quand il le peut.
            </Paragraph>
          </>
        ),
      },
    ],
  },
  en: {
    title: "Accessibility",
    updated: "2026-11-04",
    sections: [
      {
        id: "status",
        heading: "Conformance",
        body: (
          <Paragraph>
            Conformance with WCAG 2.2 level AA is not claimed. It is the goal of the project, not a
            commitment: OpenLinguo is made and maintained by one person, and this statement says
            only what is checked.
          </Paragraph>
        ),
      },
      {
        id: "checked",
        heading: "What is checked",
        body: (
          <>
            <Paragraph>On every change, automated tests check each screen:</Paragraph>
            <List
              items={[
                "with the axe rules for WCAG 2.0 to 2.2 levels A and AA, in light and dark themes;",
                "Chinese text is marked as Chinese, so that a screen reader can voice it as Chinese;",
                "no screen scrolls sideways at 320 px wide;",
                "nothing keeps moving when the system asks for reduced motion;",
                "in Chromium, the Tab key never gets stuck and each stop shows where the focus is.",
              ]}
            />
          </>
        ),
      },
      {
        id: "unchecked",
        heading: "What is not checked",
        body: (
          <>
            <Paragraph>
              No test was done with assistive technology: screen readers, voice control, magnifiers.
              Automated tests find only part of the problems.
            </Paragraph>
            <List
              items={[
                "With NVDA, Chinese words in the reader were read poorly; the cause (the synthesizer voice or the app) is not established.",
                "The tests look at screens as they open: dialogs and panels opened afterwards are not covered.",
                "Keyboard navigation is not tested in Safari.",
              ]}
            />
          </>
        ),
      },
      {
        id: "alternatives",
        heading: "Alternatives built in",
        body: (
          <List
            items={[
              "Writing a word: “Write on paper” replaces drawing on the screen, then you grade yourself.",
              "Tone card: “Can’t speak now? Listen and pick the tone” replaces speaking aloud.",
              "Typing exercise: the timer is off by default.",
            ]}
          />
        ),
      },
      {
        id: "contact",
        heading: "Report a problem",
        body: (
          <Paragraph>
            Write to <Contact /> or open an{" "}
            <External href={`${REPOSITORY}/issues`}>issue on GitHub</External>. Say which screen,
            which browser, which assistive technology if any, and what you expected. The maintainer
            answers when they can.
          </Paragraph>
        ),
      },
    ],
  },
};
