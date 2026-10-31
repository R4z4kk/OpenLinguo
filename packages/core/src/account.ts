import { z } from "zod";

/** The age step after the first sign-in (ADR 0015): « moins de 15 ans » deletes the account. */
export const AgeDeclaration = z.object({ answer: z.enum(["15-or-over", "under-15"]) });
export type AgeDeclaration = z.output<typeof AgeDeclaration>;
