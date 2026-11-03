import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Clock3,
  Plus,
  Radio,
  ShieldCheck,
  Thermometer,
  Wifi,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useClock } from '../hooks/useClock';
import { ago, duration, number } from '../lib/format';
import { liveReading } from '../lib/telemetry';
import { Badge, Empty, PageTitle, Panel, Skeleton, Stat, TextLink } from '../components/ui';
import { Sparkline, TrendChart } from '../components/widgets/Charts';
import { OperationsBento } from '../components/widgets/Operations';
export default function Dashboard() {
  const data = useData();
  const { profile, preview } = useAuth();
  const now = useClock(500);
  const [selected, setSelected] = useState('');
  const { capsules, transports, readings, alerts, specimens, loading } = data;
  const active = transports.filter((t) => t.state === 'in_transit');
  const open = alerts.filter((a) => !a.acknowledged);
  const completed = transports.filter(
    (t) => t.state === 'closed' && t.closed_at && Date.parse(t.closed_at) > now - 7 * 86400000,
  );
  const times = completed
    .map((t) => duration(t.started_at, t.arrived_at))
    .filter((v): v is number => v !== null);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const risk = capsules.filter(
    (c) =>
      active.some((t) => t.capsule_id === c.id) &&
      (!c.last_seen_at || now - Date.parse(c.last_seen_at) > 120000),
  ).length;
  const capsule = capsules.find((c) => c.id === (selected || active[0]?.capsule_id)) ?? capsules[0];
  const transport = transports.find((t) => t.capsule_id === capsule?.id && t.state !== 'closed');
  const rows = readings
    .filter((r) => r.capsule_id === capsule?.id && (!transport || r.transport_id === transport.id))
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const latest = rows.at(-1);
  const live = liveReading(latest, now);
  const canRegister = preview || profile?.role === 'technician' || profile?.role === 'admin';
  const verifiedToday = transports.filter(
    (t) =>
      t.verdict === 'accept' &&
      t.verdict_at &&
      new Date(t.verdict_at).toDateString() === new Date(now).toDateString(),
  ).length;
  return (
    <>
      <PageTitle
        eyebrow="Workspace overview"
        title="Specimen overview"
        description="Monitor handling conditions, arrivals, and staff handoffs."
        action={
          <>
            <Link className="button secondary" to="/reports">
              View reports
              <ArrowUpRight size={16} />
            </Link>
            {canRegister ? (
              <Link className="button primary" to="/register">
                <Plus size={16} />
                Register specimen
              </Link>
            ) : (
              <Link className="button primary" to="/capsules">
                <Box size={16} />
                Incoming capsules
              </Link>
            )}
          </>
        }
      />
      {loading ? (
        <Skeleton />
      ) : (
        <>
          <div className="stats-grid">
            <Stat
              label="Capsules in transit"
              value={active.length}
              icon={Box}
              foot={`${capsules.length} capsules in your fleet`}
              href="/capsules"
            />
            <Stat
              label="Open alerts"
              value={open.length}
              icon={Bell}
              tone={open.some((a) => a.severity === 'critical') ? 'red' : 'amber'}
              foot={open.length ? 'Awaiting staff acknowledgement' : 'No unacknowledged excursions'}
              href="/alerts"
            />
            <Stat
              label="Avg. transport time"
              value={number(avg, 0)}
              suffix="min"
              icon={Clock3}
              tone="blue"
              foot="Completed journeys · last 7 days"
              href="/reports"
            />
            <Stat
              label="Verified today"
              value={verifiedToday}
              icon={CheckCircle2}
              foot="Accepted by the receiving doctor"
              href="/reports"
            />
          </div>
          <OperationsBento />
          <details className="dashboard-details">
            <summary>
              <div>
                <strong>Sensor trends & fleet details</strong>
                <span>
                  {capsules.length} capsules · {open.length} open alerts · Signal risk: {risk}
                </span>
              </div>
              <ChevronDown size={20} />
            </summary>
            <div className="dashboard-grid">
              <Panel
                className="temperature-panel"
                title="Capsule temperature"
                kicker="Live handling conditions"
                action={
                  <div className="chart-select">
                    <span className={live ? 'live-dot' : 'offline-dot'} />
                    <select
                      aria-label="Temperature chart capsule"
                      value={capsule?.id ?? ''}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      {!capsules.length && <option value="">No capsules connected</option>}
                      {capsules.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              >
                <div className="chart-overview">
                  <div>
                    <span className="chart-reading">
                      {number(live?.temp_c)}
                      <small>°C</small>
                    </span>
                    <span className="reading-label">
                      {live
                        ? 'Live temperature'
                        : latest
                          ? 'Offline · historical chart below'
                          : 'Waiting for first reading'}
                    </span>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i />
                      Temperature
                    </span>
                    {transport && (
                      <span>
                        <i className="band" />
                        {transport.profile_snapshot.temp_min_c}–
                        {transport.profile_snapshot.temp_max_c} °C target band
                      </span>
                    )}
                  </div>
                </div>
                <TrendChart readings={rows} profile={transport?.profile_snapshot} />
                <div className="panel-bottom">
                  <span>
                    <Thermometer size={13} /> HW-611 / BMP280
                  </span>
                  <span>
                    {latest
                      ? `${latest.simulated ? 'SIMULATED · ' : ''}Updated ${ago(latest.recorded_at)}`
                      : 'Actual readings appear after ingestion'}
                  </span>
                </div>
              </Panel>
              <Panel
                className="alert-feed"
                title="Open handling alerts"
                kicker="Excursion watch"
                action={<span className="count-pill">{open.length}</span>}
              >
                {open.length ? (
                  <div className="feed-list">
                    {open.slice(0, 4).map((a) => (
                      <Link
                        key={a.id}
                        to={`/capsules/${a.capsule_id}`}
                        className={`feed-item severity-${a.severity}`}
                      >
                        <span className="feed-icon">
                          <Bell size={16} />
                        </span>
                        <div>
                          <strong>{a.title}</strong>
                          <p>
                            {capsules.find((c) => c.id === a.capsule_id)?.code}{' '}
                            <span>· {ago(a.created_at)}</span>
                          </p>
                          <Badge value={a.severity} />
                        </div>
                        <ArrowUpRight size={15} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="calm-state">
                    <div className="calm-orbit">
                      <ShieldCheck size={34} />
                    </div>
                    <h3>No open alerts</h3>
                    <p>Handling excursions will appear here as your capsules report.</p>
                    <span>
                      <span className={live ? 'live-dot' : 'offline-dot'} /> CONTINUOUS OVERSIGHT
                    </span>
                  </div>
                )}
                <Link to="/alerts" className="panel-link">
                  View alert history
                  <ArrowRight size={15} />
                </Link>
              </Panel>
              <Panel
                className="fleet-panel"
                title="Capsule fleet"
                kicker="Current assignments"
                action={
                  <>
                    <span className="signal-risk">
                      <Wifi size={13} />
                      Signal risk: {risk}
                    </span>
                    <Link to="/capsules">
                      <TextLink>View fleet</TextLink>
                    </Link>
                  </>
                }
              >
                {capsules.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Capsule / specimen</th>
                          <th>Journey</th>
                          <th>Status</th>
                          <th>Temperature</th>
                          <th>Last seen</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {capsules.map((c) => {
                          const t = transports.find(
                            (t) => t.capsule_id === c.id && t.state !== 'closed',
                          );
                          const s = specimens.find((s) => s.id === t?.specimen_id);
                          const r = readings.filter((r) => r.capsule_id === c.id);
                          return (
                            <tr key={c.id}>
                              <td>
                                <Link className="table-id" to={`/capsules/${c.id}`}>
                                  <span className="capsule-mini">
                                    <Box size={17} />
                                  </span>
                                  <span>
                                    <strong>{c.code}</strong>
                                    <small>{s?.specimen_code ?? 'Ready for assignment'}</small>
                                  </span>
                                </Link>
                              </td>
                              <td>
                                <div className="route-cell">
                                  {s ? (
                                    <>
                                      <span>{s.origin}</span>
                                      <ArrowRight size={12} />
                                      <span>{s.destination_lab}</span>
                                    </>
                                  ) : (
                                    <span className="muted">No active journey</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <Badge value={c.status} />
                              </td>
                              <td>
                                <Sparkline readings={r} />
                              </td>
                              <td className="muted small">{ago(c.last_seen_at)}</td>
                              <td>
                                <Link
                                  className="icon-button"
                                  aria-label={`Open ${c.code}`}
                                  to={`/capsules/${c.id}`}
                                >
                                  <ArrowUpRight size={16} />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="Your connected fleet starts here"
                    description="Run the database migrations to provision CAP0001–CAP0004. Your capsules will appear automatically."
                    action={
                      <Link className="button secondary small" to="/setup">
                        Connection guide <ArrowUpRight size={14} />
                      </Link>
                    }
                  />
                )}
              </Panel>
              <Panel
                className="recent-panel"
                title="Recently registered"
                kicker="SPECIMEN DESK"
                action={<Activity size={17} className="muted" />}
              >
                {specimens.length ? (
                  <div className="specimen-list">
                    {specimens.slice(0, 4).map((s) => (
                      <div key={s.id}>
                        <span className="specimen-symbol">
                          <Radio size={17} />
                        </span>
                        <div>
                          <strong className="mono">{s.specimen_code}</strong>
                          <small>{s.requested_test}</small>
                        </div>
                        <Badge value={s.priority} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Ready for your first specimen"
                    description="Register an anonymised patient reference and bind a free capsule."
                    action={
                      canRegister ? (
                        <Link className="text-link" to="/register">
                          Open registration <ArrowRight size={14} />
                        </Link>
                      ) : undefined
                    }
                  />
                )}
                <div className="recent-note">
                  <ShieldCheck size={15} />
                  <span>Every registration creates a custody record.</span>
                </div>
              </Panel>
            </div>
          </details>
          <div className="overview-note">
            <ShieldCheck size={16} />
            <span>
              Quality recommendations support clinical review. The receiving doctor makes the final
              decision.
            </span>
            <Link to="/hardware">
              Explore the capsule
              <ArrowUpRight size={13} />
            </Link>
          </div>
        </>
      )}
    </>
  );
}
