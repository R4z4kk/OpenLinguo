import type { AiProvider } from "./ai-client.ts";

/** A fact read on `source` on `checkedOn`; CI fails from `reviewBy` until it is read again. */
type DatedFact = {
  readonly value: number | string;
  readonly source: string;
  readonly checkedOn: string;
  readonly reviewBy: string;
};

/** The code of practice facts behind the marking of generated stories (docs/compliance/ai.md §3.1). */
export const MARKING_FACTS = {
  /** Sub-measure 1.1.2 and glossary: text shorter than this is "very short" and needs no watermark. */
  veryShortTextTokens: {
    value: 200,
    source: "https://ec.europa.eu/newsroom/dae/redirection/document/129555",
    checkedOn: "2026-10-20",
    reviewBy: "2027-04-20",
  },
  /** The final code, by its publication date: the PDF carries no version number. */
  codeOfPractice: {
    value: "2026-06-10",
    source: "https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content",
    checkedOn: "2026-10-20",
    reviewBy: "2027-04-20",
  },
} as const satisfies Readonly<Record<string, DatedFact>>;

/** Whether each cloud provider documents a watermark on generated text (guidelines para 74). */
export const UPSTREAM_WATERMARK = {
  groq: {
    value: "not documented",
    source: "https://console.groq.com/docs/legal/services-agreement",
    checkedOn: "2026-10-20",
    reviewBy: "2027-04-20",
  },
  openrouter: {
    value: "not documented",
    source: "https://openrouter.ai/terms",
    checkedOn: "2026-10-20",
    reviewBy: "2027-04-20",
  },
  /** Reviewed the day after the date Mistral announced marking for. */
  mistral: {
    value: "announced by 2026-12-02 for Vibe Code, not documented for the API",
    source: "https://legal.mistral.ai/ai-governance/ai-systems/vibe-code",
    checkedOn: "2026-10-20",
    reviewBy: "2026-12-03",
  },
} as const satisfies Readonly<Record<Exclude<AiProvider, "local">, DatedFact>>;
