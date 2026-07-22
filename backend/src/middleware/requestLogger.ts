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
  let logged = false;

  const logOnce = (aborted: boolean): void => {
    if (logged) return;
    logged = true;

    const durationNs = process.hrtime.bigint() - startedAt;
    const durationMs = Number(durationNs) / 1_000_000;

    logger.info(
      {
        correlationId,
        route: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        aborted,
      },
      aborted ? "request aborted" : "request completed",
    );
  };

  res.on("finish", () => logOnce(false));
  // "finish" only fires when the full response was flushed to the client.
  // If the client disconnects mid-request, "finish" never comes and, without
  // this, the request would go completely unlogged. "close" fires in both
  // cases, so res.writableEnded (set the moment res.end() is called) is what
  // tells a normal completion apart from a premature disconnect.
  res.on("close", () => logOnce(!res.writableEnded));

  next();
}
