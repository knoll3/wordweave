import { z } from "zod";

export const combineRequestSchema = z.object({
  inputs: z.array(z.string()).nonempty(),
  categoryConstraint: z.string().min(1).max(64).nullable().optional(),
  actionConstraint: z.string().min(1).max(64).nullable().optional(),
  creative: z.boolean().optional().default(false),
  model: z
    .enum(["gpt-5.4", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"])
    .optional(),
});

export const selectRequestSchema = z.object({
  candidateId: z.number().int().positive(),
});

export const llmResultSchema = z.object({
  name: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
});

export const splitLlmResultSchema = z.object({
  results: z.array(llmResultSchema).min(1).max(8),
});

export const craftLlmResultSchema = z.union([
  z.object({
    failed: z.literal(true),
    reason: z.string().min(1).max(160),
  }),
  z.object({
    failed: z.literal(false).optional(),
    name: z.string().min(1).max(64),
    icon: z.string().min(1).max(8),
  }),
]);

export const recipeBatchStepSchema = z.object({
  left: z.string().min(1).max(64),
  right: z.string().min(1).max(64),
  result: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
});

export const recipeBatchSchema = z.object({
  recipes: z.array(recipeBatchStepSchema).max(25),
});

export const questTargetsSchema = z.object({
  targets: z.array(llmResultSchema).min(1).max(30),
});

export const questTargetVariantsSchema = z.object({
  targets: z.array(
    z.object({
      name: z.string().min(1).max(64),
      alternateSpellings: z.array(z.string().min(1).max(96)).max(40),
    })
  ),
});

export type LlmResult = z.infer<typeof llmResultSchema>;
export type SplitLlmResult = z.infer<typeof splitLlmResultSchema>;
export type CraftLlmResult = z.infer<typeof craftLlmResultSchema>;
export type RecipeBatch = z.infer<typeof recipeBatchSchema>;
export type QuestTargets = z.infer<typeof questTargetsSchema>;
export type QuestTargetVariants = z.infer<typeof questTargetVariantsSchema>;
