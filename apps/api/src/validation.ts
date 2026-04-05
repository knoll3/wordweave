import { z } from "zod";

export const combineRequestSchema = z.object({
  inputs: z.array(z.string()).nonempty(),
  categoryConstraint: z.string().min(1).max(64).nullable().optional(),
  actionConstraint: z.string().min(1).max(64).nullable().optional(),
  creative: z.boolean().optional().default(false),
  ponderificate: z.boolean().optional().default(false),
  model: z
    .enum(["gpt-5.4", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"])
    .optional(),
});

export const selectRequestSchema = z.object({
  candidateId: z.number().int().positive(),
});

export const recipeFeedbackRequestSchema = z.object({
  clientSessionId: z.string().min(1).max(128),
  sentiment: z.enum(["up", "down"]),
  expectedResultText: z.string().min(1).max(128).nullable().optional().or(z.literal("")).optional(),
  commentText: z.string().min(1).max(500).nullable().optional().or(z.literal("")).optional(),
});

export const recipeFeedbackDeleteRequestSchema = z.object({
  clientSessionId: z.string().min(1).max(128),
});

export const llmResultSchema = z.object({
  name: z.string().min(1).max(64),
  icon: z.string().min(1).max(8),
});

export const ponderificateOptionSchema = llmResultSchema.extend({
  score: z.number().int().min(0).max(100),
});

export const ponderificateLlmResultSchema = z.object({
  options: z.array(ponderificateOptionSchema).min(2).max(8),
  bestOption: ponderificateOptionSchema,
});

export const splitLlmResultSchema = z.object({
  results: z.array(llmResultSchema).min(1).max(8),
});

export const craftLlmResultSchema = z.union([
  z.object({
    failed: z.literal(true),
    reason: z.string().min(1).max(160),
  }),
  ponderificateLlmResultSchema,
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

const boardPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const boardItemInputSchema = z.object({
  itemId: z.number().int(),
  position: boardPositionSchema,
  isNewDiscovery: z.boolean().optional(),
  arrivalHighlightMode: z.enum(["library", "combine"]).nullable().optional(),
  categoryConstraintName: z.string().min(1).max(64).nullable().optional(),
  categoryConstraintNormalizedName: z.string().min(1).max(64).nullable().optional(),
  actionConstraintName: z.string().min(1).max(64).nullable().optional(),
  actionConstraintNormalizedName: z.string().min(1).max(64).nullable().optional(),
});

export const createBoardItemRequestSchema = boardItemInputSchema;

export const updateBoardItemRequestSchema = z.object({
  itemId: z.number().int().optional(),
  isNewDiscovery: z.boolean().nullable().optional(),
  arrivalHighlightMode: z.enum(["library", "combine"]).nullable().optional(),
  categoryConstraintName: z.string().min(1).max(64).nullable().optional().or(z.literal("")).optional(),
  categoryConstraintNormalizedName: z.string().min(1).max(64).nullable().optional().or(z.literal("")).optional(),
  actionConstraintName: z.string().min(1).max(64).nullable().optional().or(z.literal("")).optional(),
  actionConstraintNormalizedName: z.string().min(1).max(64).nullable().optional().or(z.literal("")).optional(),
});

export const moveBoardItemRequestSchema = z.object({
  position: boardPositionSchema,
});

export const moveBoardItemsRequestSchema = z.object({
  items: z.array(
    z.object({
      nodeId: z.string().min(1).max(128),
      position: boardPositionSchema,
    })
  ).min(1).max(100),
});

export const attachBoardModifierRequestSchema = z.object({
  sourceNodeId: z.string().min(1).max(128),
  targetNodeId: z.string().min(1).max(128),
});

export const combineBoardRequestSchema = z.object({
  consumedNodeIds: z.array(z.string().min(1).max(128)).min(1),
  producedItems: z.array(boardItemInputSchema).min(1).max(8),
});

export const deleteBoardItemsRequestSchema = z.object({
  nodeIds: z.array(z.string().min(1).max(128)).min(1).max(100),
});

export type LlmResult = z.infer<typeof llmResultSchema>;
export type PonderificateLlmResult = z.infer<typeof ponderificateLlmResultSchema>;
export type SplitLlmResult = z.infer<typeof splitLlmResultSchema>;
export type CraftLlmResult = z.infer<typeof craftLlmResultSchema>;
export type RecipeBatch = z.infer<typeof recipeBatchSchema>;
export type QuestTargets = z.infer<typeof questTargetsSchema>;
export type QuestTargetVariants = z.infer<typeof questTargetVariantsSchema>;
