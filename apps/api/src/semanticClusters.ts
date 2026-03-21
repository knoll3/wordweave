import type { Database } from "sql.js";
import { generateEmbeddings } from "./openaiClient";
import { ensureSearchIndexForElementIds } from "./search";

type IndexedClusterElement = {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
  discoveredAt: string;
  embedding: number[];
};

export interface ClusteredElement {
  id: number;
  name: string;
  normalizedName: string;
  icon: string | null;
  membershipStrength: number;
  isPrimary: boolean;
}

export interface SemanticCluster {
  id: string;
  title: string;
  summary: string;
  memberCount: number;
  primaryMemberCount: number;
  isOutlierBucket: boolean;
  labelSource: "catalog" | "composed" | "fallback";
  labelConfidence: number;
  representativeTerms: string[];
  representativeItems: ClusteredElement[];
  members: ClusteredElement[];
  children?: SemanticCluster[];
}

export interface SemanticClustersResponse {
  generatedAt: string;
  totalItems: number;
  clusterCount: number;
  maxClusters: number;
  minClusterSize: number;
  overlapItemCount: number;
  clusters: SemanticCluster[];
}

const DEFAULT_MAX_CLUSTERS = 10;
const MIN_CLUSTER_PRIMARY_SIZE = 4;
const MAX_CLUSTER_PRIMARY_SIZE = 48;
const TARGET_CLUSTER_SIZE = 12;
const MAX_SECONDARY_MEMBERSHIPS = 2;
const SECONDARY_MARGIN = 0.08;
const SECONDARY_MIN_SIMILARITY = 0.72;
const MAX_ITERATIONS = 12;
const MAX_CHILD_CLUSTERS = 6;
const CHILD_TARGET_CLUSTER_SIZE = 18;
const LABEL_QUERY_PREFIX = "cluster-label:";
const CLUSTER_LABEL_CATALOG = [
  "Animals",
  "Plants",
  "People",
  "Jobs",
  "Tools",
  "Machines",
  "Materials",
  "Food",
  "Buildings",
  "Transportation",
  "Weather",
  "Water",
  "Geography",
  "Space",
  "Technology",
  "Magic",
  "Myth",
  "Conflict",
  "Music",
  "Art",
  "Language",
  "Science",
  "Fire & Heat",
  "Sky & Air",
  "Earth & Stone",
  "Ocean & Sea Life",
  "Pop Culture",
] as const;

type LabelCandidate = {
  label: string;
  embedding: number[];
};

function cosine(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function averageEmbedding(vectors: number[][]) {
  if (vectors.length === 0) {
    return [];
  }

  const dimension = vectors[0]?.length ?? 0;
  const totals = new Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dimension; index += 1) {
      totals[index] += vector[index] ?? 0;
    }
  }
  return totals.map((value) => value / vectors.length);
}

function chooseClusterCount(itemCount: number, maxClusters: number) {
  if (itemCount <= 1) {
    return itemCount;
  }
  return Math.max(
    2,
    Math.min(maxClusters, Math.ceil(itemCount / TARGET_CLUSTER_SIZE))
  );
}

function chooseChildClusterCount(itemCount: number) {
  if (itemCount <= MAX_CLUSTER_PRIMARY_SIZE) {
    return 0;
  }

  return Math.max(
    2,
    Math.min(MAX_CHILD_CLUSTERS, Math.ceil(itemCount / CHILD_TARGET_CLUSTER_SIZE))
  );
}

function loadDiscoveredElements(db: Database) {
  const stmt = db.prepare(
    `
    SELECT
      e.id,
      e.name,
      e.normalized_name,
      e.icon,
      d.discovered_at
    FROM discoveries d
    JOIN elements e ON e.id = d.element_id
    ORDER BY d.discovered_at ASC, e.id ASC
    `
  );

  const rows: Array<{
    id: number;
    name: string;
    normalized_name: string;
    icon: string | null;
    discovered_at: string;
  }> = [];

  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as (typeof rows)[number]);
  }
  stmt.free();
  return rows;
}

function loadEmbeddingsByElementId(db: Database, elementIds: number[]) {
  if (elementIds.length === 0) {
    return new Map<number, number[]>();
  }

  const placeholders = elementIds.map(() => "?").join(", ");
  const stmt = db.prepare(
    `
    SELECT element_id, embedding_json
    FROM element_embeddings
    WHERE element_id IN (${placeholders})
    `
  );
  stmt.bind(elementIds);

  const embeddings = new Map<number, number[]>();
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    embeddings.set(
      Number(row.element_id),
      JSON.parse(String(row.embedding_json)) as number[]
    );
  }
  stmt.free();
  return embeddings;
}

function selectInitialCentroids(items: IndexedClusterElement[], clusterCount: number) {
  const centroids: number[][] = [];
  if (items.length === 0 || clusterCount === 0) {
    return centroids;
  }

  centroids.push(items[0].embedding);
  while (centroids.length < clusterCount) {
    let bestCandidate: IndexedClusterElement | null = null;
    let bestDistance = Number.NEGATIVE_INFINITY;

    for (const item of items) {
      const nearestSimilarity = centroids.reduce((best, centroid) => {
        return Math.max(best, cosine(item.embedding, centroid));
      }, Number.NEGATIVE_INFINITY);

      const distance = 1 - nearestSimilarity;
      if (distance > bestDistance) {
        bestDistance = distance;
        bestCandidate = item;
      }
    }

    if (!bestCandidate) {
      break;
    }

    centroids.push(bestCandidate.embedding);
  }

  while (centroids.length < clusterCount) {
    centroids.push(items[centroids.length % items.length].embedding);
  }

  return centroids;
}

function buildClusterTitle(
  members: Array<{ item: IndexedClusterElement; similarity: number }>
) {
  const topNames = [...members]
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 3)
    .map((entry) => entry.item.name);

  return topNames.join(" / ");
}

function buildClusterSummary(
  members: Array<{ item: IndexedClusterElement; similarity: number }>
) {
  const topNames = [...members]
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5)
    .map((entry) => entry.item.name);

  if (topNames.length === 0) {
    return "No representative items yet.";
  }

  if (topNames.length === 1) {
    return `Centered on ${topNames[0]}.`;
  }

  return `Centered on ${topNames.slice(0, -1).join(", ")}, and ${topNames.at(-1)}.`;
}

function loadCachedPhraseEmbedding(db: Database, queryText: string) {
  const stmt = db.prepare(
    `
    SELECT embedding_json
    FROM search_query_embeddings
    WHERE query_text = ?
    `
  );
  const row = stmt.getAsObject([queryText]) as Record<string, unknown>;
  stmt.free();
  if (row.embedding_json == null) {
    return null;
  }
  return JSON.parse(String(row.embedding_json)) as number[];
}

function savePhraseEmbedding(
  db: Database,
  queryText: string,
  model: string,
  embedding: number[]
) {
  const stmt = db.prepare(
    `
    INSERT INTO search_query_embeddings (query_text, model, embedding_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(query_text) DO UPDATE SET
      model = excluded.model,
      embedding_json = excluded.embedding_json,
      updated_at = CURRENT_TIMESTAMP
    `
  );
  stmt.run([queryText, model, JSON.stringify(embedding)]);
  stmt.free();
}

async function ensureLabelEmbeddings(db: Database) {
  const missingLabels = CLUSTER_LABEL_CATALOG.filter((label) => {
    return !loadCachedPhraseEmbedding(db, `${LABEL_QUERY_PREFIX}${label.toLowerCase()}`);
  });

  if (missingLabels.length === 0) {
    return;
  }

  const response = await generateEmbeddings(
    missingLabels.map((label) => `Cluster label: ${label}`)
  );

  response.embeddings.forEach((item, index) => {
    const label = missingLabels[index];
    savePhraseEmbedding(
      db,
      `${LABEL_QUERY_PREFIX}${label.toLowerCase()}`,
      response.model,
      item.embedding
    );
  });
}

function loadLabelCandidates(db: Database): LabelCandidate[] {
  return CLUSTER_LABEL_CATALOG.map((label) => ({
    label,
    embedding:
      loadCachedPhraseEmbedding(db, `${LABEL_QUERY_PREFIX}${label.toLowerCase()}`) ?? [],
  })).filter((entry) => entry.embedding.length > 0);
}

function scoreCatalogLabel(params: {
  centroid: number[];
  representativeEmbeddings: number[][];
  candidate: LabelCandidate;
}) {
  const centroidScore = cosine(params.centroid, params.candidate.embedding);
  const representativeScore =
    params.representativeEmbeddings.length > 0
      ? params.representativeEmbeddings.reduce((total, embedding) => {
          return total + cosine(embedding, params.candidate.embedding);
        }, 0) / params.representativeEmbeddings.length
      : 0;

  return centroidScore * 0.65 + representativeScore * 0.35;
}

function buildComposedLabel(representativeTerms: string[]) {
  const left = representativeTerms[0] ?? "Misc";
  const right = representativeTerms[1] ?? "";

  if (!right || left.toLowerCase() === right.toLowerCase()) {
    return left;
  }

  return `${left} & ${right}`;
}

function determineClusterLabel(params: {
  centroid: number[];
  representativeMembers: Array<{ item: IndexedClusterElement; similarity: number }>;
  labelCandidates: LabelCandidate[];
}) {
  const representativeTerms = params.representativeMembers
    .slice(0, 5)
    .map((entry) => entry.item.name);
  const representativeEmbeddings = params.representativeMembers
    .slice(0, 5)
    .map((entry) => entry.item.embedding);

  const scoredCandidates = params.labelCandidates
    .map((candidate) => ({
      label: candidate.label,
      score: scoreCatalogLabel({
        centroid: params.centroid,
        representativeEmbeddings,
        candidate,
      }),
    }))
    .sort((left, right) => right.score - left.score);

  const bestCatalog = scoredCandidates[0];
  if (bestCatalog && bestCatalog.score >= 0.62) {
    return {
      title: bestCatalog.label,
      labelSource: "catalog" as const,
      labelConfidence: Number(bestCatalog.score.toFixed(4)),
      representativeTerms,
    };
  }

  if (representativeTerms.length >= 2) {
    return {
      title: buildComposedLabel(representativeTerms),
      labelSource: "composed" as const,
      labelConfidence: bestCatalog ? Number(Math.max(0.4, bestCatalog.score).toFixed(4)) : 0.4,
      representativeTerms,
    };
  }

  return {
    title: representativeTerms[0] ?? "Other",
    labelSource: "fallback" as const,
    labelConfidence: bestCatalog ? Number(Math.max(0.28, bestCatalog.score).toFixed(4)) : 0.28,
    representativeTerms,
  };
}

function mapClusteredElement(params: {
  item: IndexedClusterElement;
  similarity: number;
  isPrimary: boolean;
}): ClusteredElement {
  return {
    id: params.item.id,
    name: params.item.name,
    normalizedName: params.item.normalizedName,
    icon: params.item.icon,
    membershipStrength: Number(params.similarity.toFixed(4)),
    isPrimary: params.isPrimary,
  };
}

function clusterItems(
  items: IndexedClusterElement[],
  clusterCount: number
): Array<Array<{ item: IndexedClusterElement; similarity: number }>> {
  if (items.length === 0 || clusterCount <= 0) {
    return [];
  }

  let centroids = selectInitialCentroids(items, clusterCount);
  let assignments = new Map<number, number>();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const nextAssignments = new Map<number, number>();

    for (const item of items) {
      let bestClusterIndex = 0;
      let bestSimilarity = Number.NEGATIVE_INFINITY;
      for (let clusterIndex = 0; clusterIndex < centroids.length; clusterIndex += 1) {
        const similarity = cosine(item.embedding, centroids[clusterIndex]);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestClusterIndex = clusterIndex;
        }
      }
      nextAssignments.set(item.id, bestClusterIndex);
    }

    const unchanged =
      assignments.size === nextAssignments.size &&
      Array.from(nextAssignments.entries()).every(
        ([itemId, clusterIndex]) => assignments.get(itemId) === clusterIndex
      );

    assignments = nextAssignments;

    centroids = centroids.map((centroid, clusterIndex) => {
      const clusterVectors = items
        .filter((item) => assignments.get(item.id) === clusterIndex)
        .map((item) => item.embedding);
      return clusterVectors.length > 0 ? averageEmbedding(clusterVectors) : centroid;
    });

    if (unchanged) {
      break;
    }
  }

  return centroids.map((centroid, clusterIndex) =>
    items
      .filter((item) => assignments.get(item.id) === clusterIndex)
      .map((item) => ({
        item,
        similarity: cosine(item.embedding, centroid),
      }))
      .sort((left, right) => right.similarity - left.similarity)
  );
}

function buildChildClusters(params: {
  parentId: string;
  members: ClusteredElement[];
  itemsById: Map<number, IndexedClusterElement>;
  labelCandidates: LabelCandidate[];
}) {
  const primaryItems = params.members
    .filter((member) => member.isPrimary)
    .map((member) => params.itemsById.get(member.id))
    .filter(Boolean) as IndexedClusterElement[];

  const childClusterCount = chooseChildClusterCount(primaryItems.length);
  if (childClusterCount < 2) {
    return undefined;
  }

  const grouped = clusterItems(primaryItems, childClusterCount).filter(
    (group) => group.length > 0
  );
  if (grouped.length < 2) {
    return undefined;
  }

  return grouped
    .map((group, index) => {
      const centroid = averageEmbedding(group.map((entry) => entry.item.embedding));
      const label = determineClusterLabel({
        centroid,
        representativeMembers: group,
        labelCandidates: params.labelCandidates,
      });

      return {
        id: `${params.parentId}-child-${index + 1}`,
        title: label.title,
        summary: buildClusterSummary(group),
        memberCount: group.length,
        primaryMemberCount: group.length,
        isOutlierBucket: false,
        labelSource: label.labelSource,
        labelConfidence: label.labelConfidence,
        representativeTerms: label.representativeTerms,
        representativeItems: group.slice(0, 5).map((entry) =>
          mapClusteredElement({ ...entry, isPrimary: true })
        ),
        members: group.map((entry) => mapClusteredElement({ ...entry, isPrimary: true })),
      } satisfies SemanticCluster;
    })
    .sort((left, right) => right.primaryMemberCount - left.primaryMemberCount);
}

export async function buildSemanticClusters(
  db: Database,
  options?: { maxClusters?: number }
): Promise<SemanticClustersResponse> {
  const discoveredRows = loadDiscoveredElements(db);
  const maxClusters = Math.max(1, Math.min(options?.maxClusters ?? DEFAULT_MAX_CLUSTERS, 10));
  const itemIds = discoveredRows.map((row) => Number(row.id));

  await ensureSearchIndexForElementIds(db, itemIds);
  await ensureLabelEmbeddings(db);
  const embeddingsById = loadEmbeddingsByElementId(db, itemIds);
  const labelCandidates = loadLabelCandidates(db);

  const items = discoveredRows
    .map((row) => {
      const embedding = embeddingsById.get(Number(row.id));
      if (!embedding || embedding.length === 0) {
        return null;
      }
      return {
        id: Number(row.id),
        name: String(row.name),
        normalizedName: String(row.normalized_name),
        icon: row.icon == null ? null : String(row.icon),
        discoveredAt: String(row.discovered_at),
        embedding,
      } satisfies IndexedClusterElement;
    })
    .filter(Boolean) as IndexedClusterElement[];
  const itemsById = new Map(items.map((item) => [item.id, item]));

  if (items.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalItems: 0,
      clusterCount: 0,
      maxClusters,
      minClusterSize: MIN_CLUSTER_PRIMARY_SIZE,
      overlapItemCount: 0,
      clusters: [],
    };
  }

  const clusterCount = chooseClusterCount(items.length, maxClusters);
  if (clusterCount <= 1) {
    const clusterMembers = items.map((item) => ({
      item,
      similarity: 1,
    }));

    return {
      generatedAt: new Date().toISOString(),
      totalItems: items.length,
      clusterCount: 1,
      maxClusters,
      minClusterSize: MIN_CLUSTER_PRIMARY_SIZE,
      overlapItemCount: 0,
      clusters: [
        {
          id: "cluster-1",
          title: buildComposedLabel(clusterMembers.slice(0, 2).map((entry) => entry.item.name)),
          summary: buildClusterSummary(clusterMembers),
          memberCount: items.length,
          primaryMemberCount: items.length,
          isOutlierBucket: false,
          labelSource: "composed",
          labelConfidence: 0.4,
          representativeTerms: clusterMembers.slice(0, 5).map((entry) => entry.item.name),
          representativeItems: items.slice(0, 5).map((item) => ({
            id: item.id,
            name: item.name,
            normalizedName: item.normalizedName,
            icon: item.icon,
            membershipStrength: 1,
            isPrimary: true,
          })),
          members: items.map((item) => ({
            id: item.id,
            name: item.name,
            normalizedName: item.normalizedName,
            icon: item.icon,
            membershipStrength: 1,
            isPrimary: true,
          })),
        },
      ],
    };
  }

  let centroids = selectInitialCentroids(items, clusterCount);
  let assignments = new Map<number, number>();
  const groupedPrimaryMembers = clusterItems(items, clusterCount);
  centroids = groupedPrimaryMembers.map((group) =>
    averageEmbedding(group.map((entry) => entry.item.embedding))
  );
  assignments = new Map(
    groupedPrimaryMembers.flatMap((group, clusterIndex) =>
      group.map((entry) => [entry.item.id, clusterIndex] as const)
    )
  );

  const clusterMemberships = centroids.map(() => [] as Array<{
    item: IndexedClusterElement;
    similarity: number;
    isPrimary: boolean;
  }>);

  const overlapItemIds = new Set<number>();

  for (const item of items) {
    const similarities = centroids
      .map((centroid, clusterIndex) => ({
        clusterIndex,
        similarity: cosine(item.embedding, centroid),
      }))
      .sort((left, right) => right.similarity - left.similarity);

    const primary = similarities[0];
    clusterMemberships[primary.clusterIndex].push({
      item,
      similarity: primary.similarity,
      isPrimary: true,
    });

    const secondaryMatches = similarities
      .slice(1)
      .filter(
        (entry) =>
          entry.similarity >= SECONDARY_MIN_SIMILARITY &&
          primary.similarity - entry.similarity <= SECONDARY_MARGIN
      )
      .slice(0, MAX_SECONDARY_MEMBERSHIPS);

    if (secondaryMatches.length > 0) {
      overlapItemIds.add(item.id);
    }

    for (const match of secondaryMatches) {
      clusterMemberships[match.clusterIndex].push({
        item,
        similarity: match.similarity,
        isPrimary: false,
      });
    }
  }

  const rawClusters = clusterMemberships
    .map((members, clusterIndex) => {
      const sortedMembers = [...members].sort((left, right) => {
        if (right.similarity !== left.similarity) {
          return right.similarity - left.similarity;
        }
        return left.item.name.localeCompare(right.item.name, "en");
      });
      const primaryMembers = sortedMembers.filter((entry) => entry.isPrimary);
      const centroid =
        primaryMembers.length > 0
          ? averageEmbedding(primaryMembers.map((entry) => entry.item.embedding))
          : averageEmbedding(sortedMembers.map((entry) => entry.item.embedding));
      const label = determineClusterLabel({
        centroid,
        representativeMembers: primaryMembers.length > 0 ? primaryMembers : sortedMembers,
        labelCandidates,
      });

      return {
        id: `cluster-${clusterIndex + 1}`,
        title: label.title,
        summary: buildClusterSummary(primaryMembers.length > 0 ? primaryMembers : sortedMembers),
        memberCount: sortedMembers.length,
        primaryMemberCount: primaryMembers.length,
        isOutlierBucket: false,
        labelSource: label.labelSource,
        labelConfidence: label.labelConfidence,
        representativeTerms: label.representativeTerms,
        representativeItems: sortedMembers.slice(0, 5).map((entry) => mapClusteredElement(entry)),
        members: sortedMembers.map((entry) => mapClusteredElement(entry)),
        children: undefined,
      } satisfies SemanticCluster;
    })
    .filter((cluster) => cluster.primaryMemberCount > 0);

  const undersizedClusters = rawClusters.filter(
    (cluster) => cluster.primaryMemberCount < MIN_CLUSTER_PRIMARY_SIZE
  );
  const stableClusters = rawClusters.filter(
    (cluster) => cluster.primaryMemberCount >= MIN_CLUSTER_PRIMARY_SIZE
  );

  const miscMembersById = new Map<number, ClusteredElement>();
  for (const cluster of undersizedClusters) {
    for (const member of cluster.members) {
      const existing = miscMembersById.get(member.id);
      if (!existing || member.membershipStrength > existing.membershipStrength) {
        miscMembersById.set(member.id, member);
      }
    }
  }

  const miscMembers = [...miscMembersById.values()].sort((left, right) => {
    if (right.membershipStrength !== left.membershipStrength) {
      return right.membershipStrength - left.membershipStrength;
    }
    return left.name.localeCompare(right.name, "en");
  });

  const clusters = [
    ...stableClusters.map((cluster) => ({
      ...cluster,
      children: buildChildClusters({
        parentId: cluster.id,
        members: cluster.members,
        itemsById,
        labelCandidates,
      }),
    })),
    ...(miscMembers.length > 0
      ? [
          {
            id: "cluster-other",
            title: "Other",
            summary: `Smaller semantic outliers grouped together because their source clusters had fewer than ${MIN_CLUSTER_PRIMARY_SIZE} primary items.`,
            memberCount: miscMembers.length,
            primaryMemberCount: miscMembers.filter((member) => member.isPrimary).length,
            isOutlierBucket: true,
            labelSource: "fallback",
            labelConfidence: 1,
            representativeTerms: miscMembers.slice(0, 5).map((member) => member.name),
            representativeItems: miscMembers.slice(0, 5),
            members: miscMembers,
            children: undefined,
          } satisfies SemanticCluster,
        ]
      : []),
  ]
    .sort((left, right) => {
      if (right.primaryMemberCount !== left.primaryMemberCount) {
        return right.primaryMemberCount - left.primaryMemberCount;
      }
      return left.title.localeCompare(right.title, "en");
    });

  return {
    generatedAt: new Date().toISOString(),
    totalItems: items.length,
    clusterCount: clusters.length,
    maxClusters,
    minClusterSize: MIN_CLUSTER_PRIMARY_SIZE,
    overlapItemCount: overlapItemIds.size,
    clusters,
  };
}
