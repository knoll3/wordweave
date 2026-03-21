import type { Database } from "sql.js";
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
  representativeItems: ClusteredElement[];
  members: ClusteredElement[];
}

export interface SemanticClustersResponse {
  generatedAt: string;
  totalItems: number;
  clusterCount: number;
  maxClusters: number;
  overlapItemCount: number;
  clusters: SemanticCluster[];
}

const DEFAULT_MAX_CLUSTERS = 10;
const TARGET_CLUSTER_SIZE = 12;
const MAX_SECONDARY_MEMBERSHIPS = 2;
const SECONDARY_MARGIN = 0.08;
const SECONDARY_MIN_SIMILARITY = 0.72;
const MAX_ITERATIONS = 12;

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

export async function buildSemanticClusters(
  db: Database,
  options?: { maxClusters?: number }
): Promise<SemanticClustersResponse> {
  const discoveredRows = loadDiscoveredElements(db);
  const maxClusters = Math.max(1, Math.min(options?.maxClusters ?? DEFAULT_MAX_CLUSTERS, 10));
  const itemIds = discoveredRows.map((row) => Number(row.id));

  await ensureSearchIndexForElementIds(db, itemIds);
  const embeddingsById = loadEmbeddingsByElementId(db, itemIds);

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

  if (items.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalItems: 0,
      clusterCount: 0,
      maxClusters,
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
      overlapItemCount: 0,
      clusters: [
        {
          id: "cluster-1",
          title: buildClusterTitle(clusterMembers),
          summary: buildClusterSummary(clusterMembers),
          memberCount: items.length,
          primaryMemberCount: items.length,
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

    const nextCentroids = centroids.map((centroid, clusterIndex) => {
      const clusterVectors = items
        .filter((item) => assignments.get(item.id) === clusterIndex)
        .map((item) => item.embedding);
      return clusterVectors.length > 0 ? averageEmbedding(clusterVectors) : centroid;
    });

    centroids = nextCentroids;
    if (unchanged) {
      break;
    }
  }

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

  const clusters = clusterMemberships
    .map((members, clusterIndex) => {
      const sortedMembers = [...members].sort((left, right) => {
        if (right.similarity !== left.similarity) {
          return right.similarity - left.similarity;
        }
        return left.item.name.localeCompare(right.item.name, "en");
      });
      const primaryMembers = sortedMembers.filter((entry) => entry.isPrimary);

      return {
        id: `cluster-${clusterIndex + 1}`,
        title: buildClusterTitle(primaryMembers.length > 0 ? primaryMembers : sortedMembers),
        summary: buildClusterSummary(primaryMembers.length > 0 ? primaryMembers : sortedMembers),
        memberCount: sortedMembers.length,
        primaryMemberCount: primaryMembers.length,
        representativeItems: sortedMembers.slice(0, 5).map((entry) => ({
          id: entry.item.id,
          name: entry.item.name,
          normalizedName: entry.item.normalizedName,
          icon: entry.item.icon,
          membershipStrength: Number(entry.similarity.toFixed(4)),
          isPrimary: entry.isPrimary,
        })),
        members: sortedMembers.map((entry) => ({
          id: entry.item.id,
          name: entry.item.name,
          normalizedName: entry.item.normalizedName,
          icon: entry.item.icon,
          membershipStrength: Number(entry.similarity.toFixed(4)),
          isPrimary: entry.isPrimary,
        })),
      } satisfies SemanticCluster;
    })
    .filter((cluster) => cluster.primaryMemberCount > 0)
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
    overlapItemCount: overlapItemIds.size,
    clusters,
  };
}
