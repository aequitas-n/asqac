import { useId } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  Clock3,
  FlaskConical,
  HeartPulse,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { addDays, format, startOfDay } from 'date-fns';
import { useCapsule, useData } from '../../hooks/useData';
import { useAuth } from '../../hooks/useAuth';
import { useClock } from '../../hooks/useClock';
import { ago, number } from '../../lib/format';
import { withBarometry } from '../../lib/barometry';
import { liveReading } from '../../lib/telemetry';
import { Badge, Panel } from '../ui';
import { Gauge } from './Gauges';
import type { Transport } from '../../types';

export function OperationsBento() {
  const { transports, specimens, capsules, readings, audit } = useData();
  const { profile } = useAuth();
  const now = useClock(500);
  const pattern = useId().replaceAll(':', '');
  const active = transports
    .filter((t) => t.state === 'in_transit')
    .sort((a, b) => deadline(a) - deadline(b));
  const next = active[0];
  const nextSpecimen = specimens.find((s) => s.id === next?.specimen_id);
  const mostRecent = [...readings].sort(
    (a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at),
  )[0];
  const monitoredId = next?.capsule_id ?? mostRecent?.capsule_id ?? capsules[0]?.id;
  const monitored = useCapsule(monitoredId);
  const latest = next
    ? monitored.readings.filter((r) => r.transport_id === next.id).at(-1)
    : monitored.latest;
  const live = liveReading(latest, now);
  const fresh = !!live;
  const barometry = live ? withBarometry(live) : undefined;
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(startOfDay(new Date(now)), i - 6);
    const rows = transports.filter(
      (t) =>
        t.arrived_at && format(new Date(t.arrived_at), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd'),
    );
    return {
      label: format(day, 'EEE'),
      date: format(day, 'dd MMM'),
      count: rows.length,
      excursions: rows.filter((t) => t.excursion_count > 0).length,
    };
  });
  const max = Math.max(1, ...weekly.map((d) => d.count));
  const currentReadings = readings.filter((r) => active.some((t) => t.id === r.transport_id));
  const compliant = currentReadings.filter((r) => {
    const p = active.find((t) => t.id === r.transport_id)!.profile_snapshot;
    return r.temp_c >= p.temp_min_c && r.temp_c <= p.temp_max_c;
  }).length;
  const percent =
    fresh && currentReadings.length ? Math.round((compliant / currentReadings.length) * 100) : null;
  const recentActions = audit
    .filter((a) =>
      [
        'Specimen registered',
        'Transport started',
        'Transport received',
        'Final verdict recorded',
      ].includes(a.action),
    )
    .slice(0, 4);
  const itemRows = active.length
    ? active
    : capsules
        .slice(0, 4)
        .map((c) => ({ id: c.id, capsule_id: c.id, state: c.status, specimen_id: null }));
  return (
    <div className="operations-bento">
      <Panel
        title="Weekly transports"
        kicker="Last 7 days"
        className="weekly-card"
        action={
          <Link to="/reports" className="round-link" aria-label="View weekly transport reports">
            <ArrowUpRight size={17} />
          </Link>
        }
      >
        <div
          className="weekly-chart"
          role="img"
          aria-label={weekly
            .map((d) => `${d.date}: ${d.count} deliveries, ${d.excursions} with excursions`)
            .join('; ')}
        >
          {weekly.map((d, i) => (
            <div className="weekly-column" key={d.date}>
              <div className="bar-space">
                {d.count > 0 ? (
                  <div
                    className={`weekly-bar ${i === weekly.length - 1 ? 'today' : ''}`}
                    style={{ height: `${34 + (d.count / max) * 110}px` }}
                  >
                    <span>{d.count}</span>
                    {d.excursions > 0 && <i title={`${d.excursions} with excursions`} />}
                  </div>
                ) : (
                  <div className="weekly-bar no-data" title="No deliveries recorded">
                    <span>0</span>
                  </div>
                )}
              </div>
              <span className="bar-day">{d.label}</span>
            </div>
          ))}
        </div>
        <div className="weekly-legend">
          <span>
            <i />
            Deliveries
          </span>
          <span>
            <i className="hatch" />
            No deliveries
          </span>
          <span>
            <i className="excursion" />
            Excursion
          </span>
        </div>
      </Panel>
      <Panel
        title="Next arrival"
        kicker="Receiving desk"
        className="arrival-card"
        action={<Clock3 size={18} className="muted" />}
      >
        {next && nextSpecimen ? (
          <div className="arrival-content">
            <span className="eyebrow">{capsules.find((c) => c.id === next.capsule_id)?.code}</span>
            <h3>{nextSpecimen.destination_lab}</h3>
            <p className="mono">{nextSpecimen.specimen_code}</p>
            <div className="arrival-deadline">
              <span>Target arrival</span>
              <strong>
                {new Date(deadline(next)).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </strong>
              <small>
                {now > deadline(next)
                  ? 'Past handling time limit'
                  : `${Math.ceil((deadline(next) - now) / 60000)} min remaining`}
              </small>
            </div>
            <Link to={`/capsules/${next.capsule_id}`} className="button primary">
              Open capsule
              <ArrowUpRight size={16} />
            </Link>
          </div>
        ) : (
          <div className="arrival-content empty-arrival">
            <span className="arrival-icon">
              <Box size={31} strokeWidth={1.3} />
            </span>
            <h3>No incoming capsules</h3>
            <p>A target arrival appears when a transport starts.</p>
            <Link to="/capsules" className="text-link">
              View capsule fleet
              <ArrowRight size={15} />
            </Link>
          </div>
        )}
      </Panel>
      <Panel
        title={active.length ? 'Active transports' : 'Capsule availability'}
        className="active-list-card"
        action={
          <Link to="/capsules" className="button secondary small">
            View all
            <ArrowUpRight size={13} />
          </Link>
        }
      >
        <div className="active-transports">
          {itemRows.length ? (
            itemRows.slice(0, 4).map((t) => {
              const c = capsules.find((c) => c.id === t.capsule_id);
              const s = specimens.find((s) => s.id === t.specimen_id);
              const running = active.find((a) => a.id === t.id);
              return (
                <Link to={`/capsules/${c?.id}`} key={t.id}>
                  <span className={`specimen-type-icon type-${s?.specimen_type ?? 'idle'}`}>
                    {s?.specimen_type === 'BLOOD' ? (
                      <HeartPulse size={22} />
                    ) : s ? (
                      <FlaskConical size={22} />
                    ) : (
                      <Box size={22} />
                    )}
                  </span>
                  <div>
                    <strong>{s?.requested_test ?? c?.code}</strong>
                    <small>
                      {s?.destination_lab ??
                        (c?.id === monitoredId && latest
                          ? `${number(live?.temp_c)} °C · ${fresh ? 'Online' : 'Offline'}`
                          : 'Ready for assignment')}
                    </small>
                    {running && (
                      <span className="target-time">
                        Target{' '}
                        {new Date(deadline(running)).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                  <Badge value={running ? 'in_transit' : (c?.status ?? 'idle')} />
                </Link>
              );
            })
          ) : (
            <div className="list-empty">
              <Box size={25} />
              <p>
                Connect your project
                <br />
                to see capsule availability.
              </p>
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title="Recent staff actions"
        kicker="Chain of custody"
        className="staff-actions-card"
        action={
          <Link to="/reports" className="round-link" aria-label="View staff action records">
            <ArrowUpRight size={17} />
          </Link>
        }
      >
        <div className="staff-action-list">
          {recentActions.length ? (
            recentActions.map((a) => {
              const status =
                a.action === 'Specimen registered'
                  ? 'registered'
                  : a.action === 'Transport started'
                    ? 'in_transit'
                    : a.action === 'Transport received'
                      ? 'arrived'
                      : 'closed';
              return (
                <Link to={`/reports/${a.entity_id}`} key={a.id}>
                  <span className={`staff-avatar action-${status}`}>
                    {a.actor_label
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((s) => s[0])
                      .join('')}
                  </span>
                  <div>
                    <strong>{a.actor_label}</strong>
                    <small>
                      {a.action} · {ago(a.created_at)}
                    </small>
                  </div>
                  <Badge value={status} />
                </Link>
              );
            })
          ) : (
            <div className="list-empty">
              <ShieldCheck size={27} />
              <p>
                Registrations, handoffs, and verdicts
                <br />
                will appear in the custody record.
              </p>
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title={next ? 'Temperature compliance' : 'Capsule temperature'}
        kicker={
          next
            ? 'In-transit readings'
            : `${monitored.capsule?.code ?? 'Capsule'} · sensor telemetry`
        }
        className="compliance-card"
      >
        {!next ? (
          <>
            <Gauge
              label="Temperature"
              sensor="HW-611 / BMP280"
              unit="°C"
              value={live?.temp_c}
              min={-10}
              max={50}
            />
            <p className="compliance-note">
              {latest
                ? `${latest.simulated ? 'SIMULATED · ' : ''}${fresh ? 'Online · last packet' : 'Offline · last packet'} ${ago(latest.recorded_at)}. No active handling profile.`
                : 'Waiting for this capsule’s first sensor packet.'}
            </p>
          </>
        ) : (
          <>
            <div
              className="compliance-gauge"
              role="img"
              aria-label={
                percent === null
                  ? 'No in-transit telemetry available'
                  : `${percent}% of loaded in-transit temperature readings are within profile limits`
              }
            >
              <svg viewBox="0 0 240 150">
                <defs>
                  <pattern
                    id={`hatch-${pattern}`}
                    patternUnits="userSpaceOnUse"
                    width="7"
                    height="7"
                    patternTransform="rotate(40)"
                  >
                    <rect width="2" height="7" fill="#bccbc5" />
                  </pattern>
                </defs>
                <path
                  d="M28 124A92 92 0 0 1 212 124"
                  fill="none"
                  stroke={`url(#hatch-${pattern})`}
                  strokeWidth="28"
                  strokeLinecap="round"
                />
                {percent !== null && (
                  <path
                    d="M28 124A92 92 0 0 1 212 124"
                    pathLength="100"
                    fill="none"
                    stroke="#0e6e73"
                    strokeWidth="28"
                    strokeLinecap="round"
                    strokeDasharray={`${Math.max(0.01, percent)} 100`}
                  />
                )}
                <text x="120" y="113" textAnchor="middle" className="compliance-number">
                  {percent === null ? '—' : `${percent}%`}
                </text>
                <text x="120" y="139" textAnchor="middle" className="compliance-caption">
                  {percent === null
                    ? fresh
                      ? 'Awaiting telemetry'
                      : 'Offline'
                    : 'Within handling band'}
                </text>
              </svg>
            </div>
            <div className="compliance-legend">
              <span>
                <i />
                In range
              </span>
              <span>
                <i className="hatch" />
                {currentReadings.length ? 'Outside range' : 'No data'}
              </span>
            </div>
            <p className="compliance-note">
              {currentReadings.length
                ? `${compliant} of ${currentReadings.length} loaded readings in range.`
                : 'No compliance percentage without sensor readings.'}
            </p>
          </>
        )}
      </Panel>
      <Panel
        title={next ? 'Transport timer' : 'Capsule sensors'}
        className="timer-card"
        action={<Timer size={20} />}
      >
        <span className="timer-capsule">
          {next
            ? `${capsules.find((c) => c.id === next.capsule_id)?.code} · ${nextSpecimen?.specimen_type ?? 'Specimen'}`
            : `${monitored.capsule?.code ?? 'No capsule selected'} · ${latest ? (fresh ? 'Online' : 'Offline') : 'Awaiting telemetry'}`}
        </span>
        <div className="transport-clock">
          {next ? elapsed(now - Date.parse(next.started_at!)) : `${number(live?.temp_c)} °C`}
        </div>
        <span className="timer-limit">
          {next
            ? `Elapsed · ${next.profile_snapshot.max_transport_min} min handling limit`
            : 'No active transport · sensor monitoring only'}
        </span>
        <div className="timer-readings">
          <span>
            Temperature
            <strong>
              {number(live?.temp_c)} <small>°C</small>
            </strong>
          </span>
          <span>
            Impact peak
            <strong>
              {number(live?.shock_g, 2)} <small>g</small>
            </strong>
          </span>
        </div>
        {!next && (
          <div className="timer-readings">
            <span>
              Pressure
              <strong>
                {number(live?.pressure_hpa)} <small>hPa</small>
              </strong>
            </span>
            <span>
              Ambient light
              <strong>
                {number(live?.lux)} <small>lx</small>
              </strong>
            </span>
          </div>
        )}
        <div className="timer-readings">
          <span>
            Altitude estimate
            <strong>
              {number(barometry?.altitude_m)} <small>m</small>
            </strong>
          </span>
          <span>
            Height change
            <strong>
              {number(barometry?.height_change_m)} <small>m</small>
            </strong>
          </span>
        </div>
        <Link to={monitoredId ? `/capsules/${monitoredId}` : '/capsules'} className="timer-action">
          {next && (profile?.role === 'doctor' || profile?.role === 'admin')
            ? 'Receive capsule'
            : next
              ? 'Open transport'
              : monitoredId
                ? 'Open capsule sensors'
                : 'View capsule fleet'}
          <ArrowUpRight size={17} />
        </Link>
      </Panel>
    </div>
  );
}
function deadline(t: Transport) {
  return Date.parse(t.started_at!) + t.profile_snapshot.max_transport_min * 60000;
}
function elapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
