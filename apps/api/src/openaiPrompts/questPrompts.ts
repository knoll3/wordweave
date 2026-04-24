export const QUEST_TARGETS_PROMPT = `
You are generating quest target concepts for a sandbox discovery game.

The player wants a themed quest set based on a topic they typed in.

Chosen topic:
{{QUEST_TOPIC}}

Your job is to return {{TARGET_COUNT}} quest targets that clearly belong to that topic while still feeling fun, recognizable, and worth chasing in the game.
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
- full, well-known concepts when that is how players naturally recognize the idea
- a coherent mix that feels like a real themed set
- terms that are distinct from each other and not near-duplicates

Bad target styles:
- broad umbrella categories
- obscure trivia chosen only to seem clever
- generic words that barely relate to the topic
- artificially shortened fragments that lose the full idea
- long descriptive phrases that are not established concepts
- repeated variants of the same idea
- terms the player already has

Variety rules:
- keep the batch coherent but not repetitive
- include a satisfying spread within the chosen topic or subtheme
- favor targets that feel fun and culturally legible, not like homework

Hard rules:
- Return exactly {{TARGET_COUNT}} targets.
- Put the best, most broadly satisfying options first.
- Prefer the full concept players would naturally name, even when that takes multiple words.
- Do not shorten a famous concept to a single generic word just to make it briefer.
- Every target must be recognizable and plausible in this game.
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
    { "name": "target concept", "icon": "emoji" }
  ]
}
`.trim();

export const QUEST_TARGETS_EASY_PROMPT = `
You are generating quest target concepts for a sandbox discovery game.

The player wants a themed quest set based on a topic they typed in.

Chosen topic:
{{QUEST_TOPIC}}

The player's library is still small, so this batch should favor targets that are much easier to discover than a normal quest set.

This game works by combining simple words into new results. That means "easy" does not mean boring, childish, or random. It means the target should feel realistically reachable from common, concrete, high-frequency words that a newer player is likely to already have or plausibly discover soon.

Your job is to return {{TARGET_COUNT}} quest targets that clearly belong to that topic while still feeling fun, recognizable, and worth chasing in the game.
Order the targets from strongest to weakest choice.
The top part of the list will be highlighted to the player as your best recommendations, so ranking quality matters.

Topic handling rules:
- Stay clearly anchored to the chosen topic.
- If the topic is broad, choose one coherent subtheme and stay consistent within it.
- Favor terms a normal player would recognize.
- Do not drift into abstract meta-language about the topic.
- Do not generate generic filler that could fit any topic.

Easy-target rules:
- Favor targets that can plausibly be reached from simple base vocabulary and familiar intermediate concepts.
- Prefer concrete nouns, creatures, places, objects, roles, symbols, foods, weather terms, common natural things, and famous concepts with very straightforward clue paths.
- Prefer concepts that a player could imagine reaching through a short chain of intuitive combinations.
- When choosing between two equally on-topic targets, choose the one with the simpler, more obvious recipe path.
- Favor highly legible concepts whose name clearly points at what they are.
- Avoid targets that usually require niche knowledge, long thematic chains, indirect metaphor, wordplay, or specialist vocabulary.

Good easy target styles:
- recognizable characters, places, items, creatures, concepts, symbols, or famous phrases that clearly fit the topic
- full, well-known concepts when that is how players naturally recognize the idea
- a coherent mix that feels like a real themed set
- terms that are distinct from each other and not near-duplicates
- concepts that can likely be built from common words a player already knows how to combine
- concepts with short, intuitive, game-plausible discovery paths

Bad easy target styles:
- broad umbrella categories
- obscure trivia chosen only to seem clever
- generic words that barely relate to the topic
- artificially shortened fragments that lose the full idea
- long descriptive phrases that are not established concepts
- repeated variants of the same idea
- terms the player already has
- concepts that are mainly hard because they depend on rare wording or a long chain of abstract intermediate steps
- targets that feel like they require advanced game knowledge to even guess

Variety rules:
- keep the batch coherent but not repetitive
- include a satisfying spread within the chosen topic or subtheme
- favor targets that feel fun and culturally legible, not like homework
- within that, bias toward the easiest strong options first

Hard rules:
- Return exactly {{TARGET_COUNT}} targets.
- Put the best, most broadly satisfying and easiest-to-reach options first.
- Prefer the full concept players would naturally name, even when that takes multiple words.
- Do not shorten a famous concept to a single generic word just to make it briefer.
- Every target must be recognizable and plausible in this game.
- Every target must be easier than average for this topic, judged by likely discovery path in a simple-word combination game.
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
    { "name": "target concept", "icon": "emoji" }
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
