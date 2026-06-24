import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { config } from "./config/env.js";
import { architectureRoutes } from "./routes/architectureRoutes.js";

const app = express();

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "orbit-atlas-api",
    provider: config.orbitProvider === "orbit" ? "gitlab-orbit" : "mock-orbit",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/architecture", architectureRoutes);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      issues: error.issues
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected API error";
  const status = message.includes("not implemented")
    ? 501
    : message.includes("OpenAI") || message.includes("GitLab source fetch") || message.includes("Source-grounded")
      ? 502
      : 500;
  res.status(status).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`Orbit Atlas API listening on http://localhost:${config.port}`);
});
