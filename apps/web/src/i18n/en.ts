/** Reference catalog: every other language must have exactly these keys (see `Messages`). */
export const en = {
  shell: {
    skipToContent: "Skip to content",
    navigation: "Main",
  },
  nav: {
    today: "Today",
    learn: "Learn",
    read: "Read",
    profile: "Profile",
  },
  today: { title: "Today", intro: "Your daily session starts here." },
  learn: { title: "Learn", intro: "Decks, dictionary, pronunciation and writing studios." },
  read: { title: "Read", intro: "Graded texts and the reader." },
  profile: { title: "Profile", display: "Display" },
  theme: {
    legend: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
    notSaved: "The theme applies now but cannot be saved in this browser: {{reason}}",
  },
  language: {
    legend: "Language",
    notSaved: "The language applies now but cannot be saved in this browser: {{reason}}",
  },
  update: {
    available: "A new version of OpenLinguo is available.",
    reload: "Reload",
    later: "Later",
    offlineUnavailable: "Offline mode is unavailable: {{reason}}",
  },
  moduleError: { title: "This section failed to load", retry: "Try again" },
  notFound: { title: "Page not found", back: "Back to Today" },
} as const;

type Shape<T> = { readonly [Key in keyof T]: T[Key] extends string ? string : Shape<T[Key]> };

/** Same keys as `en`, any text: a missing or extra key fails typecheck. */
export type Messages = Shape<typeof en>;
