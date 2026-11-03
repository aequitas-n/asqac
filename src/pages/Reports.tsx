import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Download,
  FileBarChart2,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { addDays, format, startOfDay } from 'date-fns';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { useData } from '../hooks/useData';
import { dateTime, downloadCsv, duration, number } from '../lib/format';
import { fetchAll } from '../lib/queries';
import { Badge, Empty, PageTitle, Panel, Skeleton, Stat } from '../components/ui';
import { DeliveryChart } from '../components/widgets/Charts';
import type { AuditEntry, Transport } from '../types';
export default function Reports() {
  const { specimens, capsules, transports: recent, audit, loading } = useData();
  const reduce = useReducedMotion();
  const [days, setDays] = useState(7);
  const [transports, setTransports] = useState<Transport[]>([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const reportVersion = recent
    .map((t) => `${t.id}:${t.state}:${t.verdict}:${t.excursion_count}`)
    .join('|');
  useEffect(() => {
    let live = true;
    setBusy(true);
    fetchAll<Transport>('transports', {
      column: 'created_at',
      value: startOfDay(addDays(new Date(), -days + 1)).toISOString(),
      operator: 'gte',
    })
      .then((rows) => {
        if (live) {
          setTransports(rows);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [days, reportVersion]);
  const closed = transports.filter((t) => t.state === 'closed');
  const excursions = closed.filter((t) => t.excursion_count > 0).length;
  const durations = closed
    .map((t) => duration(t.started_at, t.arrived_at))
    .filter((n): n is number => n !== null);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const mix = [
    {
      name: 'Accept',
      value: closed.filter((t) => t.verdict === 'accept').length,
      color: '#2e8d71',
    },
    {
      name: 'Review required',
      value: closed.filter((t) => t.verdict === 'review_required').length,
      color: '#d09b46',
    },
    {
      name: 'Reject',
      value: closed.filter((t) => t.verdict === 'reject').length,
      color: '#cf6968',
    },
  ];
  const chart = useMemo(
    () =>
      Array.from({ length: days }, (_, i) => {
        const date = addDays(startOfDay(new Date()), i - days + 1);
        const rows = closed.filter(
          (t) =>
            t.arrived_at &&
            format(new Date(t.arrived_at), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'),
        );
        return {
          day: format(date, 'dd MMM'),
          deliveries: rows.length,
          excursions: rows.reduce((s, t) => s + t.excursion_count, 0),
        };
      }),
    [days, closed],
  );
  const filtered = transports.filter((t) => {
    const s = specimens.find((s) => s.id === t.specimen_id);
    return `${t.transport_code} ${s?.specimen_code ?? ''} ${s?.patient_ref ?? ''} ${capsules.find((c) => c.id === t.capsule_id)?.code ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  async function exportAudit() {
    setExporting(true);
    try {
      const rows = await fetchAll<AuditEntry>('audit_log', {
        column: 'created_at',
        value: startOfDay(addDays(new Date(), -days + 1)).toISOString(),
        operator: 'gte',
      });
      if (!rows.length) {
        toast.info('No audit records in this date range.');
        return;
      }
      downloadCsv(
        `ASQAC-custody-${format(new Date(), 'yyyyMMdd')}.csv`,
        rows.map((r) => ({
          timestamp: r.created_at,
          actor: r.actor_label,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          detail: r.detail,
        })),
      );
      toast.success(`${rows.length} audit records exported`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="RECORDS / QUALITY INTELLIGENCE"
        title="Transport reports"
        description="Delivery performance, receiving decisions, and the chain of custody."
        action={
          <>
            <select
              aria-label="Reporting period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
            <button
              className="button secondary"
              disabled={exporting}
              onClick={() => void exportAudit()}
            >
              <Download size={16} />
              {exporting ? 'Exporting…' : 'Export custody CSV'}
            </button>
          </>
        }
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading || busy ? (
        <Skeleton />
      ) : (
        <>
          <div className="stats-grid">
            <Stat
              label="Completed deliveries"
              value={closed.length.toString().padStart(2, '0')}
              icon={CheckCircle2}
              foot={`Created in the last ${days} days`}
            />
            <Stat
              label="Journeys with excursions"
              value={closed.length ? Math.round((excursions / closed.length) * 100) : '—'}
              suffix="%"
              icon={TriangleAlert}
              foot={`${excursions} of ${closed.length} completed journeys`}
              tone="amber"
            />
            <Stat
              label="Avg. transit time"
              value={number(avg, 0)}
              suffix="min"
              icon={Clock3}
              foot="Start to receiving handoff"
              tone="blue"
            />
            <Stat
              label="Accepted specimens"
              value={mix[0].value.toString().padStart(2, '0')}
              icon={ShieldCheck}
              foot="Final doctor dispositions"
            />
          </div>
          <div className="reports-charts">
            <Panel title="Deliveries & handling excursions" kicker="TRANSPORT PERFORMANCE">
              {closed.length ? (
                <DeliveryChart data={chart} />
              ) : (
                <Empty
                  title="Your first delivery starts the story"
                  description="Completed transports will build your quality history automatically."
                />
              )}
            </Panel>
            <Panel title="Verdict mix" kicker="VERDICT MIX">
              <div className="verdict-chart">
                {closed.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={185}>
                      <PieChart>
                        <Pie
                          data={mix}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={78}
                          paddingAngle={5}
                          stroke="none"
                          isAnimationActive={!reduce}
                        >
                          {mix.map((m) => (
                            <Cell key={m.name} fill={m.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: '#12202c',
                            border: '1px solid #30404c',
                            borderRadius: 10,
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="verdict-legend">
                      {mix.map((m) => (
                        <div key={m.name}>
                          <i style={{ background: m.color }} />
                          {m.name}
                          <strong>{m.value}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <Empty
                    title="Awaiting a clinical verdict"
                    description="Receiving doctors close each journey with a disposition."
                  />
                )}
              </div>
            </Panel>
          </div>
          <Panel
            title="Transport register"
            kicker="TRANSPORT REGISTER"
            action={
              <label className="search-box">
                <Search size={15} />
                <input
                  aria-label="Search transport reports"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Transport, capsule or specimen…"
                />
              </label>
            }
          >
            {filtered.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Transport / specimen</th>
                      <th>Capsule</th>
                      <th>State</th>
                      <th>Transit time</th>
                      <th>Excursions</th>
                      <th>Final verdict</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link className="table-id" to={`/reports/${t.id}`}>
                            <FileBarChart2 size={17} />
                            <span>
                              <strong className="mono">{t.transport_code}</strong>
                              <small>
                                {specimens.find((s) => s.id === t.specimen_id)?.specimen_code ??
                                  t.specimen_id.slice(0, 8)}
                              </small>
                            </span>
                          </Link>
                        </td>
                        <td className="mono">
                          {capsules.find((c) => c.id === t.capsule_id)?.code}
                        </td>
                        <td>
                          <Badge value={t.state} />
                        </td>
                        <td>{number(duration(t.started_at, t.arrived_at), 0)} min</td>
                        <td>{t.excursion_count}</td>
                        <td>
                          <Badge value={t.verdict} />
                        </td>
                        <td>
                          <Link
                            to={`/reports/${t.id}`}
                            className="icon-button"
                            aria-label={`Open ${t.transport_code} report`}
                          >
                            <ArrowUpRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="No matching transport records"
                description="Try a different search or create and complete a specimen journey."
              />
            )}
          </Panel>
          <Panel
            title="The chain of custody"
            kicker="AUDIT / LATEST 500 RECORDS"
            className="audit-panel"
            action={
              <label className="search-box">
                <Search size={15} />
                <input
                  aria-label="Search custody records"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search actor or action…"
                />
              </label>
            }
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Recorded at</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {audit
                    .filter((r) =>
                      `${r.actor_label} ${r.action} ${r.entity_id}`
                        .toLowerCase()
                        .includes(auditSearch.toLowerCase()),
                    )
                    .slice(0, 50)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className="mono small">{dateTime(r.created_at)}</td>
                        <td>{r.actor_label}</td>
                        <td>{r.action}</td>
                        <td>
                          <Link to={`/reports/${r.entity_id}`} className="text-link mono small">
                            {r.entity_id.slice(0, 8)}
                            <ArrowUpRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!audit.length && (
                <Empty
                  title="No custody entries yet"
                  description="Registration, preparation, transport, alerts and verdicts all leave a timestamped record."
                />
              )}
            </div>
          </Panel>
          <div className="overview-note">
            <ShieldCheck size={16} />
            <span>
              The table shows up to 50 matching audit entries. CSV exports all records in the
              selected period. Synthetic seed records are labelled in their actor and notes.
            </span>
          </div>
        </>
      )}
    </>
  );
}
