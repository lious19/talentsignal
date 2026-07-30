import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * TRUST (S-08, 06_decisions/013): append-only guarantees a written audit row
 * can't be altered afterward — it says nothing about whether the row was
 * ACCURATE when written. Two requests racing to enroll the SAME brand-new
 * client both find no existing sales_pipeline row to lock (SELECT ... FOR
 * UPDATE can't lock a row that doesn't exist), so without the advisory lock
 * in salesPipeline.ts, both could read priorStatus = null and the loser would
 * write an inaccurate "from_stage: null" audit row for a client that, by the
 * time it actually wrote, already had a real prior stage.
 *
 * A fake in-memory pool is single-threaded and cannot create this race at
 * all, so this needs two genuinely concurrent connections against a real
 * Postgres — gated on DATABASE_URL exactly like the append-only test, for
 * the same reason: this is a correctness guarantee, not a timing number.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb(
  "sales_pipeline concurrent enrollment (integration, requires DATABASE_URL)",
  () => {
    const schemaName = `test_pipeline_race_${randomUUID().replace(/-/g, "_")}`;
    const adminPool = new Pool({ connectionString: DATABASE_URL });
    let scopedPool: Pool;

    beforeAll(async () => {
      await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      scopedPool = new Pool({
        connectionString: DATABASE_URL,
        options: `-c search_path=${schemaName}`,
      });
      await runMigrations(scopedPool);
    });

    afterAll(async () => {
      await scopedPool.end();
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    });

    it("two concurrent enrollments of the same new client produce a coherent audit chain, not a duplicate", async () => {
      const { rows: clientRows } = await scopedPool.query(
        "INSERT INTO clients (name) VALUES ($1) RETURNING id",
        ["Beta Inc"],
      );
      const clientId = clientRows[0].id as string;

      const app = createApp(scopedPool, noopProvider);

      // Different target stages so a wrong ordering (e.g. both landing at
      // the same stage) can't accidentally hide the bug this test guards
      // against.
      const [resA, resB] = await Promise.all([
        request(app)
          .post("/api/sales-pipeline/update")
          .set("Authorization", salesAuthHeader())
          .send({ clientId, toStage: "prospecting" }),
        request(app)
          .post("/api/sales-pipeline/update")
          .set("Authorization", salesAuthHeader())
          .send({ clientId, toStage: "closed" }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const { rows: pipelineRows } = await scopedPool.query(
        "SELECT * FROM sales_pipeline WHERE client_id = $1",
        [clientId],
      );
      expect(pipelineRows).toHaveLength(1);

      const { rows: auditRows } = await scopedPool.query(
        "SELECT * FROM sales_pipeline_audit WHERE client_id = $1",
        [clientId],
      );
      // Exactly 2 — not a spurious 3rd from both requests believing they
      // were first. Ordering isn't asserted by timestamp (too fragile);
      // instead the chain is validated structurally: whichever row has
      // from_stage null is definitively first, and the other row's
      // from_stage must equal that first row's to_stage, regardless of
      // which request actually won the race.
      expect(auditRows).toHaveLength(2);

      const first = auditRows.find((row) => row.from_stage === null);
      const second = auditRows.find((row) => row.from_stage !== null);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second!.from_stage).toBe(first!.to_stage);
      expect(pipelineRows[0].status).toBe(second!.to_stage);
    });
  },
);
