export class TelemetryUploadError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
interface UploadOptions {
  endpoint: string;
  token: string;
  readings: unknown[];
  signal?: AbortSignal;
  onRetry?: (delayMs: number) => void;
  fetcher?: typeof fetch;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
interface Result {
  reading_id?: number;
  transport_id?: string | null;
  rejected?: boolean;
  error?: string;
}
export async function uploadTelemetryBatch({
  endpoint,
  token,
  readings,
  signal,
  onRetry,
  fetcher = fetch,
  wait = pause,
}: UploadOptions): Promise<{ results: Result[] }> {
  const body = JSON.stringify({ readings }); // Retries preserve the original timestamps.
  for (let attempt = 0; attempt < 6; attempt++) {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 12000);
    let failure: unknown;
    let delay = Math.min(5000, 1000 * 2 ** attempt);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body,
        signal: controller.signal,
      });
      const result = (await response
        .json()
        .catch(() => ({ error: `Ingestion failed (${response.status})` }))) as {
        error?: string;
        retry_after_ms?: number;
        results?: Result[];
      } & Result;
      if (response.ok) {
        const rows = result.results ?? [result];
        if (rows.some((r) => r.rejected))
          throw new TelemetryUploadError(
            rows.find((r) => r.rejected)?.error || 'Transport already reviewed; reading rejected.',
            409,
          );
        return { results: rows };
      }
      if (response.status !== 429 && response.status < 500)
        throw new TelemetryUploadError(
          result.error || `Ingestion failed (${response.status})`,
          response.status,
        );
      failure = new TelemetryUploadError(
        result.error || `Ingestion failed (${response.status})`,
        response.status,
      );
      if (response.status === 429) {
        const suggested =
          result.retry_after_ms ?? Number(response.headers.get('Retry-After')) * 1000;
        delay =
          Number.isFinite(suggested) && suggested > 0
            ? Math.max(250, Math.min(10000, suggested))
            : 500;
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (
        error instanceof TelemetryUploadError &&
        error.status !== undefined &&
        error.status !== 429 &&
        error.status < 500
      )
        throw error;
      failure = error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
    if (attempt === 5) throw failure;
    delay += Math.floor(Math.random() * 100);
    onRetry?.(delay);
    await wait(delay, signal);
  }
  throw new Error('Telemetry could not be sent.');
}
