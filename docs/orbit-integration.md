# Orbit Integration Notes

Phase 1 intentionally keeps GitLab Orbit behind a narrow client interface:

```ts
interface OrbitClient {
  queryArchitecture(input, repoUrl): Promise<OrbitQueryResult>;
  expandNode(nodeId, input, repoUrl): Promise<OrbitQueryResult>;
  getNodeDetails(nodeId): Promise<NodeDetails>;
}
```

The UI and graph pipeline should not know whether data came from the mock provider or the real Orbit API.

## Replacement Steps

1. Set `ORBIT_PROVIDER=orbit`.
2. Set `ORBIT_API_URL=https://gitlab.com/api/v4/orbit`.
3. Add a GitLab personal access token with `read_api` scope to `GITLAB_TOKEN`. `ORBIT_API_KEY` is optional and only needed if you want a separate credential for Orbit.
4. Keep graph limits enforced in `GraphBuilder` so large repositories stay readable.

## Current Real Client

`apps/api/src/clients/realOrbitClient.ts` now queries Orbit Remote for:

- `Definition` nodes matched by `name`, `file_path`, and `fqn`
- `File` nodes as a fallback when no definitions are found
- `ImportedSymbol` nodes for import-derived dependency edges
- `Definition --CALLS--> Definition` relationships when Orbit exposes call edges

The client first checks whether Orbit returns the requested `Project`. If the project is not visible or indexed for the token, it returns an empty grounded result with a limitation instead of querying unrelated repositories. If the project is visible, it runs project-scoped source-code traversals.

## Troubleshooting

If a repo URL returns no nodes, check whether Orbit can see that project:

```json
{
  "query_type": "traversal",
  "node": {
    "id": "project",
    "entity": "Project",
    "filters": { "full_path": "group/project" },
    "columns": ["id", "name", "full_path"]
  },
  "limit": 1
}
```

During validation, `gitlab-org/gitlab` returned no `Project` node for the configured token, while `gitlab-community/gitlab-org/orbit/knowledge-graph` did. Running deeper `Project -> Branch -> File -> Definition` traversals against an invisible project wasted several seconds per query and caused the endpoint to hit the outer diagnostic timeout. The fix is to preflight project visibility before source-code traversals.

## Grounding Rule

All node explanations should be derived from Orbit result fields such as symbol summaries, file metadata, dependencies, tests, and ownership metadata. The LLM layer can rewrite or compress grounded facts, but it should not invent components that are absent from Orbit results.
