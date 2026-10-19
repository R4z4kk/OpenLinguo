import { z } from "zod";
import { AI_PROVIDERS } from "./ai-client.ts";

/**
 * Where a stored AI item came from: the reference implementation of docs/compliance/ai.md §4.
 * Unknown members are dropped, so nothing about the learner is ever kept.
 */
export const AiProvenance = z.object({
  origin: z.literal("ai"),
  provider: z.enum(AI_PROVIDERS),
  /** The model id sent in the request. */
  model: z.string().min(1),
  /** The PromptPack task id, such as `zh-correct-v1`. */
  promptVersion: z.string().min(1),
  /** When the answer was received, ISO 8601 in UTC. */
  createdAt: z.iso.datetime(),
});
export type AiProvenance = z.output<typeof AiProvenance>;
