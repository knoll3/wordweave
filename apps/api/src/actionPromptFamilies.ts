export type ActionPromptResponseMode = "default" | "strict" | "split";

export type ActionPromptFamilyKey =
  | "split"
  | "opposite"
  | "synonym"
  | "evolve"
  | "pop_culture"
  | "compound"
  | "translate"
  | "abbreviate"
  | "expand"
  | "distill"
  | "simplify"
  | "common";

export type ActionPromptFamily = {
  key: ActionPromptFamilyKey;
  title: string;
  canonicalWord: string;
  prompt: string;
  responseMode: ActionPromptResponseMode;
  triggerWords: string[];
};

const CATEGORY_RULES_PLACEHOLDER = "{{OPTIONAL_CATEGORY_RULES}}";

const OPTIONAL_CATEGORY_RULES = `

If a Category modifier is also active, the result must still clearly belong inside {{CATEGORY_CONSTRAINT}}.
Preserve that category constraint while following the action behavior below.
`.trim();

const SPLIT_ACTION_PROMPT = `
You are the split engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to split the dominant input into the literal real words that make up that text.

Only do textual splitting. This is not about conceptual decomposition, physical parts, ingredients, or semantic components.

Good results:
- two-word names split into their separate words
- longer phrases split into each real word
- single compound words split into the real words they are derived from
- return clean standalone words rather than surface forms with punctuation or possession attached
- keep only meaningful concept words that make sense as standalone library items

Bad results:
- conceptual parts
- ingredients
- components
- thematic associations
- anything that is not an actual word-level split of the text itself
- articles, prepositions, conjunctions, possessive markers, or other glue words that do not make sense as standalone concepts

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return a list of the literal words produced by splitting the text.
- Every successful result must be a real word from the textual split itself.
- Do not return explanations, descriptions, or sentences.
- Always return the best plausible word-level split you can find, even if it is imperfect.
- Omit filler words that are only grammatical glue and would not make sense as useful standalone library concepts.
- If no real split exists, return the original word as the only result.
- Never return conceptual decompositions or semantic parts.

Return ONLY valid JSON in this format:

{
  "results": [
    { "name": "first result", "icon": "emoji" },
    { "name": "second result", "icon": "emoji" }
  ]
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const OPPOSITE_ACTION_PROMPT = `
You are the opposite engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest and most widely recognized opposite of the dominant input concept.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result.
- Keep the result short and recognizable. Nouns are common, but actions or short phrases are allowed when they are the clearest fit.
- Do not return explanations, descriptions, sentences.
- Favor a direct and recognizable opposite, not a poetic or loosely contrasting concept.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const SYNONYM_ACTION_PROMPT = `
You are the synonym engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest synonym, alternate name, alias, equivalent term, or very close word-form variant for the dominant meaning those inputs point to.

Prefer direct equivalence first. If there is no strong synonym, you may return a very close and recognizable word-family variant or near-equivalent form instead.

Do not fall back to examples, broader categories, poetic associations, or loosely related concepts. A close word-form shift is acceptable, but it should still feel like almost the same idea rather than a different concept.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result or a failure.
- Keep the result short and recognizable. Nouns are common, but actions or short phrases are allowed when they are the clearest fit.
- Do not return explanations beyond the failure reason.
- Favor a real, recognizable synonym, alias, alternate name, or near-equivalent term.
- If no strong synonym exists, prefer a closely related form of the same word or idea before failing.
- If the inputs do not plausibly point to a strong synonym or close equivalent form, return a failure.

Return ONLY valid JSON in one of these formats:

{
  "failed": true,
  "reason": "short reason"
}

or

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const EVOLVE_ACTION_PROMPT = `
You are the evolve engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest next-stage, more advanced, stronger, more mature, or more developed form of the dominant input concept.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result.
- Keep the result short and recognizable. Nouns are common, but actions or short phrases are allowed when they are the clearest fit.
- Do not return explanations, descriptions, sentences.
- Favor clear progression over sidegrades or loosely related variants.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const POP_CULTURE_ACTION_PROMPT = `
You are the pop culture engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs as clues. Your job is to return the single most recognizable specific pop culture reference those clues point to.

Prefer a named character, place, franchise, prop, scene, celebrity, or entertainment concept over a broad genre or vague theme.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result.
- Keep the result short and recognizable. Nouns are common, but actions or short phrases are allowed when they are the clearest fit.
- Do not return explanations, descriptions, sentences.
- Favor the most specific and widely recognizable reference.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const COMPOUND_ACTION_PROMPT = `
You are the compound-word engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return a real established compound word or common phrase formed by those inputs, but only when such a result genuinely exists.

If there is no strong real compound or phrase, fail instead of inventing one.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result or a failure.
- Keep the result short and recognizable. Nouns are common, but actions or short phrases are allowed when they are the clearest fit.
- Do not return explanations beyond the failure reason.
- Favor dictionary-style compounds, encyclopedia-style terms, and common established phrases.
- If the inputs do not form a real established expression, return a failure.

Return ONLY valid JSON in one of these formats:

{
  "failed": true,
  "reason": "short reason"
}

or

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const TRANSLATE_ACTION_PROMPT = `
You are the translation engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest and most recognizable translation, alternate-language rendering, or equivalent expression those inputs point to.

Prefer a result that preserves the same meaning in another familiar linguistic form rather than drifting into a loose association.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result or a failure.
- Keep the result short and recognizable.
- Do not return explanations beyond the failure reason.
- Favor a well-known translation, borrowed form, or equivalent expression.
- If there is no strong recognizable translation target, return a failure.

Return ONLY valid JSON in one of these formats:

{
  "failed": true,
  "reason": "short reason"
}

or

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const ABBREVIATE_ACTION_PROMPT = `
You are the abbreviation engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest abbreviation, acronym, shortened form, or shorthand version those inputs point to.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result or a failure.
- Keep the result short and recognizable.
- Do not return explanations beyond the failure reason.
- Favor real and recognizable abbreviations, acronyms, initials, or shortened forms.
- If no strong abbreviation exists, return a failure.

Return ONLY valid JSON in one of these formats:

{
  "failed": true,
  "reason": "short reason"
}

or

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const EXPAND_ACTION_PROMPT = `
You are the expansion engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest expanded, spelled-out, or full-form version of the dominant shorthand concept those inputs point to.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result or a failure.
- Keep the result short and recognizable.
- Do not return explanations beyond the failure reason.
- Favor real and recognizable full forms over guessed or invented expansions.
- If no strong expansion exists, return a failure.

Return ONLY valid JSON in one of these formats:

{
  "failed": true,
  "reason": "short reason"
}

or

{
  "failed": false,
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const DISTILL_ACTION_PROMPT = `
You are the distillation engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest, most concentrated essence, extract, or defining core result those inputs point to.

Prefer the primary essence or most central concentrated output over a decorative side product.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result.
- Keep the result short and recognizable.
- Do not return explanations, descriptions, or sentences.
- Favor the most fundamental concentrated core over a broad summary.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const SIMPLIFY_ACTION_PROMPT = `
You are the simplification engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the clearest simpler, more basic, more direct, or more canonical version of the dominant concept those inputs point to.

Prefer the cleanest base form over a specialized, embellished, or technical variant.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result.
- Keep the result short and recognizable.
- Do not return explanations, descriptions, or sentences.
- Favor a simpler and more direct form, not merely a shorter related phrase.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

const COMMON_ACTION_PROMPT = `
You are the commonality engine for a sandbox discovery game.

The player has applied an Action modifier to {{ACTION_CONSTRAINT}}.

The player provides several inputs. Your job is to return the most specific real thing that every input has.

Prefer the narrowest shared attribute, part, property, feature, component, or concept that is genuinely true of every input. If the overlap is weak, broaden only as much as needed until the result is still true for all of them.

${CATEGORY_RULES_PLACEHOLDER}

Rules:
- Return exactly one result.
- Keep the result short and recognizable.
- Do not return explanations, descriptions, or sentences.
- Ask yourself: "What specific thing does every input have?"
- The result must be literally true of every input with no exceptions.
- Do not use loose association, metaphor, mood, theme, or category similarity as the answer.
- Favor the most specific shared thing over a broader one when both are valid.
- If the overlap is extremely weak, return the broadest truthful thing they all still have rather than inventing a fake connection.
- Never return something that is false for even one input.

Return ONLY valid JSON in this format:

{
  "name": "result name",
  "icon": "emoji"
}

Inputs:
{{INPUT_ELEMENTS_ARRAY}}
`.trim();

export const ACTION_PROMPT_FAMILIES: ActionPromptFamily[] = [
  {
    key: "split",
    title: "Split",
    canonicalWord: "split",
    prompt: SPLIT_ACTION_PROMPT,
    responseMode: "split",
    triggerWords: [
      "split",
      "separate",
      "separation",
      "divide",
      "division",
      "fission",
      "half",
      "halve",
      "break",
      "breakdown",
      "decompose",
      "disassemble",
      "fracture",
      "fragment",
      "fragmentation",
      "subtract",
      "subtraction",
      "remove",
      "removal",
      "difference",
      "extract",
      "peel",
      "carve",
      "detach",
      "dissect",
      "partition",
      "slice",
      "cut",
    ],
  },
  {
    key: "opposite",
    title: "Opposite",
    canonicalWord: "opposite",
    prompt: OPPOSITE_ACTION_PROMPT,
    responseMode: "default",
    triggerWords: [
      "opposite",
      "antonym",
      "inverse",
      "contrary",
      "counter",
      "negate",
      "negation",
      "opposed",
      "negative",
      "contrast",
      "antithesis",
      "reverse",
      "reversed",
      "backward",
      "backwards",
      "undo",
      "invert",
      "inversion",
      "rewind",
      "flip",
    ],
  },
  {
    key: "synonym",
    title: "Synonym",
    canonicalWord: "synonym",
    prompt: SYNONYM_ACTION_PROMPT,
    responseMode: "strict",
    triggerWords: [
      "synonym",
      "alias",
      "equivalent",
      "equivalence",
      "term",
      "expression",
      "wording",
      "reword",
      "nickname",
      "moniker",
      "codename",
      "designation",
      "appellation",
      "epithet",
      "thesaurus",
      "paraphrase",
      "rephrase",
      "rename",
    ],
  },
  {
    key: "evolve",
    title: "Evolve",
    canonicalWord: "evolve",
    prompt: EVOLVE_ACTION_PROMPT,
    responseMode: "default",
    triggerWords: [
      "evolve",
      "evolution",
      "evolutionary",
      "mutate",
      "mutation",
      "adapt",
      "adaptation",
      "develop",
      "development",
      "advance",
      "advancement",
      "growth",
      "improve",
      "improvement",
      "upgrade",
      "progress",
      "progression",
      "transform",
      "transformation",
      "metamorphosis",
      "metamorphose",
      "mature",
      "ascend",
    ],
  },
  {
    key: "pop_culture",
    title: "Pop Culture",
    canonicalWord: "pop culture",
    prompt: POP_CULTURE_ACTION_PROMPT,
    responseMode: "default",
    triggerWords: [
      "pop culture",
      "movie",
      "music",
      "song",
      "album",
      "band",
      "actor",
      "actress",
      "film",
      "cinema",
      "television",
      "tv",
      "show",
      "celebrity",
      "fandom",
      "franchise",
      "entertainment",
      "meme",
      "anime",
      "cartoon",
      "hollywood",
    ],
  },
  {
    key: "compound",
    title: "Compound",
    canonicalWord: "compound",
    prompt: COMPOUND_ACTION_PROMPT,
    responseMode: "strict",
    triggerWords: [
      "compound",
      "word",
      "vocabulary",
      "language",
      "dictionary",
      "portmanteau",
      "phrase",
      "spelling",
      "lexicon",
      "linguistics",
      "grammar",
      "name",
      "term",
      "hyphenate",
      "blend",
      "hyphen",
      "fusion",
      "collocation",
    ],
  },
  {
    key: "translate",
    title: "Translate",
    canonicalWord: "translate",
    prompt: TRANSLATE_ACTION_PROMPT,
    responseMode: "strict",
    triggerWords: [
      "translate",
      "translation",
      "interpret",
      "render",
      "gloss",
      "dub",
    ],
  },
  {
    key: "abbreviate",
    title: "Abbreviate",
    canonicalWord: "abbreviate",
    prompt: ABBREVIATE_ACTION_PROMPT,
    responseMode: "strict",
    triggerWords: [
      "abbreviate",
      "abbreviation",
      "acronym",
      "initialism",
      "initials",
      "shorten",
      "shorthand",
      "contract",
    ],
  },
  {
    key: "expand",
    title: "Expand",
    canonicalWord: "expand",
    prompt: EXPAND_ACTION_PROMPT,
    responseMode: "strict",
    triggerWords: [
      "expand",
      "expansion",
      "elaborate",
      "elaboration",
      "unfold",
      "extend",
    ],
  },
  {
    key: "distill",
    title: "Distill",
    canonicalWord: "distill",
    prompt: DISTILL_ACTION_PROMPT,
    responseMode: "default",
    triggerWords: [
      "distill",
      "distilled",
      "distillation",
      "essence",
      "extract",
      "refine",
      "purify",
      "core",
      "gist",
    ],
  },
  {
    key: "simplify",
    title: "Simplify",
    canonicalWord: "simplify",
    prompt: SIMPLIFY_ACTION_PROMPT,
    responseMode: "default",
    triggerWords: [
      "simplify",
      "simple",
      "simplification",
      "basic",
      "reduce",
      "clarify",
      "streamline",
      "plain",
    ],
  },
  {
    key: "common",
    title: "Common",
    canonicalWord: "common",
    prompt: COMMON_ACTION_PROMPT,
    responseMode: "default",
    triggerWords: [
      "common",
      "commonality",
      "shared",
      "mutual",
      "overlap",
      "intersection",
      "similarity",
      "alike",
    ],
  },
];

const ACTION_PROMPT_FAMILY_BY_KEY = new Map(
  ACTION_PROMPT_FAMILIES.map((family) => [family.key, family] as const)
);

export function getAllActionPromptFamilies() {
  return ACTION_PROMPT_FAMILIES;
}

export function normalizeActionTrigger(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ACTION_PROMPT_FAMILY_BY_TRIGGER = new Map<string, ActionPromptFamily>(
  ACTION_PROMPT_FAMILIES.flatMap((family) =>
    family.triggerWords.map((trigger) => [normalizeActionTrigger(trigger), family] as const)
  )
);

export function resolveActionPromptFamily(
  actionConstraint: string | null | undefined
): ActionPromptFamily | null {
  const normalized = normalizeActionTrigger(actionConstraint ?? "");
  if (!normalized) {
    return null;
  }
  return ACTION_PROMPT_FAMILY_BY_TRIGGER.get(normalized) ?? null;
}

export function getActionPromptFamilyByKey(
  key: ActionPromptFamilyKey | null | undefined
): ActionPromptFamily | null {
  if (!key) {
    return null;
  }
  return ACTION_PROMPT_FAMILY_BY_KEY.get(key) ?? null;
}

export function renderActionPromptFamily(params: {
  family: ActionPromptFamily;
  actionConstraint: string;
  categoryConstraint?: string;
  inputs: string[];
}) {
  const categoryRules = params.categoryConstraint
    ? OPTIONAL_CATEGORY_RULES.replace(
        /{{CATEGORY_CONSTRAINT}}/g,
        params.categoryConstraint
      )
    : "";

  return params.family.prompt
    .replace(/{{ACTION_CONSTRAINT}}/g, params.actionConstraint)
    .replace(CATEGORY_RULES_PLACEHOLDER, categoryRules)
    .replace(/{{INPUT_ELEMENTS_ARRAY}}/g, JSON.stringify(params.inputs));
}
