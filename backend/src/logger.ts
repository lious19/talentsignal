import pino from "pino";

// Pino's default destination writes to fd 1 directly via its own internal
// stream (sonic-boom), bypassing process.stdout.write. Passing process.stdout
// explicitly routes writes through the normal Node stream instead, so tests
// can intercept process.stdout.write and assert on the JSON that comes out.
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  process.stdout,
);
