import type { NodeDetails, OrbitQueryResult, PromptIntent } from "@navix/shared";
import { config } from "../config/env.js";
import { MockOrbitClient } from "../clients/mockOrbitClient.js";
import { RealOrbitClient } from "../clients/realOrbitClient.js";
import type { OrbitClient } from "../types/orbitClient.js";

export class OrbitService {
  private readonly client: OrbitClient;

  constructor() {
    this.client =
      config.orbitProvider === "orbit"
        ? new RealOrbitClient({
            apiUrl: config.orbitApiUrl,
            apiKey: config.orbitApiKey || config.gitlabToken
          })
        : new MockOrbitClient();
  }

  queryArchitecture(input: PromptIntent, repoUrl?: string): Promise<OrbitQueryResult> {
    return this.client.queryArchitecture(input, repoUrl);
  }

  expandNode(
    nodeId: string,
    input: PromptIntent,
    repoUrl?: string,
    currentNodeIds?: string[]
  ): Promise<OrbitQueryResult> {
    return this.client.expandNode(nodeId, input, repoUrl, currentNodeIds);
  }

  getNodeDetails(nodeId: string): Promise<NodeDetails | undefined> {
    return this.client.getNodeDetails(nodeId);
  }
}
