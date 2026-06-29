import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { config } from "./config/env.js";
import { architectureRoutes } from "./routes/architectureRoutes.js";

export const app = express();

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

const healthHandler = (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "navix-api",
    provider: config.orbitProvider === "orbit" ? "gitlab-orbit" : "mock-orbit",
    timestamp: new Date().toISOString()
  });
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
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

export default app;
