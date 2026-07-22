import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
  }
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("x-correlation-id");
  const correlationId =
    incoming && incoming.trim().length > 0 ? incoming : randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = process.hrtime.bigint() - startedAt;
    const durationMs = Number(durationNs) / 1_000_000;

    logger.info(
      {
        correlationId,
        route: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      "request completed",
    );
  });

  next();
}
