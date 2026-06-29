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

## Deploy On Vercel

This repo is configured for a single Vercel project:

- Frontend: Vite build from `apps/web`
- Backend: Express app exposed through Vercel Functions under `/api`
- Build output: `apps/web/dist`

Use these Vercel project settings:

```txt
Framework Preset: Other
Root Directory: .
Install Command: npm install
Build Command: npm run build -w @navix/shared && npm run build -w @navix/api && npm run build -w @navix/web
Output Directory: apps/web/dist
```

For a same-project Vercel deployment, set:

```txt
VITE_API_URL=/api
ENABLE_CACHE=false
```

Add real API secrets only in the Vercel Environment Variables UI, never in `.env.example`.

## Orbit Integration

The API uses an `OrbitClient` interface. `RealOrbitClient` queries GitLab Orbit, while `MockOrbitClient` remains available for local/demo fallback behavior.
