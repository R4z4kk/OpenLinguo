/** The `legal` namespace (#279): the frame of `/legal`, `/privacy` and `/terms` and the links to them. */
export const legalEn = {
  back: "About",
  updated: "Last updated on {{date}}",
  otherVersion: "English version",
  prevails: "The French version prevails.",
  contents: "Contents",
  links: "Legal information",
  notice: "Legal notice",
  privacy: "Privacy",
  terms: "Terms of use",
  signInLinks: "By signing in, you accept the terms of use. Read how we handle your data.",
} as const;

type Shape<T> = { readonly [Key in keyof T]: T[Key] extends string ? string : Shape<T[Key]> };

export type LegalMessages = Shape<typeof legalEn>;
