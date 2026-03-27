export const CHALLENGE_TARGETS_PROMPT = `
You are generating challenge target words for a sandbox discovery game.

The player wants a batch of hard targets to chase.

Your job is to return {{TARGET_COUNT}} quest terms that would be genuinely difficult to reach in this game, while still feeling fair, interesting, and worth pursuing.

Requested difficulty:
{{QUEST_DIFFICULTY_GUIDANCE}}

What "challenging" means here:
- hard because the term is semantically slippery, indirect, referential, abstract, relational, directional, functional, culturally specific, or otherwise difficult to arrive at through normal game combinations
- hard because it is deceptively plain, elusive, or awkward to path into
- not hard just because it is academically obscure, scholarly, mythological, or historical
- not hard because you stapled an unusual adjective onto a noun
- not hard because the phrase is awkward, arbitrary, or overly long

Good target styles:
- deceptively simple words that are hard to reach
- occasional pop culture references, movie/show-adjacent concepts, and other things a normal person would actually recognize
- internet culture, meme-adjacent, or playful terms
- abstract concepts
- directional, relational, logical, or functional words
- culturally specific or referential terms
- weird but legitimate everyday words
- short canonical phrases only when they are fixed, famous concepts

These are good only sometimes, not as the dominant pattern:
- historical references
- mythological references
- abstract concepts

Bad target styles:
- easy everyday objects
- generic broad categories
- dry academic obscurities chosen only to seem clever
- batches that collapse into history, mythology, or scholarly references
- trivia-night bait, lore dumps, or niche factoid answers that feel more like homework than play
- random adjective+noun constructions made up just to seem difficult
- clunky sentences or descriptive phrases
- terms the player already has

Variety rules:
- keep the batch varied
- do not collapse into one topic, register, or tone
- include a mix of concrete, abstract, referential, and strange-but-legitimate targets
- include some quests that feel fun, weird, or lowbrow instead of only clever or highbrow
- favor targets that feel culturally legible and fun for a broad audience, not like an academic exam

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

