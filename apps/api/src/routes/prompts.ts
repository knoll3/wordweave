import express from "express";
import { z } from "zod";
import {
  getAllActionPromptFamilies,
  getActionPromptFamilyByKey,
  type ActionPromptFamilyKey,
} from "../actionPromptFamilies";
import {
  DEFAULT_MODEL_NAME,
  generateRecipeBatch,
  generateResult,
  renderGenerateResultPrompt,
  renderRecipeBatchPrompt,
  type OpenAiModel,
} from "../openaiClient";
import { searchGoogleLikeWeb } from "../webSearch";

const router = express.Router();

const modelSchema = z.enum([
  "gpt-5.4",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
]);

const promptTestRequestSchema = z.object({
  promptKey: z.string().min(1),
  model: modelSchema.optional(),
  inputs: z.array(z.string().min(1)).optional(),
  actionConstraint: z.string().min(1).max(128).optional(),
  categoryConstraint: z.string().min(1).max(128).optional(),
  pairs: z
    .array(
      z.object({
        left: z.string().min(1),
        right: z.string().min(1),
      })
    )
    .optional(),
});

type PromptDefinition = {
  key: string;
  title: string;
  description: string;
  kind: "combine" | "recipe_batch";
  actionFamilyKey: ActionPromptFamilyKey | null;
  showsActionConstraint: boolean;
  requiresActionConstraint: boolean;
  showsCategoryConstraint: boolean;
  requiresCategoryConstraint: boolean;
  supportsCreative: boolean;
};

const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    key: "default",
    title: "Default Combine",
    description: "The standard combine prompt used for normal crafting.",
    kind: "combine",
    actionFamilyKey: null,
    showsActionConstraint: false,
    requiresActionConstraint: false,
    showsCategoryConstraint: false,
    requiresCategoryConstraint: false,
    supportsCreative: false,
  },
  {
    key: "creative",
    title: "Creative Combine",
    description: "The playful, sillier combine path used by Creative Spark.",
    kind: "combine",
    actionFamilyKey: null,
    showsActionConstraint: false,
    requiresActionConstraint: false,
    showsCategoryConstraint: false,
    requiresCategoryConstraint: false,
    supportsCreative: true,
  },
  {
    key: "category",
    title: "Category Modifier",
    description: "Constrain the result to remain inside a category anchor.",
    kind: "combine",
    actionFamilyKey: null,
    showsActionConstraint: false,
    requiresActionConstraint: false,
    showsCategoryConstraint: true,
    requiresCategoryConstraint: true,
    supportsCreative: false,
  },
  {
    key: "action",
    title: "Action Modifier",
    description: "The general action prompt for an arbitrary action anchor.",
    kind: "combine",
    actionFamilyKey: null,
    showsActionConstraint: true,
    requiresActionConstraint: true,
    showsCategoryConstraint: false,
    requiresCategoryConstraint: false,
    supportsCreative: false,
  },
  {
    key: "action_category",
    title: "Action + Category",
    description: "Apply a general action while preserving a category constraint.",
    kind: "combine",
    actionFamilyKey: null,
    showsActionConstraint: true,
    requiresActionConstraint: true,
    showsCategoryConstraint: true,
    requiresCategoryConstraint: true,
    supportsCreative: false,
  },
  ...getAllActionPromptFamilies().map((family) => ({
    key: `action_family:${family.key}`,
    title: `Action Family: ${family.title}`,
    description: `Specialized Action behavior triggered by ${family.title}.`,
    kind: "combine" as const,
    actionFamilyKey: family.key,
    showsActionConstraint: true,
    requiresActionConstraint: true,
    showsCategoryConstraint: true,
    requiresCategoryConstraint: false,
    supportsCreative: false,
  })),
  {
    key: "recipe_batch",
    title: "Recipe Batch",
    description: "Generate a batch of cached recipes from input pairs.",
    kind: "recipe_batch",
    actionFamilyKey: null,
    showsActionConstraint: false,
    requiresActionConstraint: false,
    showsCategoryConstraint: false,
    requiresCategoryConstraint: false,
    supportsCreative: false,
  },
];

router.get("/", (_req, res) => {
  return res.json({
    defaultModel: DEFAULT_MODEL_NAME,
    models: modelSchema.options,
    prompts: PROMPT_DEFINITIONS.map((prompt) => ({
      ...prompt,
      defaultActionConstraint:
        prompt.actionFamilyKey == null
          ? null
          : getActionPromptFamilyByKey(prompt.actionFamilyKey)?.canonicalWord ?? null,
    })),
  });
});

router.post("/test", async (req, res) => {
  const parsed = promptTestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid prompt test payload" });
  }

  const promptDefinition = PROMPT_DEFINITIONS.find(
    (definition) => definition.key === parsed.data.promptKey
  );
  if (!promptDefinition) {
    return res.status(404).json({ error: "Unknown prompt key" });
  }

  const model: OpenAiModel = parsed.data.model ?? DEFAULT_MODEL_NAME;

  try {
    if (promptDefinition.kind === "recipe_batch") {
      const pairs = parsed.data.pairs ?? [];
      if (pairs.length === 0) {
        return res.status(400).json({ error: "Recipe batch prompts require at least one pair" });
      }

      const renderedPrompt = renderRecipeBatchPrompt({ pairs });
      const result = await generateRecipeBatch({ model, pairs });
      return res.json({
        promptKey: promptDefinition.key,
        promptTitle: promptDefinition.title,
        model,
        renderedPrompt,
        result,
      });
    }

    const inputs = (parsed.data.inputs ?? []).map((value) => value.trim()).filter(Boolean);
    if (inputs.length === 0) {
      return res.status(400).json({ error: "This prompt requires at least one input" });
    }

    const actionConstraint = parsed.data.actionConstraint?.trim();
    const categoryConstraint = parsed.data.categoryConstraint?.trim();

    if (promptDefinition.requiresActionConstraint && !actionConstraint) {
      return res.status(400).json({ error: "This prompt requires an action anchor" });
    }

    if (promptDefinition.requiresCategoryConstraint && !categoryConstraint) {
      return res.status(400).json({ error: "This prompt requires a category anchor" });
    }

    const creative = promptDefinition.key === "creative";
    const actionPromptFamily =
      promptDefinition.actionFamilyKey == null ? null : promptDefinition.actionFamilyKey;
    const webSearchResults =
      actionPromptFamily === "pop_culture"
        ? await searchGoogleLikeWeb(inputs.join(" "), { limit: 3 })
        : undefined;
    if (actionPromptFamily === "pop_culture" && (!webSearchResults || webSearchResults.length === 0)) {
      throw new Error("No web search results returned for the web search query");
    }
    const { prompt: renderedPrompt, actionPromptFamily: resolvedFamily } =
      renderGenerateResultPrompt(inputs, {
        creative,
        actionConstraint,
        actionPromptFamily,
        categoryConstraint,
        webSearchResults,
      });
    const result = await generateResult(inputs, {
      model,
      creative,
      actionConstraint,
      actionPromptFamily,
      categoryConstraint,
      webSearchResults,
    });

    return res.json({
      promptKey: promptDefinition.key,
      promptTitle: promptDefinition.title,
      model,
      renderedPrompt,
      webSearchResults: webSearchResults ?? [],
      resolvedActionFamilyKey: resolvedFamily?.key ?? null,
      result,
    });
  } catch (err) {
    console.error("[api][prompts] prompt test failed", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Prompt test failed",
    });
  }
});

export default router;
