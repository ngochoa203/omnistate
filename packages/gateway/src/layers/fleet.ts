/**
 * Fleet Layer — multi-machine coordination.
 *
 * One OmniState instance acts as Fleet Commander,
 * others as Fleet Agents. Communication over WebSocket/Tailscale.
 */

export class FleetLayer {
  private agents: Map<string, FleetAgent> = new Map();

  /** Register a fleet agent. */
  registerAgent(agent: FleetAgent): void {
    this.agents.set(agent.id, agent);
  }

  /** Remove a fleet agent. */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** Get all connected agents. */
  getAgents(): FleetAgent[] {
    return Array.from(this.agents.values());
  }

  /** Distribute a task to agents matching a target group. */
  async distributeTask(
    taskId: string,
    targetGroup: string,
    _plan: unknown
  ): Promise<FleetDistributionResult> {
    const matching = Array.from(this.agents.values()).filter(
      (a) => a.group === targetGroup && a.status === "healthy"
    );

    if (matching.length === 0) {
      return {
        taskId,
        distributed: 0,
        failed: 0,
        agents: [],
      };
    }

    // TODO: Actually send task plan to each agent via WebSocket
    return {
      taskId,
      distributed: matching.length,
      failed: 0,
      agents: matching.map((a) => a.id),
    };
  }
}

export interface FleetAgent {
  id: string;
  hostname: string;
  address: string;
  group: string;
  status: "healthy" | "degraded" | "offline";
  lastSeen: number;
  capabilities: string[];
}

export interface FleetDistributionResult {
  taskId: string;
  distributed: number;
  failed: number;
  agents: string[];
}
