import pino from "pino";

// Pino's default destination writes to fd 1 directly via its own internal
// stream (sonic-boom), bypassing process.stdout.write. Passing process.stdout
// explicitly routes writes through the normal Node stream instead, so tests
// can intercept process.stdout.write and assert on the JSON that comes out.
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    // Belt-and-suspenders: no route today logs req.body or a raw user/
    // candidate/client row, but this is the layer that survives someone
    // adding one later without thinking about it. Matches any field named
    // password/passwordHash/password_hash or contactInfo/contact_info at any
    // nesting depth. name is deliberately not here — S-05's PII registry
    // marks it non-display-redacted (candidates.name is visible to every
    // authenticated role already), so redacting it in logs specifically
    // would be inconsistent rather than extra safety. See 06_decisions/009.
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
        "contactInfo",
        "contact_info",
        "*.contactInfo",
        "*.contact_info",
        "*.*.contactInfo",
        "*.*.contact_info",
      ],
      censor: "[Redacted]",
    },
  },
  process.stdout,
);
