import pino from "pino";

// Pino's default destination writes to fd 1 directly via its own internal
// stream (sonic-boom), bypassing process.stdout.write. Passing process.stdout
// explicitly routes writes through the normal Node stream instead, so tests
// can intercept process.stdout.write and assert on the JSON that comes out.
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    // Belt-and-suspenders: no route today logs req.body or a raw user row,
    // but this is the layer that survives someone adding one later without
    // thinking about auth. Matches any field named password/passwordHash/
    // password_hash at any nesting depth.
    redact: {
      paths: [
        "password",
        "passwordHash",
        "password_hash",
        "*.password",
        "*.passwordHash",
        "*.password_hash",
        "*.*.password",
        "*.*.passwordHash",
        "*.*.password_hash",
      ],
      censor: "[Redacted]",
    },
  },
  process.stdout,
);
