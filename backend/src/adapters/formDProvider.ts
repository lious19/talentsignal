import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import unzipper from "unzipper";
import type { CapacitySignal, FetchCapacitySignalsOptions, CapacitySignalProvider } from "./capacitySignalProvider";
import { fetchWithTimeout } from "../ingestion/fetchWithTimeout";
import { persistRawCapacitySignal } from "../ingestion/rawCapacitySignals";
import { cheapNameMightMatch } from "./capacitySignalPrefilter";
import { logger } from "../logger";

const SOURCE = "form-d";
// S-24 / Step 0: confirmed live quarterly zip -- 6 flattened TSV files
// extracted from Form D's XML (not XML itself), ~3.6MB. SEC's fair-access
// policy requires a descriptive User-Agent on every sec.gov/data.sec.gov
// request.
const FORM_D_ZIP_URL = "https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip";
const USER_AGENT = "TalentSignal capacity-signal research contact:meganmbenoun17@gmail.com";

interface IssuerRow {
  accessionNumber: string;
  entityName: string;
}

interface OfferingRow {
  accessionNumber: string;
  saleDate: string | null;
  yetToOccur: boolean;
}

function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? "";
    });
    return row;
  });
}

async function readEntryFromZip(zipBuffer: Buffer, entrySuffix: string): Promise<string> {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const entry = directory.files.find((f) => f.path.endsWith(entrySuffix));
  if (!entry) {
    throw new Error(`form-d zip missing expected entry ending in "${entrySuffix}"`);
  }
  const buf = await entry.buffer();
  return buf.toString("utf-8");
}

/**
 * S-24: SEC Form D as a capacity signal -- company-level only, no occupation
 * data at all (06_decisions/047), sourceStrength 0.5, the weakest of the
 * three. Confirmed real field names in Step 0: ISSUERS.tsv's ENTITYNAME
 * (issuer legal name) and OFFERING.tsv's SALE_DATE (not "dateOfFirstSale"),
 * joined by ACCESSIONNUMBER.
 */
export class FormDProvider implements CapacitySignalProvider {
  constructor(
    private readonly pool: Pool,
    private readonly targetCompanyNames: string[],
  ) {}

  async fetchSignals(options: FetchCapacitySignalsOptions): Promise<CapacitySignal[]> {
    const runId = options.runId ?? randomUUID();
    const signals: CapacitySignal[] = [];

    let zipBuffer: Buffer;
    try {
      const res = await fetchWithTimeout(FORM_D_ZIP_URL, options.timeoutMs, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        throw new Error(`form-d zip download responded ${res.status}`);
      }
      zipBuffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      logger.error({ source: SOURCE, err }, "form-d zip download failed");
      return signals;
    }

    let issuerRows: IssuerRow[];
    let offeringByAccession: Map<string, OfferingRow>;
    try {
      const issuersText = await readEntryFromZip(zipBuffer, "ISSUERS.tsv");
      const offeringText = await readEntryFromZip(zipBuffer, "OFFERING.tsv");

      issuerRows = parseTsv(issuersText).map((row) => ({
        accessionNumber: row.ACCESSIONNUMBER,
        entityName: row.ENTITYNAME,
      }));
      offeringByAccession = new Map(
        parseTsv(offeringText).map((row) => [
          row.ACCESSIONNUMBER,
          {
            accessionNumber: row.ACCESSIONNUMBER,
            saleDate: row.SALE_DATE || null,
            yetToOccur: row.YETTOOCCUR === "1" || row.YETTOOCCUR?.toLowerCase() === "true",
          },
        ]),
      );
    } catch (err) {
      logger.error({ source: SOURCE, err }, "form-d zip parse failed");
      return signals;
    }

    for (const issuer of issuerRows) {
      if (!issuer.entityName || !cheapNameMightMatch(issuer.entityName, this.targetCompanyNames)) continue;

      const offering = offeringByAccession.get(issuer.accessionNumber);
      const eventDate = offering && !offering.yetToOccur ? offering.saleDate : null;

      try {
        await persistRawCapacitySignal(
          this.pool,
          SOURCE,
          issuer.entityName,
          eventDate,
          undefined,
          undefined,
          { issuer, offering },
          200,
          runId,
        );
        signals.push({ source: SOURCE, employerNameRaw: issuer.entityName, eventDate });
      } catch (err) {
        logger.error(
          { source: SOURCE, entityName: issuer.entityName, err },
          "form-d row persist failed; row skipped",
        );
      }
    }

    return signals;
  }
}
