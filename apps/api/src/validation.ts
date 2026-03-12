import { z } from "zod";

export const combineRequestSchema = z.object({
  inputs: z.array(z.string()).nonempty(),
  creative: z.boolean().optional().default(false),
});

export const selectRequestSchema = z.object({
  candidateId: z.number().int().positive(),
});

export const llmResultSchema = z.object({
  name: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
});

export type LlmResult = z.infer<typeof llmResultSchema>;
