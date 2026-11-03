import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Box, Clock3, Plus, Radio, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useClock } from '../hooks/useClock';
import { liveReading } from '../lib/telemetry';
import { ago, humanize, number } from '../lib/format';
import { Badge, Empty, PageTitle, Skeleton } from '../components/ui';
import { Sparkline } from '../components/widgets/Charts';
export default function Capsules() {
  const { capsules, specimens, transports, readings, loading } = useData();
  const { profile } = useAuth();
  const now = useClock(500);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const statuses = [
    'all',
    'in_transit',
    'prepared',
    'arrived',
    'alert',
    'charging',
    'idle',
    'maintenance',
  ];
  const filtered = capsules.filter(
    (c) =>
      (filter === 'all' || c.status === filter) &&
      `${c.code} ${c.label}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="FLEET / CAPSULE MONITORING"
        title="Capsule fleet"
        description="Prepare, track, and receive your specimen capsules."
        action={
          (profile?.role === 'technician' || profile?.role === 'admin') && (
            <Link className="button primary" to="/register">
              <Plus size={16} />
              Assign a specimen
            </Link>
          )
        }
      />
      <div className="fleet-toolbar">
        <div className="filter-chips" aria-label="Fleet status">
          {statuses.map((s) => (
            <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {humanize(s)}
              <span>
                {s === 'all' ? capsules.length : capsules.filter((c) => c.status === s).length}
              </span>
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search capsules"
            placeholder="Find a capsule…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {loading ? (
        <Skeleton />
      ) : filtered.length ? (
        <div className="fleet-grid">
          {filtered.map((c) => {
            const t = transports.find((t) => t.capsule_id === c.id && t.state !== 'closed');
            const s = specimens.find((s) => s.id === t?.specimen_id);
            const rows = readings
              .filter((r) => r.capsule_id === c.id)
              .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
            const live = liveReading(rows.at(-1), now);
            return (
              <Link className="fleet-card panel" key={c.id} to={`/capsules/${c.id}`}>
                <div className="fleet-card-head">
                  <span className="eyebrow">ASQAC / SMART CAPSULE</span>
                  <ArrowUpRight size={18} />
                </div>
                <div className="fleet-identity">
                  <span className="fleet-box">
                    <Box size={35} strokeWidth={1} />
                  </span>
                  <div>
                    <h2 className="mono">{c.code}</h2>
                    <span className="muted small">{c.label}</span>
                  </div>
                  <Badge value={c.status} />
                </div>
                <div className="fleet-assignment">
                  <span className="eyebrow">{s ? 'ASSIGNED SPECIMEN' : 'AVAILABLE FOR CARE'}</span>
                  <strong>{s?.specimen_code ?? 'Awaiting assignment'}</strong>
                  <div>
                    {s ? (
                      <>
                        {s.origin}
                        <ArrowRight size={13} />
                        {s.destination_lab}
                      </>
                    ) : (
                      <>Prepare a specimen to begin a tracked journey.</>
                    )}
                  </div>
                </div>
                <div className="fleet-chart">
                  <div>
                    <small>TEMPERATURE</small>
                    <strong>
                      {number(live?.temp_c)} <span>°C</span>
                    </strong>
                  </div>
                  <Sparkline readings={live ? rows : []} />
                </div>
                <div className="fleet-card-bottom">
                  <span>
                    <Clock3 size={13} />
                    {live ? 'Online' : 'Offline'} · {ago(c.last_seen_at)}
                  </span>
                  <span>
                    <Radio size={13} /> FW {c.firmware_ver}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title={
              capsules.length
                ? 'No capsules match your filters'
                : 'Your fleet is ready to be connected'
            }
            description={
              capsules.length
                ? 'Try another status or capsule code.'
                : 'Run the Supabase migrations to add your capsule inventory. No devices are invented in this view.'
            }
          />
        </div>
      )}
    </>
  );
}
