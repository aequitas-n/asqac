import type { Reading } from '../types';

// A missing heartbeat cannot identify a power cut immediately. This grace
// period accommodates the 10-second simulator and normal upload variation.
export const LIVE_PACKET_TIMEOUT_MS = 15_000;

export function liveReading<T extends Pick<Reading, 'recorded_at' | 'received_at'>>(
  reading: T | undefined,
  now: number,
): T | undefined {
  if (!reading) return undefined;
  // Repeated polling or replaying buffered history must not revive old values.
  const current = [reading.recorded_at, reading.received_at].every((stamp) => {
    const age = now - Date.parse(stamp);
    return Number.isFinite(age) && age >= -30_000 && age < LIVE_PACKET_TIMEOUT_MS;
  });
  return current ? reading : undefined;
}
