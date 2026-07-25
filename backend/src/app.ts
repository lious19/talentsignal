import express, { type Express } from "express";
import cors from "cors";
import type { Pool } from "pg";
import { requestLogger } from "./middleware/requestLogger";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { hiddenDemandRouter } from "./routes/hiddenDemand";
import { clientsRouter } from "./routes/clients";
import { candidatesRouter } from "./routes/candidates";
import { jobOpeningsRouter } from "./routes/jobOpenings";
import { clientMatchmakingRouter } from "./routes/clientMatchmaking";
import type { MarketSignalProvider } from "./adapters/marketSignalProvider";

export function createApp(
  pool: Pool,
  marketSignalProvider: MarketSignalProvider,
  options?: { providerTimeoutMs?: number },
): Express {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
  app.use(requestLogger);
  app.use(express.json({ limit: "10kb" }));

  // Every route lives under /api. S-20 serves the built frontend with no
  // Vite dev server in front of it, so nothing can depend on the dev
  // proxy's path rewrite to make these paths line up.
  app.use("/api", healthRouter(pool));
  app.use("/api", authRouter(pool));
  app.use("/api", adminRouter(pool));
  app.use("/api", hiddenDemandRouter(pool, marketSignalProvider, options));
  app.use("/api", clientsRouter(pool));
  app.use("/api", candidatesRouter(pool));
  app.use("/api", jobOpeningsRouter(pool));
  app.use("/api", clientMatchmakingRouter(pool));

  return app;
}
