import type { Reading } from '../types';
export const STANDARD_SEA_LEVEL_HPA = 1013.25;
export function pressureAltitude(
  pressure: number,
  reference = STANDARD_SEA_LEVEL_HPA,
): number | null {
  if (!Number.isFinite(pressure) || !Number.isFinite(reference) || pressure <= 0 || reference <= 0)
    return null;
  return 44330 * (1 - Math.pow(pressure / reference, 0.1903));
}
// Server-generated values are authoritative; fallback supports old telemetry
// fixtures while never fabricating a missing startup height reference.
export function withBarometry(reading: Reading) {
  const p0 = reading.sea_level_pressure_hpa ?? STANDARD_SEA_LEVEL_HPA;
  return {
    ...reading,
    sea_level_pressure_hpa: p0,
    altitude_m: reading.altitude_m ?? pressureAltitude(reading.pressure_hpa, p0),
    height_change_m:
      reading.height_change_m ??
      (reading.reference_pressure_hpa && reading.height_reference_at
        ? pressureAltitude(reading.pressure_hpa, reading.reference_pressure_hpa)
        : null),
  };
}
