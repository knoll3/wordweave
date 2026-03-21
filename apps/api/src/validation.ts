import { z } from "zod";

export const combineRequestSchema = z.object({
  inputs: z.array(z.string()).nonempty(),
  creative: z.boolean().optional().default(false),
  subtractive: z.boolean().optional().default(false),
  opposite: z.boolean().optional().default(false),
  popCulture: z.boolean().optional().default(false),
  randomize: z.boolean().optional().default(false),
  crafting: z.boolean().optional().default(false),
  wordCombine: z.boolean().optional().default(false),
  evolve: z.boolean().optional().default(false),
  model: z
    .enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"])
    .optional(),
});

export const generateQuestRequestSchema = z.object({
  discoveredItems: z.array(z.string()).optional().default([]),
});

export const generateTargetQuestRequestSchema = z.object({
  count: z.number().int().min(1).max(6).optional().default(4),
});

export const selectRequestSchema = z.object({
  candidateId: z.number().int().positive(),
});

export const llmResultSchema = z.object({
  name: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
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

export const targetQuestSelectionSchema = z.object({
  quests: z
    .array(
      z.object({
        target: z.string().min(1).max(64),
        difficulty: z.enum(["easy", "medium", "stretch"]),
        flavor: z.string().min(1).max(48),
        teaser: z.string().min(1).max(140),
      })
    )
    .min(1)
    .max(6),
});

export const recipeBatchStepSchema = z.object({
  left: z.string().min(1).max(64),
  right: z.string().min(1).max(64),
  result: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
});

export const recipeBatchSchema = z.object({
  recipes: z.array(recipeBatchStepSchema).max(25),
});

export type LlmResult = z.infer<typeof llmResultSchema>;
export type CraftLlmResult = z.infer<typeof craftLlmResultSchema>;
export type RecipeBatch = z.infer<typeof recipeBatchSchema>;
export type TargetQuestSelection = z.infer<typeof targetQuestSelectionSchema>;
