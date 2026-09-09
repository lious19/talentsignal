import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { Pool } from "pg";
import { stream as exceljsStream, type Row } from "exceljs";
import type { CapacitySignal, FetchCapacitySignalsOptions, CapacitySignalProvider } from "./capacitySignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawCapacitySignal } from "../ingestion/rawCapacitySignals";
import { cheapNameMightMatch } from "./capacitySignalPrefilter";
import { logger } from "../logger";

const SOURCE = "h1b-lca";
// S-24 / Step 0: confirmed live, the most recent complete quarter as of this
// story (FY2026 Q2/Q3 not yet published under this naming pattern). A real
// quarter, not a cumulative-FYTD file -- 73MB, ~1.04M rows.
const LCA_FILE_URL = "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2026_Q1.xlsx";

const REQUIRED_COLUMNS = ["EMPLOYER_NAME", "JOB_TITLE", "SOC_CODE", "DECISION_DATE"] as const;

// S-24 / Step 0: confirmed real column headers in row 1 (EMPLOYER_NAME,
// JOB_TITLE, SOC_CODE, DECISION_DATE, ...) -- read dynamically instead of
// hardcoding positions, since DOL has changed column order across fiscal
// years before and a hardcoded index would silently misread the wrong
// column rather than fail loudly.
function buildHeaderIndex(headerRow: Row): Map<string, number> {
  const index = new Map<string, number>();
  const values = headerRow.values as unknown[];
  for (let i = 1; i < values.length; i++) {
    const name = values[i];
    if (typeof name === "string" && name.length > 0) index.set(name, i);
  }
  for (const required of REQUIRED_COLUMNS) {
    if (!index.has(required)) {
      throw new Error(`LCA file missing expected column "${required}" -- record layout may have changed`);
    }
  }
  return index;
}

function cellString(values: unknown[], index: number): string {
  const value = values[index];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function cellDate(values: unknown[], index: number): string | null {
  const value = values[index];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  return null;
}

async function downloadToTempFile(timeoutMs: number): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const res = await fetchWithTimeout(LCA_FILE_URL, timeoutMs);
  if (!res.ok || !res.body) {
    throw new Error(`LCA file download responded ${res.status}`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "ts-lca-"));
  const filePath = path.join(dir, "lca.xlsx");
  await finished(Readable.fromWeb(res.body as import("stream/web").ReadableStream).pipe(createWriteStream(filePath)));
  return { filePath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * S-24: H-1B LCA disclosure data -- the strongest of the three capacity
 * signals (role-specific via SOC_CODE/JOB_TITLE, legally binding), but also
 * the only one at a scale (73MB / ~1M rows per quarter) that rules out an
 * in-memory parse. Uses exceljs's streaming WorkbookReader, one row at a
 * time, never holding the whole workbook in memory.
 *
 * Deliberate, documented deviation from decision 040's "raw persisted before
 * parsing" discipline (06_decisions/047): at this row count, persisting
 * every row before filtering is impractical for an app whose only real use
 * is checking a handful of known company names. A cheap prefilter runs
 * DURING the stream; only rows that pass it get persisted. Rows that don't
 * match are read once and discarded, never written to raw_capacity_signals
 * or held collectively in memory.
 */
export class LcaProvider implements CapacitySignalProvider {
  constructor(
    private readonly pool: Pool,
    private readonly targetCompanyNames: string[],
  ) {}

  async fetchSignals(options: FetchCapacitySignalsOptions): Promise<CapacitySignal[]> {
    const runId = options.runId ?? randomUUID();
    const signals: CapacitySignal[] = [];

    let downloaded: { filePath: string; cleanup: () => Promise<void> };
    try {
      downloaded = await downloadToTempFile(options.timeoutMs);
    } catch (err) {
      logger.error({ source: SOURCE, err }, "LCA file download failed");
      return signals;
    }

    try {
      const reader = new exceljsStream.xlsx.WorkbookReader(downloaded.filePath, {});
      let headerIndex: Map<string, number> | undefined;

      for await (const worksheet of reader) {
        for await (const row of worksheet) {
          const values = row.values as unknown[];

          if (row.number === 1) {
            headerIndex = buildHeaderIndex(row);
            continue;
          }
          if (!headerIndex) continue; // defensive: never true given row 1 always runs first

          const employerName = cellString(values, headerIndex.get("EMPLOYER_NAME")!);
          if (!employerName || !cheapNameMightMatch(employerName, this.targetCompanyNames)) continue;

          const jobTitle = cellString(values, headerIndex.get("JOB_TITLE")!) || undefined;
          const socCode = cellString(values, headerIndex.get("SOC_CODE")!) || undefined;
          const eventDate = cellDate(values, headerIndex.get("DECISION_DATE")!);

          try {
            await persistRawCapacitySignal(
              this.pool,
              SOURCE,
              employerName,
              eventDate,
              jobTitle,
              socCode,
              { employerName, jobTitle, socCode, decisionDate: eventDate },
              200,
              runId,
            );
            signals.push({ source: SOURCE, employerNameRaw: employerName, eventDate, roleTitle: jobTitle, socCode });
          } catch (err) {
            logger.error({ source: SOURCE, employerName, err }, "LCA row persist failed; row skipped");
          }
        }
      }
    } catch (err) {
      logger.error({ source: SOURCE, err }, "LCA file parse failed");
    } finally {
      await downloaded.cleanup();
    }

    return signals;
  }
}
