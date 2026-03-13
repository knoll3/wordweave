import { z } from "zod";

export const combineRequestSchema = z.object({
  inputs: z.array(z.string()).nonempty(),
  creative: z.boolean().optional().default(false),
  subtractive: z.boolean().optional().default(false),
  opposite: z.boolean().optional().default(false),
  randomize: z.boolean().optional().default(false),
  crafting: z.boolean().optional().default(false),
  model: z
    .enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"])
    .optional(),
});

export const generateQuestRequestSchema = z.object({
  discoveredItems: z.array(z.string()).optional().default([]),
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

export const questInputChoiceSchema = z.object({
  items: z.array(z.string().min(1).max(64)).min(3).max(8),
});

export const questChainStepSchema = z.object({
  right: z.string().min(1).max(64),
  result: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
});

export const questChainSchema = z.object({
  start: z.string().min(1).max(64),
  steps: z.array(questChainStepSchema).length(3),
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
export type QuestInputChoice = z.infer<typeof questInputChoiceSchema>;
export type QuestChain = z.infer<typeof questChainSchema>;
export type RecipeBatch = z.infer<typeof recipeBatchSchema>;
