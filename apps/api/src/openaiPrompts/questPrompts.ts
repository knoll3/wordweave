export const QUEST_TARGETS_PROMPT = `
You are generating quest target words for a sandbox discovery game.

The player wants a themed quest set based on a topic they typed in.

Chosen topic:
{{QUEST_TOPIC}}

Your job is to return {{TARGET_COUNT}} quest terms that clearly belong to that topic while still feeling fun, recognizable, and worth chasing in the game.
Order the targets from strongest to weakest choice.
The top part of the list will be highlighted to the player as your best recommendations, so ranking quality matters.

Topic handling rules:
- Stay clearly anchored to the chosen topic.
- If the topic is broad, choose one coherent subtheme and stay consistent within it.
- Favor terms a normal player would recognize.
- Do not drift into abstract meta-language about the topic.
- Do not generate generic filler that could fit any topic.

Good target styles:
- recognizable characters, places, items, creatures, concepts, symbols, or famous phrases that clearly fit the topic
- a coherent mix that feels like a real themed set
- terms that are distinct from each other and not near-duplicates

Bad target styles:
- broad umbrella categories
- obscure trivia chosen only to seem clever
- generic words that barely relate to the topic
- long descriptive phrases
- repeated variants of the same idea
- terms the player already has

Variety rules:
- keep the batch coherent but not repetitive
- include a satisfying spread within the chosen topic or subtheme
- favor targets that feel fun and culturally legible, not like homework

Hard rules:
- Return exactly {{TARGET_COUNT}} targets.
- Put the best, most broadly satisfying options first.
- Prefer single words.
- Two-word targets are allowed only if they are fixed, well-known concepts.
- Every target must be short, recognizable, and plausible in this game.
- Do not return anything from the recent target exclusion list.
- Do not return anything from the current generation exclusion list.
- Do not explain anything outside the JSON.
- Already-discovered terms are filtered after generation, so do not waste the batch on obvious, generic, overused targets.

Recent target exclusion list:
{{RECENT_TARGETS_ARRAY}}

Completed quest exclusion list:
{{COMPLETED_TARGETS_ARRAY}}

Current generation exclusion list:
{{SESSION_EXCLUDED_TARGETS_ARRAY}}

Return ONLY valid JSON in this format:

{
  "targets": [
    { "name": "target word", "icon": "emoji" }
  ]
}
`.trim();

export const QUEST_TARGET_VARIANTS_PROMPT = `
You are generating alternate spellings for accepted quest targets in a sandbox discovery game.

Your job is to list spelling or formatting variants that refer to the exact same thing as each target.

Only include true alternate spellings, such as:
- spelling variants
- regional spelling variants
- transliteration variants
- hyphenation variants
- spacing variants
- punctuation variants
- singular/plural forms when they still refer to the same exact concept

Do not include:
- synonyms
- broader or narrower related terms
- different objects in the same category
- translations into other languages unless they are a commonly used alternate spelling of the same term
- explanatory phrases
- trivia or adjacent references

Good examples:
- mandoline -> mandolin
- x-ray -> xray
- t shirt -> t-shirt

Bad examples:
- mandolin -> guitar
- airplane -> airport
- spider-man -> marvel hero

Return only variants that are genuinely useful for matching player discoveries to the same quest target.
If there are no good alternate spellings, return an empty array for that target.

Accepted quest targets:
{{QUEST_TARGETS_ARRAY}}

Return ONLY valid JSON in this format:

{
  "targets": [
    {
      "name": "target word",
      "alternateSpellings": ["variant 1", "variant 2"]
    }
  ]
}
`.trim();
