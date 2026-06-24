import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { ArchitectureController } from "../controllers/architectureController.js";

const controller = new ArchitectureController();
export const architectureRoutes = Router();

architectureRoutes.post("/generate", asyncHandler(controller.generate));
architectureRoutes.post("/expand-node", asyncHandler(controller.expandNode));
architectureRoutes.get("/node/:nodeId", asyncHandler(controller.nodeDetails));
architectureRoutes.post("/export/mermaid", controller.exportMermaid);

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
