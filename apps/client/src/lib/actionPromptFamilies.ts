export type ActionPromptFamilyReference = {
  key:
    | "split"
    | "opposite"
    | "synonym"
    | "evolve"
    | "pop_culture"
    | "compound"
    | "reverse"
    | "translate"
    | "abbreviate"
    | "expand"
    | "distill"
    | "simplify"
    | "common";
  title: string;
  description: string;
  triggerWords: string[];
};

export const ACTION_PROMPT_FAMILY_REFERENCES: ActionPromptFamilyReference[] = [
  {
    key: "split",
    title: "Split",
    description: "Split the text itself into the real words it is made from.",
    triggerWords: [
      "split",
      "separate",
      "separation",
      "divide",
      "division",
      "fission",
      "half",
      "halve",
      "break apart",
      "break down",
      "decompose",
      "disassemble",
      "fracture",
      "fragment",
      "fragmentation",
      "slice",
      "cut",
    ],
  },
  {
    key: "opposite",
    title: "Opposite",
    description: "Return the clearest direct opposite of the dominant idea.",
    triggerWords: [
      "opposite",
      "antonym",
      "inverse",
      "contrary",
      "counter",
      "counterpart",
      "negate",
      "negation",
      "flip side",
    ],
  },
  {
    key: "synonym",
    title: "Synonym",
    description: "Find a synonym, alias, alternate name, or very close word-form variant.",
    triggerWords: [
      "synonym",
      "synonyms",
      "alias",
      "equivalent",
      "equivalence",
      "same meaning",
      "another word",
      "other word",
      "alternate name",
      "alternate term",
      "paraphrase",
      "rephrase",
      "rename",
    ],
  },
  {
    key: "evolve",
    title: "Evolve",
    description: "Push something toward a stronger, more advanced, or later-stage form.",
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
      "upgrade",
      "progress",
      "progression",
      "transform",
      "transformation",
      "metamorphosis",
      "metamorphose",
    ],
  },
  {
    key: "pop_culture",
    title: "Pop Culture",
    description: "Turn the clues into one specific recognizable pop culture reference.",
    triggerWords: [
      "pop culture",
      "movie",
      "movies",
      "film",
      "tv",
      "television",
      "show",
      "celebrity",
      "fandom",
      "franchise",
      "entertainment",
    ],
  },
  {
    key: "compound",
    title: "Compound",
    description: "Build a real established compound word or common phrase if one exists.",
    triggerWords: [
      "compound",
      "compound word",
      "combine words",
      "portmanteau",
      "phrase",
      "hyphenate",
      "word blend",
      "blend words",
    ],
  },
  {
    key: "reverse",
    title: "Reverse",
    description: "Flip something backward, undo it, or return a reversed form.",
    triggerWords: [
      "reverse",
      "reversed",
      "backward",
      "backwards",
      "undo",
      "invert",
      "inversion",
      "rewind",
      "turn back",
    ],
  },
  {
    key: "translate",
    title: "Translate",
    description: "Return a translation or equivalent expression in another familiar form.",
    triggerWords: [
      "translate",
      "translation",
      "translated",
      "interpret",
      "render",
      "say in another language",
      "say in another way",
    ],
  },
  {
    key: "abbreviate",
    title: "Abbreviate",
    description: "Compress something into an acronym, shorthand, or shortened form.",
    triggerWords: [
      "abbreviate",
      "abbreviation",
      "acronym",
      "initialism",
      "initials",
      "shorten",
      "shorthand",
      "short form",
    ],
  },
  {
    key: "expand",
    title: "Expand",
    description: "Spell out a shorthand term into its full recognizable form.",
    triggerWords: [
      "expand",
      "expansion",
      "expanded",
      "spell out",
      "full form",
      "long form",
      "elaborate",
    ],
  },
  {
    key: "distill",
    title: "Distill",
    description: "Extract the essence, concentrate, or defining core of something.",
    triggerWords: [
      "distill",
      "distilled",
      "distillation",
      "essence",
      "extract",
      "refine",
      "purify",
    ],
  },
  {
    key: "simplify",
    title: "Simplify",
    description: "Reduce something to a more basic, direct, or canonical form.",
    triggerWords: [
      "simplify",
      "simple",
      "simplification",
      "basic",
      "reduce",
      "clarify",
      "boil down",
    ],
  },
  {
    key: "common",
    title: "Common",
    description: "Find the most specific thing all inputs truly have in common.",
    triggerWords: [
      "common",
      "commonality",
      "shared",
      "shared trait",
      "in common",
      "mutual",
      "overlap",
      "intersection",
    ],
  },
];

export function normalizeActionTrigger(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
