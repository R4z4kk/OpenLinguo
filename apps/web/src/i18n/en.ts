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
  learn: {
    title: "Learn",
    intro: "Decks, dictionary, pronunciation and writing studios.",
    dictionary: "Dictionary",
    dictionaryIntro: "Look up a word by its characters, pinyin, English or French.",
  },
  dictionary: {
    title: "Dictionary",
    label: "Search the dictionary",
    hint: "Chinese characters, pinyin with or without tones, English or French.",
    results_one: "{{count}} result",
    results_other: "{{count}} results",
    noResults: "No results.",
    shown: "Showing {{shown}} of {{total}}.",
    more: "Show more results",
    level: "HSK {{level}}",
    glossesIn: { en: "English", fr: "French" },
    sources: "Sources",
    credits: {
      "cc-cedict": "English glosses",
      cfdict: "French glosses",
      "wiktionary-fr": "French glosses",
      wordfreq: "Word frequencies",
    },
  },
  read: { title: "Read", intro: "Graded texts and the reader." },
  profile: { title: "Profile", display: "Display", learning: "Learning", data: "Data" },
  referential: {
    legend: "HSK levels",
    "hsk-2025": "HSK 2025 exam",
    "gf0025-2021": "GF0025-2021 standard",
    notSaved: "The levels apply now but the choice cannot be saved in this browser: {{reason}}",
  },
  dataImport: {
    title: "Preparing the offline dictionary",
    progress: "{{percent}} %",
    failedTitle: "The dictionary could not be prepared",
    network: "{{file}} could not be downloaded: {{message}}",
    integrity: "{{file}} is corrupted: its fingerprint does not match.",
    format: "{{file}} is invalid: {{message}}",
    storage: "The browser refused to store the data ({{file}}): {{message}}",
    missing: "Dictionary data is missing: {{dataset}}.",
    unreadable: "The dictionary could not be read: {{message}}",
    retry: "Try again",
  },
  persistence: {
    granted: "Storage is persistent: the browser will not clear your offline data.",
    denied: "The browser may clear your offline data when space runs low.",
    unsupported: "This browser cannot make storage persistent; it may clear your offline data.",
  },
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
