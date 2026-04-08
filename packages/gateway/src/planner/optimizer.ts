import type { StatePlan, StateNode } from "../types/task.js";

/**
 * Plan optimizer — parallelization, strategic waits, fallback paths.
 */
export function optimizePlan(plan: StatePlan): StatePlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => optimizeNode(node)),
  };
}

function optimizeNode(node: StateNode): StateNode {
  // Add default verification if missing
  if (!node.verify && node.type === "action") {
    return {
      ...node,
      verify: {
        strategy: "api",
        expected: "Step completed successfully",
        timeoutMs: 10000,
      },
    };
  }
  return node;
}

/**
 * Identify which branches in the plan can run in parallel.
 * Returns groups of node IDs that share no dependencies.
 */
export function findParallelGroups(plan: StatePlan): string[][] {
  const groups: string[][] = [];
  const assigned = new Set<string>();

  for (const node of plan.nodes) {
    if (assigned.has(node.id)) continue;

    // Find all nodes with the same dependency set
    const group = plan.nodes
      .filter(
        (n) =>
          !assigned.has(n.id) &&
          JSON.stringify(n.dependencies.sort()) ===
            JSON.stringify(node.dependencies.sort())
      )
      .map((n) => n.id);

    if (group.length > 0) {
      groups.push(group);
      for (const id of group) assigned.add(id);
    }
  }

  return groups;
}
