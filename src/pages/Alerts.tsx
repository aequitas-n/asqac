import { useState } from 'react';
import { ArrowUpRight, Bell, Check, CheckCheck, Filter, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useData } from '../hooks/useData';
import { rpc } from '../lib/supabase';
import { ago, dateTime, humanize } from '../lib/format';
import { Badge, Empty, PageTitle, Skeleton } from '../components/ui';
export default function Alerts() {
  const { alerts, capsules, transports, refresh, loading } = useData();
  const [severity, setSeverity] = useState('all');
  const [type, setType] = useState('all');
  const [only, setOnly] = useState(true);
  const [group, setGroup] = useState('capsule');
  const [busy, setBusy] = useState('');
  const openCount = alerts.filter((a) => !a.acknowledged).length;
  const filtered = alerts.filter(
    (a) =>
      (severity === 'all' || a.severity === severity) &&
      (type === 'all' || a.alert_type === type) &&
      (!only || !a.acknowledged),
  );
  const grouped = filtered.reduce<Record<string, typeof alerts>>((map, a) => {
    const key = group === 'capsule' ? a.capsule_id : a.transport_id;
    (map[key] ??= []).push(a);
    return map;
  }, {});
  async function acknowledge(id: string) {
    setBusy(id);
    try {
      await rpc('acknowledge_alert', { p_alert: id });
      await refresh();
      toast.success('Acknowledgement added to the custody record.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to acknowledge');
    } finally {
      setBusy('');
    }
  }
  async function acknowledgeAll() {
    setBusy('all');
    try {
      const count = await rpc<number>('acknowledge_all_alerts');
      await refresh();
      toast.success(
        count
          ? `${count} alert${count === 1 ? '' : 's'} acknowledged and added to the custody record.`
          : 'All alerts are already acknowledged.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to acknowledge all alerts');
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="QUALITY ASSURANCE / EVENT CENTRE"
        title="Handling alerts"
        description="Review handling excursions and record the staff response."
        action={
          <button
            className="button primary"
            disabled={loading || !!busy || openCount === 0}
            aria-busy={busy === 'all'}
            title="Acknowledge every unacknowledged alert across all filters. Each event remains in the audit history."
            onClick={() => void acknowledgeAll()}
          >
            <CheckCheck size={17} />
            {busy === 'all' ? 'Acknowledging…' : `Acknowledge all (${openCount})`}
          </button>
        }
      />
      <div className="alert-summary">
        <div>
          <span className="severity-orb critical" />
          <strong>
            {alerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length}
          </strong>
          <span>Critical / open</span>
        </div>
        <div>
          <span className="severity-orb warning" />
          <strong>
            {alerts.filter((a) => a.severity === 'warning' && !a.acknowledged).length}
          </strong>
          <span>Warnings / open</span>
        </div>
        <div>
          <CheckCheck size={18} className="accent" />
          <strong>{alerts.filter((a) => a.acknowledged).length}</strong>
          <span>Acknowledged / loaded history</span>
        </div>
      </div>
      <div className="alert-toolbar">
        <Filter size={16} />
        <select
          aria-label="Filter by severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          {['all', 'critical', 'warning', 'info'].map((v) => (
            <option key={v} value={v}>
              {v === 'all' ? 'All severities' : humanize(v)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by alert type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {[
            'all',
            'temperature',
            'shock',
            'tilt',
            'light',
            'pressure',
            'delay',
            'connectivity',
          ].map((v) => (
            <option key={v} value={v}>
              {v === 'all' ? 'All event types' : humanize(v)}
            </option>
          ))}
        </select>
        <select aria-label="Group alerts" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="capsule">Group by capsule</option>
          <option value="transport">Group by transport</option>
        </select>
        <label className="inline-check">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          Unacknowledged only
        </label>
      </div>
      {loading ? (
        <Skeleton />
      ) : filtered.length ? (
        <div className="alert-groups">
          {Object.entries(grouped).map(([key, rows]) => (
            <section key={key} className="panel alert-group">
              <div className="panel-head">
                <h2 className="mono">
                  {group === 'capsule'
                    ? capsules.find((c) => c.id === key)?.code
                    : transports.find((t) => t.id === key)?.transport_code}
                </h2>
                <span className="muted small">
                  {rows.length} event{rows.length === 1 ? '' : 's'}
                </span>
              </div>
              {rows.map((a) => (
                <article className={`alert-row severity-${a.severity}`} key={a.id}>
                  <span className="alert-type-icon">
                    <Bell size={20} />
                  </span>
                  <div className="alert-row-content">
                    <div className="alert-title">
                      <h3>{a.title}</h3>
                      <Badge value={a.severity} />
                      <span className="type-label">{humanize(a.alert_type)}</span>
                    </div>
                    <p>{a.message}</p>
                    <div className="alert-meta">
                      <Link to={`/capsules/${a.capsule_id}`}>
                        {capsules.find((c) => c.id === a.capsule_id)?.code}
                        <ArrowUpRight size={12} />
                      </Link>
                      <time title={dateTime(a.created_at)}>{ago(a.created_at)}</time>
                      <span>{a.resolved_at ? 'Condition recovered' : 'Condition active'}</span>
                      {a.acknowledged_at && <span>Acknowledged {ago(a.acknowledged_at)}</span>}
                    </div>
                  </div>
                  {a.acknowledged ? (
                    <span className="acknowledged">
                      <CheckCheck size={16} />
                      Acknowledged
                    </span>
                  ) : (
                    <button
                      className="button secondary small"
                      disabled={!!busy}
                      onClick={() => void acknowledge(a.id)}
                    >
                      <Check size={15} />
                      {busy === a.id ? 'Saving…' : 'Acknowledge'}
                    </button>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="A clear event desk"
            description="No events match these filters. Excursions will appear as capsules report outside their handling limits."
          />
        </div>
      )}
      <div className="overview-note">
        <ShieldCheck size={17} />
        <span>
          Acknowledging an event records your response; the original event remains available for
          audit. Showing the latest 1,000 events.
        </span>
      </div>
    </>
  );
}
