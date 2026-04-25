import type { Item, SemanticCluster } from "../../types";
import { compareItemsByName } from "./elementSearch";

export function collectClusterIds(clusters: SemanticCluster[]): Set<string> {
  const ids = new Set<string>();

  const visit = (cluster: SemanticCluster) => {
    ids.add(cluster.id);
    cluster.children?.forEach(visit);
  };

  clusters.forEach(visit);
  return ids;
}

export function expandAllClusterIds(clusters: SemanticCluster[]) {
  const expandedIds: string[] = [];

  const visit = (cluster: SemanticCluster) => {
    expandedIds.push(cluster.id);
    cluster.children?.forEach(visit);
  };

  clusters.forEach(visit);
  return expandedIds;
}

export function getSortedClusterLeafEntries(
  cluster: SemanticCluster,
  itemsById: Map<number, Item>
) {
  return cluster.members
    .map((member) => {
      const item = itemsById.get(member.id);
      return item ? { item, isPrimary: member.isPrimary } : null;
    })
    .filter((entry): entry is { item: Item; isPrimary: boolean } => entry != null)
    .sort((left, right) => compareItemsByName(left.item, right.item));
}
