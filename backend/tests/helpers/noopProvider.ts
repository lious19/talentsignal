import type { MarketSignalProvider } from "../../src/adapters/marketSignalProvider";

/**
 * A MarketSignalProvider stand-in for tests that build an app to exercise
 * something other than hidden-demand (health, auth, logging) — createApp
 * needs a provider, but these tests never call the analyze endpoint.
 */
export const noopProvider: MarketSignalProvider = {
  async fetchSignals() {
    return [];
  },
};
