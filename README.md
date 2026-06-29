# Navix

Navix is an interactive developer onboarding system that turns GitLab Orbit codebase relationships into a focused architecture map.

Phase 1 builds the full product loop with GitLab Orbit integration, source-grounded node explanations, and a React Flow architecture explorer.

## What Works In This MVP

- Prompt input for architecture questions
- GitLab Orbit query layer with mock fallback
- Graph construction and ranking pipeline
- Express API endpoints
- React Flow visualization
- Source-grounded selected-node explanations
- Node details panel
- Learning path
- Graph expansion from selected nodes
- Mermaid export

## Run Locally

```bash
npm install
cp .env.example .env
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

## Environment

Use `.env.example` as the local configuration template. Keep real tokens in `.env`; it is ignored by Git.

## Orbit Integration

The API uses an `OrbitClient` interface. `RealOrbitClient` queries GitLab Orbit, while `MockOrbitClient` remains available for local/demo fallback behavior.
