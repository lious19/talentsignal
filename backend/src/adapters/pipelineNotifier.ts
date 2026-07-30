import { logger } from "../logger";

export interface PipelineStageChangedEvent {
  clientId: string;
  fromStage: string | null;
  toStage: string;
  changedBy: string;
}

/**
 * Implemented by every notification sink, internal-only today or real later.
 * Callers (the sales-pipeline route) depend only on this interface —
 * server.ts is the one place that decides which concrete notifier gets
 * constructed, so swapping this for a real outbound-capable implementation
 * behind S-09's human-release gate means changing one wiring line, not the
 * route or any test that uses a fake notifier. Same seam shape as
 * MarketSignalProvider.
 */
export interface PipelineNotifier {
  notifyStageChanged(event: PipelineStageChangedEvent): Promise<void>;
}

/**
 * Today's only implementation: fires internally as a structured log line and
 * nothing else. No fetch/http(s)/CRM SDK reference anywhere in this file —
 * proven by salesPipeline.noOutbound.trust.test.ts. "Notifications fire but
 * never leave the platform without a human" (S-08's trust scenario) stops
 * exactly here until S-09 adds a real, human-gated outbound sink.
 */
export class LoggingPipelineNotifier implements PipelineNotifier {
  async notifyStageChanged(event: PipelineStageChangedEvent): Promise<void> {
    logger.info({ event }, "PipelineStageChanged (internal only — no outbound delivery; see S-09)");
  }
}
