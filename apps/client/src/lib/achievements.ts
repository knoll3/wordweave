import type {
  AchievementCategoryProgress,
  AchievementGroupProgress,
  AchievementProgress,
  AchievementSummary,
  Item,
} from "../types";

export type AchievementTestMatch = {
  id: string;
  title: string;
  description: string;
  points: number;
  lookupName: string;
  autoMatches: boolean;
  score: number;
};

type AchievementDefinition = {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  groupId: string;
  points: number;
  requirement: {
    count: number;
    targets: string[];
    aliases?: string[];
  };
};

type CategoryDefinition = {
  id: string;
  title: string;
  summary: string;
};

type GroupDefinition = {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
};

const CATEGORIES: CategoryDefinition[] = [
  {
    id: "pokemon",
    title: "Pokemon",
    summary: "A long-tail chain for creatures, icons, and legendary favorites.",
  },
  {
    id: "myth",
    title: "Myth & Legend",
    summary: "Mythic figures, artifacts, and monsters that feel great to chase.",
  },
  {
    id: "science",
    title: "Science & Space",
    summary: "Famous scientific ideas and space terms with a bit of gravitas.",
  },
  {
    id: "world",
    title: "World Icons",
    summary: "Landmarks, wonders, and places that read instantly at a glance.",
  },
  {
    id: "screen",
    title: "Screens & Stories",
    summary: "Recognizable fictional references, props, and big-screen icons.",
  },
  {
    id: "beasts",
    title: "Beasts & Giants",
    summary: "Dinosaurs, colossal creatures, and legendary heavy-hitters.",
  },
];

const GROUPS: GroupDefinition[] = [
  {
    id: "pokemon-icons",
    categoryId: "pokemon",
    title: "Iconic Pokemon",
    summary: "Specific standouts worth calling out on their own.",
  },
  {
    id: "myth-icons",
    categoryId: "myth",
    title: "Mythic Staples",
    summary: "Land the names and objects people instantly recognize.",
  },
  {
    id: "science-icons",
    categoryId: "science",
    title: "Signal Finds",
    summary: "Big-ticket science terms that feel especially satisfying.",
  },
  {
    id: "world-icons",
    categoryId: "world",
    title: "Postcard Moments",
    summary: "Specific landmarks and places with immediate recognition.",
  },
  {
    id: "screen-icons",
    categoryId: "screen",
    title: "Headline References",
    summary: "Specific names and props that feel especially good to land.",
  },
  {
    id: "beast-icons",
    categoryId: "beasts",
    title: "Big Finds",
    summary: "Signature creatures that deserve their own stamp.",
  },
];

const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "pokemon-pikachu",
    title: "Discover Pikachu",
    description: "Land the mascot itself.",
    categoryId: "pokemon",
    groupId: "pokemon-icons",
    points: 5,
    requirement: { count: 1, targets: ["pikachu"] },
  },
  {
    id: "pokemon-mewtwo",
    title: "Discover Mewtwo",
    description: "Hit one of the most iconic legendary Pokemon.",
    categoryId: "pokemon",
    groupId: "pokemon-icons",
    points: 10,
    requirement: { count: 1, targets: ["mewtwo"] },
  },
  {
    id: "pokemon-charizard",
    title: "Discover Charizard",
    description: "Find a heavyweight fan favorite.",
    categoryId: "pokemon",
    groupId: "pokemon-icons",
    points: 10,
    requirement: { count: 1, targets: ["charizard"] },
  },
  {
    id: "pokemon-eevee",
    title: "Discover Eevee",
    description: "Track down one of the series' most versatile icons.",
    categoryId: "pokemon",
    groupId: "pokemon-icons",
    points: 5,
    requirement: { count: 1, targets: ["eevee"] },
  },
  {
    id: "pokemon-snorlax",
    title: "Discover Snorlax",
    description: "Wake up a crowd-pleasing classic.",
    categoryId: "pokemon",
    groupId: "pokemon-icons",
    points: 5,
    requirement: { count: 1, targets: ["snorlax"] },
  },
  {
    id: "myth-excalibur",
    title: "Discover Excalibur",
    description: "Find one of fantasy's most famous blades.",
    categoryId: "myth",
    groupId: "myth-icons",
    points: 10,
    requirement: { count: 1, targets: ["excalibur"] },
  },
  {
    id: "myth-mjolnir",
    title: "Discover Mjolnir",
    description: "Bring Thor's hammer into the library.",
    categoryId: "myth",
    groupId: "myth-icons",
    points: 10,
    requirement: { count: 1, targets: ["mjolnir"] },
  },
  {
    id: "myth-medusa",
    title: "Discover Medusa",
    description: "Land a mythic figure players instantly recognize.",
    categoryId: "myth",
    groupId: "myth-icons",
    points: 5,
    requirement: { count: 1, targets: ["medusa"] },
  },
  {
    id: "myth-kraken",
    title: "Discover Kraken",
    description: "Find a monster that always feels good to unlock.",
    categoryId: "myth",
    groupId: "myth-icons",
    points: 5,
    requirement: { count: 1, targets: ["kraken"] },
  },
  {
    id: "myth-phoenix",
    title: "Discover Phoenix",
    description: "Add a legendary creature with serious staying power.",
    categoryId: "myth",
    groupId: "myth-icons",
    points: 5,
    requirement: { count: 1, targets: ["phoenix"] },
  },
  {
    id: "science-black-hole",
    title: "Discover Black Hole",
    description: "Land one of the biggest science-fiction-adjacent science terms.",
    categoryId: "science",
    groupId: "science-icons",
    points: 10,
    requirement: { count: 1, targets: ["black hole"] },
  },
  {
    id: "science-quark",
    title: "Discover Quark",
    description: "Find a classic small-but-mighty science term.",
    categoryId: "science",
    groupId: "science-icons",
    points: 5,
    requirement: { count: 1, targets: ["quark"] },
  },
  {
    id: "science-nebula",
    title: "Discover Nebula",
    description: "Add a beautiful space term with instant mood.",
    categoryId: "science",
    groupId: "science-icons",
    points: 5,
    requirement: { count: 1, targets: ["nebula"] },
  },
  {
    id: "science-dna",
    title: "Discover DNA",
    description: "Hit a term with huge cultural and scientific reach.",
    categoryId: "science",
    groupId: "science-icons",
    points: 5,
    requirement: { count: 1, targets: ["dna"] },
  },
  {
    id: "science-antimatter",
    title: "Discover Antimatter",
    description: "Land a harder science concept with strong flavor.",
    categoryId: "science",
    groupId: "science-icons",
    points: 10,
    requirement: { count: 1, targets: ["antimatter"] },
  },
  {
    id: "world-pyramid",
    title: "Discover Pyramid",
    description: "Land one of the all-time classic world targets.",
    categoryId: "world",
    groupId: "world-icons",
    points: 5,
    requirement: { count: 1, targets: ["pyramid"] },
  },
  {
    id: "world-stonehenge",
    title: "Discover Stonehenge",
    description: "Find a world icon with instant mystery attached.",
    categoryId: "world",
    groupId: "world-icons",
    points: 10,
    requirement: { count: 1, targets: ["stonehenge"] },
  },
  {
    id: "world-eiffel-tower",
    title: "Discover Eiffel Tower",
    description: "Add a landmark people recognize in one glance.",
    categoryId: "world",
    groupId: "world-icons",
    points: 10,
    requirement: { count: 1, targets: ["eiffel tower"] },
  },
  {
    id: "world-great-wall",
    title: "Discover Great Wall",
    description: "Track down one of the biggest place achievements around.",
    categoryId: "world",
    groupId: "world-icons",
    points: 10,
    requirement: { count: 1, targets: ["great wall"] },
  },
  {
    id: "world-atlantis",
    title: "Discover Atlantis",
    description: "Mix world icon energy with a touch of legend.",
    categoryId: "world",
    groupId: "world-icons",
    points: 10,
    requirement: { count: 1, targets: ["atlantis"] },
  },
  {
    id: "screen-batman",
    title: "Discover Batman",
    description: "Find a franchise icon with broad recognition.",
    categoryId: "screen",
    groupId: "screen-icons",
    points: 5,
    requirement: { count: 1, targets: ["batman"] },
  },
  {
    id: "screen-godzilla",
    title: "Discover Godzilla",
    description: "Bring in a giant of monster cinema.",
    categoryId: "screen",
    groupId: "screen-icons",
    points: 10,
    requirement: { count: 1, targets: ["godzilla"] },
  },
  {
    id: "screen-shrek",
    title: "Discover Shrek",
    description: "Land a reference that proves the system can stay playful.",
    categoryId: "screen",
    groupId: "screen-icons",
    points: 5,
    requirement: { count: 1, targets: ["shrek"] },
  },
  {
    id: "screen-harry-potter",
    title: "Discover Harry Potter",
    description: "Hit one of the biggest named story references around.",
    categoryId: "screen",
    groupId: "screen-icons",
    points: 10,
    requirement: { count: 1, targets: ["harry potter"] },
  },
  {
    id: "screen-lightsaber",
    title: "Discover Lightsaber",
    description: "Find an iconic prop that everyone recognizes immediately.",
    categoryId: "screen",
    groupId: "screen-icons",
    points: 5,
    requirement: { count: 1, targets: ["lightsaber"] },
  },
  {
    id: "beasts-t-rex",
    title: "Discover T-Rex",
    description: "Find the headliner.",
    categoryId: "beasts",
    groupId: "beast-icons",
    points: 10,
    requirement: {
      count: 1,
      targets: ["t-rex"],
      aliases: ["t rex", "trex", "tyrannosaurus", "tyrannosaurus rex"],
    },
  },
  {
    id: "beasts-velociraptor",
    title: "Discover Velociraptor",
    description: "Land a dino with instant chase appeal.",
    categoryId: "beasts",
    groupId: "beast-icons",
    points: 5,
    requirement: { count: 1, targets: ["velociraptor"] },
  },
  {
    id: "beasts-megalodon",
    title: "Discover Megalodon",
    description: "Pull in a creature that feels big even as a word.",
    categoryId: "beasts",
    groupId: "beast-icons",
    points: 10,
    requirement: { count: 1, targets: ["megalodon"] },
  },
  {
    id: "beasts-mammoth",
    title: "Discover Mammoth",
    description: "Find a prehistoric giant with great recognizability.",
    categoryId: "beasts",
    groupId: "beast-icons",
    points: 5,
    requirement: { count: 1, targets: ["mammoth"] },
  },
  {
    id: "beasts-triceratops",
    title: "Discover Triceratops",
    description: "Add another dino classic to the shelf.",
    categoryId: "beasts",
    groupId: "beast-icons",
    points: 5,
    requirement: { count: 1, targets: ["triceratops"] },
  },
];

const ACHIEVEMENT_DEFINITIONS_BY_ID = new Map(
  ACHIEVEMENTS.map((definition) => [definition.id, definition] as const)
);

function getRequirementNames(definition: AchievementDefinition) {
  return [...definition.requirement.targets, ...(definition.requirement.aliases ?? [])];
}

const ACHIEVEMENT_IDS_BY_TARGET = (() => {
  const next = new Map<string, string[]>();
  for (const definition of ACHIEVEMENTS) {
    for (const target of getRequirementNames(definition)) {
      const normalizedTarget = normalizeAchievementText(target);
      if (!normalizedTarget) {
        continue;
      }
      const bucket = next.get(normalizedTarget) ?? [];
      if (!bucket.includes(definition.id)) {
        bucket.push(definition.id);
      }
      next.set(normalizedTarget, bucket);
    }
  }
  return next;
})();

const ACHIEVEMENT_TARGETS = ACHIEVEMENTS.flatMap((definition) =>
  getRequirementNames(definition)
    .map((target) => {
      const normalizedTarget = normalizeAchievementText(target);
      if (!normalizedTarget) {
        return null;
      }
      return {
        achievementId: definition.id,
        normalizedTarget,
        tokenCount: normalizedTarget.split(/\s+/).filter(Boolean).length,
      };
    })
    .filter((entry): entry is { achievementId: string; normalizedTarget: string; tokenCount: number } => entry != null)
);

function normalizeAchievementText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeToken(token: string) {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ses") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function buildAchievementTestVariants(rawValues: Array<string | null | undefined>) {
  const variants = new Set<string>();

  for (const rawValue of rawValues) {
    if (!rawValue) {
      continue;
    }
    const normalized = normalizeAchievementText(rawValue);
    if (!normalized) {
      continue;
    }
    variants.add(normalized);

    const singularized = normalized
      .split(/\s+/)
      .filter(Boolean)
      .map(singularizeToken)
      .join(" ");
    if (singularized) {
      variants.add(singularized);
    }
  }

  return [...variants];
}

function computeTokenOverlapScore(left: string, right: string) {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  if (intersection === 0) {
    return 0;
  }

  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function computeEditDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}

function computeStringSimilarity(left: string, right: string) {
  const longestLength = Math.max(left.length, right.length);
  if (longestLength === 0) {
    return 1;
  }
  return 1 - computeEditDistance(left, right) / longestLength;
}

function isContainedAchievementPhrase(itemName: string, targetName: string, targetTokenCount: number) {
  if (targetTokenCount < 2) {
    return false;
  }

  const itemTokens = itemName.split(/\s+/).filter(Boolean);
  const targetTokens = targetName.split(/\s+/).filter(Boolean);
  if (targetTokens.length !== targetTokenCount || itemTokens.length <= targetTokens.length) {
    return false;
  }

  for (let start = 0; start <= itemTokens.length - targetTokens.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < targetTokens.length; offset += 1) {
      if (itemTokens[start + offset] !== targetTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}

function findMatchingAchievementIdsForItem(normalizedItemName: string) {
  const exactMatches = ACHIEVEMENT_IDS_BY_TARGET.get(normalizedItemName) ?? [];
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const fallbackMatches: string[] = [];
  for (const target of ACHIEVEMENT_TARGETS) {
    if (
      isContainedAchievementPhrase(
        normalizedItemName,
        target.normalizedTarget,
        target.tokenCount
      )
    ) {
      fallbackMatches.push(target.achievementId);
    }
  }

  return fallbackMatches;
}

export function testItemAgainstAchievements(params: {
  itemName: string;
  referenceTitle?: string | null;
}) {
  const variants = buildAchievementTestVariants([
    params.itemName,
    params.referenceTitle ?? null,
  ]);

  if (variants.length === 0) {
    return {
      automaticMatches: [] as AchievementTestMatch[],
      likelyMatches: [] as AchievementTestMatch[],
    };
  }

  const automaticMatches: AchievementTestMatch[] = [];
  const likelyMatches: AchievementTestMatch[] = [];

  for (const definition of ACHIEVEMENTS) {
    const targetVariants = buildAchievementTestVariants(getRequirementNames(definition));

    let autoMatches = false;
    let bestScore = 0;
    for (const itemVariant of variants) {
      for (const targetVariant of targetVariants) {
        if (itemVariant === targetVariant) {
          autoMatches = true;
          bestScore = 1;
          break;
        }

        const tokenOverlap = computeTokenOverlapScore(itemVariant, targetVariant);
        const similarity = computeStringSimilarity(itemVariant, targetVariant);
        const combinedScore = Math.max(
          similarity,
          tokenOverlap >= 0.8 ? 0.82 + tokenOverlap * 0.12 : 0
        );
        if (combinedScore > bestScore) {
          bestScore = combinedScore;
        }
      }
      if (autoMatches) {
        break;
      }
    }

    const match: AchievementTestMatch = {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      points: definition.points,
      lookupName: definition.requirement.targets[0] ?? definition.title,
      autoMatches,
      score: bestScore,
    };

    if (autoMatches) {
      automaticMatches.push(match);
    } else if (bestScore >= 0.86) {
      likelyMatches.push(match);
    }
  }

  const sortMatches = (left: AchievementTestMatch, right: AchievementTestMatch) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.points !== left.points) {
      return right.points - left.points;
    }
    return left.title.localeCompare(right.title);
  };

  automaticMatches.sort(sortMatches);
  likelyMatches.sort(sortMatches);

  return {
    automaticMatches,
    likelyMatches: likelyMatches.slice(0, 5),
  };
}

function buildAchievementProgress(
  earnedAchievementIds: Set<string>,
  definition: AchievementDefinition
): AchievementProgress {
  const progressCurrent = earnedAchievementIds.has(definition.id) ? definition.requirement.count : 0;
  const progressTarget = definition.requirement.count;
  const completed = progressCurrent >= progressTarget;
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    lookupName: definition.requirement.targets[0] ?? definition.title,
    points: definition.points,
    completed,
    progressCurrent,
    progressTarget,
  };
}

export function evaluateAchievements(items: Item[]): AchievementSummary {
  const earnedAchievementIds = new Set<string>();
  for (const item of items) {
    const normalizedItemName = normalizeAchievementText(item.normalizedName || item.name);
    if (!normalizedItemName) {
      continue;
    }
    const matchingAchievementIds = findMatchingAchievementIdsForItem(normalizedItemName);
    for (const achievementId of matchingAchievementIds) {
      if (ACHIEVEMENT_DEFINITIONS_BY_ID.has(achievementId)) {
        earnedAchievementIds.add(achievementId);
      }
    }
  }

  const progressByGroup = new Map<string, AchievementProgress[]>();
  for (const definition of ACHIEVEMENTS) {
    const progress = buildAchievementProgress(earnedAchievementIds, definition);
    const bucket = progressByGroup.get(definition.groupId) ?? [];
    bucket.push(progress);
    progressByGroup.set(definition.groupId, bucket);
  }

  const categories: AchievementCategoryProgress[] = CATEGORIES.map((category) => {
    const groups: AchievementGroupProgress[] = GROUPS.filter(
      (group) => group.categoryId === category.id
    ).map((group) => {
      const achievements = progressByGroup.get(group.id) ?? [];
      const earnedPoints = achievements
        .filter((achievement) => achievement.completed)
        .reduce((sum, achievement) => sum + achievement.points, 0);
      const totalPoints = achievements.reduce((sum, achievement) => sum + achievement.points, 0);
      const completedCount = achievements.filter((achievement) => achievement.completed).length;
      return {
        id: group.id,
        title: group.title,
        summary: group.summary,
        achievements,
        earnedPoints,
        totalPoints,
        completedCount,
        totalCount: achievements.length,
      };
    });

    const earnedPoints = groups.reduce((sum, group) => sum + group.earnedPoints, 0);
    const totalPoints = groups.reduce((sum, group) => sum + group.totalPoints, 0);
    const completedCount = groups.reduce((sum, group) => sum + group.completedCount, 0);
    const totalCount = groups.reduce((sum, group) => sum + group.totalCount, 0);

    return {
      id: category.id,
      title: category.title,
      summary: category.summary,
      groups,
      earnedPoints,
      totalPoints,
      completedCount,
      totalCount,
    };
  });

  const allAchievements = categories.flatMap((category) =>
    category.groups.flatMap((group) => group.achievements)
  );
  const totalPoints = allAchievements.reduce((sum, achievement) => sum + achievement.points, 0);
  const earnedPoints = allAchievements
    .filter((achievement) => achievement.completed)
    .reduce((sum, achievement) => sum + achievement.points, 0);
  const completedCount = allAchievements.filter((achievement) => achievement.completed).length;

  const featuredProgress = allAchievements
    .filter((achievement) => !achievement.completed && achievement.progressCurrent > 0)
    .sort((left, right) => {
      const leftRatio = left.progressCurrent / left.progressTarget;
      const rightRatio = right.progressCurrent / right.progressTarget;
      if (rightRatio !== leftRatio) {
        return rightRatio - leftRatio;
      }
      if (right.points !== left.points) {
        return right.points - left.points;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, 3);

  return {
    categories,
    earnedPoints,
    totalPoints,
    completedCount,
    totalCount: allAchievements.length,
    featuredProgress,
  };
}
