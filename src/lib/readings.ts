import type { Reading } from '../types';

// Keep delayed query snapshots from replacing newer Realtime observations.
// One sort and one pass also avoid scanning the entire fleet for every row.
export function mergeReadings(...groups: ReadonlyArray<ReadonlyArray<Reading>>): Reading[] {
  const byId = new Map(groups.flatMap((rows) => rows.map((row) => [row.id, row] as const)));
  const counts = new Map<string, number>();
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at) || b.id - a.id)
    .filter((row) => {
      const count = counts.get(row.capsule_id) ?? 0;
      counts.set(row.capsule_id, count + 1);
      return count < 180;
    })
    .reverse();
}
