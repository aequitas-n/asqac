import type { Alert, TelemetrySummary, Verdict } from '../types';
export function recommendVerdict(
  alerts: Alert[],
  summary: TelemetrySummary | null,
  excursionCount = 0,
  criticalCount = 0,
): Exclude<Verdict, 'pending'> {
  if (criticalCount || alerts.some((a) => a.severity === 'critical')) return 'reject';
  if (
    !summary?.count ||
    summary.simulated_count > 0 ||
    summary.gap_count ||
    alerts.length ||
    excursionCount
  )
    return 'review_required';
  return 'accept';
}
export function summaryFromReadings(
  rows: {
    temp_c: number;
    shock_g: number;
    lux: number;
    pitch_deg: number;
    roll_deg: number;
    simulated: boolean;
    recorded_at: string;
  }[],
): TelemetrySummary {
  const range = (values: number[], mode: 'min' | 'max') =>
    values.length ? Math[mode](...values) : null;
  return {
    count: rows.length,
    temp_min: range(
      rows.map((r) => r.temp_c),
      'min',
    ),
    temp_max: range(
      rows.map((r) => r.temp_c),
      'max',
    ),
    shock_max: range(
      rows.map((r) => r.shock_g),
      'max',
    ),
    light_max: range(
      rows.map((r) => r.lux),
      'max',
    ),
    tilt_max: range(
      rows.map((r) => Math.max(Math.abs(r.pitch_deg), Math.abs(r.roll_deg))),
      'max',
    ),
    simulated_count: rows.filter((r) => r.simulated).length,
    first_at: rows[0]?.recorded_at ?? null,
    last_at: rows.at(-1)?.recorded_at ?? null,
  };
}
