import express, { type Express } from "express";
import cors from "cors";
import type { Pool } from "pg";
import { requestLogger } from "./middleware/requestLogger";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";

export function createApp(pool: Pool): Express {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
  app.use(requestLogger);
  app.use(express.json({ limit: "10kb" }));
  app.use(healthRouter(pool));
  app.use(authRouter(pool));

  return app;
}
