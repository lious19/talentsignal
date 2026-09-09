/**
 * A plain Promise.race timeout (hiddenDemand.ts's withTimeout() pattern)
 * lets a hung fetch keep running in the background even after the caller
 * gives up on it. For real outbound HTTP calls -- new in this codebase as
 * of S-21, every prior adapter was mocked -- that matters: AbortController
 * actually cancels the in-flight request at timeoutMs, per CLAUDE.md rule 8
 * ("explicit timeouts" means the call really stops, not just that the
 * caller stops waiting).
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  // S-24: optional so every existing GET-only call site (Greenhouse/Lever)
  // compiles and behaves exactly as before -- only the new capacity-signal
  // providers pass method/headers/body (a POST to USASpending).
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
