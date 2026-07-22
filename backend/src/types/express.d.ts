import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
    user?: { id: string; role: string };
  }
}
