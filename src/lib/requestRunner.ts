interface Handlers<T> {
  success: (value: T) => void;
  failure: (error: unknown) => void;
  settled?: () => void;
}

// One request at a time. A stalled SDK/auth/network promise cannot hold the UI
// indefinitely, and a cancelled account's late response cannot update it.
export function createRequestRunner<T>(
  load: (signal: AbortSignal) => PromiseLike<T>,
  handlers: Handlers<T>,
  timeoutMs = 12_000,
) {
  let current: { controller: AbortController; promise: Promise<void> } | null = null;
  return {
    get pending() {
      return current !== null;
    },
    run(): Promise<void> {
      if (current) return current.promise;
      const request = { controller: new AbortController(), promise: Promise.resolve() };
      current = request;
      request.promise = Promise.resolve().then(async () => {
        const signal = request.controller.signal;
        let rejectAbort: (reason: unknown) => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
          rejectAbort = reject;
        });
        const onAbort = () => rejectAbort(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        const timer = setTimeout(
          () => request.controller.abort(new Error('Connection timed out. Please retry.')),
          timeoutMs,
        );
        try {
          const value = await Promise.race([
            signal.aborted ? aborted : Promise.resolve().then(() => load(signal)),
            aborted,
          ]);
          if (current === request) handlers.success(value);
        } catch (error) {
          if (current === request) handlers.failure(error);
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          if (current === request) {
            current = null;
            handlers.settled?.();
          }
        }
      });
      return request.promise;
    },
    cancel() {
      const request = current;
      current = null;
      request?.controller.abort(new DOMException('Request cancelled', 'AbortError'));
    },
  };
}
