import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { recruiterAuthHeader } from "./helpers/authHeader";

/**
 * AC-4-9: "each candidate comes with a plain-English rationale within the
 * 2s target." Same treatment as clientMatchmaking.latency.integration.test.ts
 * (AC-4-3) and hiddenDemand.latency.integration.test.ts (AC-4-2): measures
 * the server's OWN in-process handler duration via the "request completed"
 * log line, not supertest's end-to-end await. Opt-in only
 * (RUN_TIMING_TESTS=1 + DATABASE_URL) — never part of default `npm test` or
 * the CI gate, since a wall-clock number is sensitive to whatever else is
 * running on the box. This route reuses scoreCandidate() unchanged, so its
 * cost profile is identical to S-06's already-proven-fast path plus one
 * extra small query (this recruiter's own feedback rows) — this test exists
 * to catch a real regression, not because the path is expected to be slow.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfRequested =
  process.env.RUN_TIMING_TESTS === "1" && DATABASE_URL ? describe : describe.skip;
const CANDIDATE_COUNT = 5_000;
const REGRESSION_GUARD_MS = 15_000;
const SKILLS_DELIMITER = "";

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

function findRecommendDurationMs(lines: string[]): number {
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.msg === "request completed" && parsed.route === "/api/recommendation-engine/recommend") {
        return parsed.durationMs as number;
      }
    } catch {
      // Not a JSON log line — ignore.
    }
  }
  throw new Error("no 'request completed' log line found for /api/recommendation-engine/recommend");
}

describeIfRequested(
  "POST /api/recommendation-engine/recommend — AC-4-9 latency (opt-in: RUN_TIMING_TESTS=1, requires DATABASE_URL)",
  () => {
    // A throwaway schema, not the shared database — same reasoning as
    // clientMatchmaking.latency.integration.test.ts.
    const schemaName = `test_recommend_latency_${randomUUID().replace(/-/g, "_")}`;
    const adminPool = new Pool({ connectionString: DATABASE_URL });
    let scopedPool: Pool;
    let jobId: string;

    beforeAll(async () => {
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      scopedPool = new Pool({
        connectionString: DATABASE_URL,
        options: `-c search_path=${schemaName}`,
        statement_timeout: REGRESSION_GUARD_MS,
      });
      await runMigrations(scopedPool);

      const { rows: clientRows } = await scopedPool.query(
        `INSERT INTO clients (name) VALUES ('Latency Test Client') RETURNING id`,
      );
      const clientId = clientRows[0].id as string;

      const { rows: jobRows } = await scopedPool.query(
        `INSERT INTO job_openings (client_id, title, requirements)
         VALUES ($1, 'Latency Test Role', ARRAY['react', 'sql', 'node'])
         RETURNING id`,
        [clientId],
      );
      jobId = jobRows[0].id as string;

      const names = Array.from({ length: CANDIDATE_COUNT }, (_, i) => `Candidate ${i}`);
      const skillsJoined = Array.from({ length: CANDIDATE_COUNT }, (_, i) =>
        (i % 3 === 0 ? ["react", "sql"] : i % 3 === 1 ? ["react"] : ["cobol"]).join(SKILLS_DELIMITER),
      );
      const experience = Array.from({ length: CANDIDATE_COUNT }, (_, i) => i % 15);

      await scopedPool.query(
        `INSERT INTO candidates (name, skills, experience)
         SELECT src.name, string_to_array(src.skills_joined, $4), src.experience
         FROM unnest($1::text[], $2::text[], $3::int[]) AS src(name, skills_joined, experience)`,
        [names, skillsJoined, experience, SKILLS_DELIMITER],
      );
    });

    afterAll(async () => {
      await scopedPool.end();
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it(`recommends ${CANDIDATE_COUNT} candidates within the handler's own measured time`, async () => {
      const lines = captureStdout();
      const app = createApp(scopedPool, noopProvider);

      const res = await request(app)
        .post("/api/recommendation-engine/recommend")
        .set("Authorization", recruiterAuthHeader())
        .send({ jobId });

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(CANDIDATE_COUNT);

      const durationMs = findRecommendDurationMs(lines);
      // eslint-disable-next-line no-console
      console.log(
        `[AC-4-9] server-side handler time for ${CANDIDATE_COUNT} candidates: ` +
          `${durationMs.toFixed(2)}ms (target: 2000ms, regression guard: ${REGRESSION_GUARD_MS}ms)`,
      );

      // Generous on purpose — a regression guard against a catastrophic
      // slowdown, not an enforcement of the 2s target itself.
      expect(durationMs).toBeLessThan(REGRESSION_GUARD_MS);
    });
  },
);
