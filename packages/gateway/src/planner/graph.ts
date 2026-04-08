import type { StateNode, StatePlan } from "../types/task.js";

/**
 * State Graph (DAG) builder.
 *
 * Constructs a directed acyclic graph of execution steps from
 * a goal and set of sub-tasks. Handles dependency resolution
 * and topological ordering.
 */
export class StateGraph {
  private nodes: Map<string, StateNode> = new Map();

  addNode(node: StateNode): void {
    this.nodes.set(node.id, node);
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    // Remove from dependencies of other nodes
    for (const node of this.nodes.values()) {
      node.dependencies = node.dependencies.filter((dep) => dep !== id);
    }
  }

  getNode(id: string): StateNode | undefined {
    return this.nodes.get(id);
  }

  /** Get nodes that are ready to execute (all dependencies satisfied). */
  getReadyNodes(completedIds: Set<string>): StateNode[] {
    const ready: StateNode[] = [];
    for (const node of this.nodes.values()) {
      if (completedIds.has(node.id)) continue;
      const allDepsMet = node.dependencies.every((dep) =>
        completedIds.has(dep)
      );
      if (allDepsMet) {
        ready.push(node);
      }
    }
    return ready;
  }

  /** Return nodes in topological order. */
  topologicalSort(): StateNode[] {
    const visited = new Set<string>();
    const result: StateNode[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.nodes.get(id);
      if (!node) return;
      for (const dep of node.dependencies) {
        visit(dep);
      }
      result.push(node);
    };

    for (const id of this.nodes.keys()) {
      visit(id);
    }
    return result;
  }

  /** Convert to a StatePlan. */
  toPlan(taskId: string, goal: string): StatePlan {
    const sorted = this.topologicalSort();
    const totalMs = sorted.reduce(
      (sum, n) => sum + n.estimatedDurationMs,
      0
    );
    return {
      taskId,
      goal,
      estimatedDuration: `${Math.round(totalMs / 1000)}s`,
      nodes: sorted,
    };
  }
}
