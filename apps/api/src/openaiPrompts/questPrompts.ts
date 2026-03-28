export const QUEST_TARGETS_PROMPT = `
You are generating quest target words for a sandbox discovery game.

The player wants a themed quest set based on a topic they typed in.

Chosen topic:
{{QUEST_TOPIC}}

Your job is to return {{TARGET_COUNT}} quest terms that clearly belong to that topic while still feeling fun, recognizable, and worth chasing in the game.

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
- Prefer single words.
- Two-word targets are allowed only if they are fixed, well-known concepts.
- Every target must be short, recognizable, and plausible in this game.
- Do not return anything from the recent target exclusion list.
- Do not explain anything outside the JSON.
- Already-discovered terms are filtered after generation, so do not waste the batch on obvious, generic, overused targets.

Recent target exclusion list:
{{RECENT_TARGETS_ARRAY}}

Completed quest exclusion list:
{{COMPLETED_TARGETS_ARRAY}}

Return ONLY valid JSON in this format:

{
  "targets": [
    { "name": "target word", "icon": "emoji" }
  ]
}
`.trim();
