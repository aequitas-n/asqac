import type { Alert } from '../types';

// These fields are monotonic: acknowledgement, recovery and escalation cannot
// be undone by an older refresh snapshot arriving after a Realtime event.
export function mergeAlerts(incoming: Alert[], current: Alert[]): Alert[] {
  const rows = new Map<string, Alert>();
  for (const alert of [...incoming, ...current]) {
    const old = rows.get(alert.id);
    if (!old) {
      rows.set(alert.id, alert);
      continue;
    }
    const severe = old.severity === 'critical' || alert.severity === 'info' ? old : alert;
    const acknowledged = alert.acknowledged ? alert : old;
    rows.set(alert.id, {
      ...alert,
      severity: severe.severity,
      message: severe.message,
      acknowledged: old.acknowledged || alert.acknowledged,
      acknowledged_at: acknowledged.acknowledged_at,
      acknowledged_by: acknowledged.acknowledged_by,
      resolved_at: alert.resolved_at ?? old.resolved_at,
    });
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
