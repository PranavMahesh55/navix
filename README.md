# Orbit Atlas

Orbit Atlas is an interactive developer onboarding system that turns GitLab Orbit codebase relationships into a focused architecture map.

Phase 1 uses mocked Orbit responses so the full product loop can be built and demoed before the real Orbit API is connected.

## What Works In This MVP

- Prompt input for architecture questions
- Mock Orbit query layer
- Graph construction and ranking pipeline
- Express API endpoints
- React Flow visualization
- Node details panel
- Learning path
- Graph expansion from selected nodes
- Mermaid export

## Run Locally

```bash
npm install
npm run dev
```

The API runs on `http://localhost:8080`.

The web app runs on `http://localhost:5173`.

## API Endpoints

- `GET /health`
- `POST /api/architecture/generate`
- `POST /api/architecture/expand-node`
- `GET /api/architecture/node/:nodeId`
- `POST /api/architecture/export/mermaid`

## Orbit Integration Path

The API uses an `OrbitClient` interface. The current provider is `MockOrbitClient`; replace or extend `RealOrbitClient` in `apps/api/src/clients/realOrbitClient.ts` when Orbit credentials and API shape are available.
