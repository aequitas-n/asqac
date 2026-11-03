import { lazy, Suspense, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  Cpu,
  Download,
  Lightbulb,
  Play,
  Printer,
  QrCode,
  Radio,
  ShieldCheck,
  Signal,
  Thermometer,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useCapsule, useData } from '../hooks/useData';
import { useAuth } from '../hooks/useAuth';
import { useClock } from '../hooks/useClock';
import { rpc } from '../lib/supabase';
import { ago, humanize, number, duration } from '../lib/format';
import { recommendVerdict } from '../lib/quality';
import { withBarometry } from '../lib/barometry';
import { liveReading } from '../lib/telemetry';
import type { Transport, Verdict } from '../types';
import { Badge, Empty, Journey, Modal, PageTitle, Panel, Skeleton } from '../components/ui';
import { BubbleLevel, Gauge, Meter } from '../components/widgets/Gauges';
import { TrendChart, type Trend } from '../components/widgets/Charts';
import { DecodeText, NumberTicker } from '../components/widgets/LiveText';
const Orientation = lazy(() => import('../components/widgets/Orientation'));
export default function CapsuleDetail() {
  const { id } = useParams();
  const { capsule, transport, specimen, profile, readings, latest, alerts } = useCapsule(id);
  const data = useData();
  const { profile: staff } = useAuth();
  const now = useClock(500);
  const [trend, setTrend] = useState<Trend>('temp_c');
  const [busy, setBusy] = useState(false);
  const [verdictOpen, setVerdictOpen] = useState(false);
  const [qr, setQr] = useState(false);
  const currentAlerts = alerts.filter((a) => a.transport_id === transport?.id);
  const technician = staff?.role === 'technician' || staff?.role === 'admin';
  const doctor = staff?.role === 'doctor' || staff?.role === 'admin';
  const live = liveReading(latest, now);
  const fresh = !!live;
  const barometry = live ? withBarometry(live) : undefined;
  async function action(name: string) {
    if (!transport) return;
    setBusy(true);
    try {
      await rpc('transition_transport', { p_transport: transport.id, p_action: name });
      await data.refresh();
      toast.success(
        name === 'arrive'
          ? 'Capsule received. Review the handling record.'
          : `Transport ${name === 'start' ? 'started' : 'prepared'}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }
  if (data.loading) return <Skeleton />;
  if (!capsule)
    return (
      <Empty
        title="Capsule not found"
        description="This capsule does not exist in your connected fleet."
        action={
          <Link to="/capsules" className="button secondary">
            Back to fleet
          </Link>
        }
      />
    );
  return (
    <>
      <Link className="back-link" to="/capsules">
        <ArrowLeft size={14} />
        Back to capsule fleet
      </Link>
      <PageTitle
        eyebrow="CAPSULE / LIVE HANDLING CONSOLE"
        title={<DecodeText text={capsule.code} />}
        description={capsule.label}
        action={
          <>
            <Badge value={capsule.status} />
            <button className="button secondary small" onClick={() => setQr(true)}>
              <QrCode size={16} />
              Capsule label
            </button>
          </>
        }
      />
      <div className="capsule-context">
        <div>
          <span className="eyebrow">SPECIMEN</span>
          <strong className="mono">
            <DecodeText text={specimen?.specimen_code ?? 'Unassigned'} />
          </strong>
          {specimen && <Badge value={specimen.priority} />}
        </div>
        <div>
          <span className="eyebrow">TRANSPORT</span>
          <strong className="mono">
            <DecodeText text={transport?.transport_code ?? 'No open journey'} />
          </strong>
        </div>
        <div>
          <span className="eyebrow">HANDLING PROFILE</span>
          <strong>{profile?.name ?? 'Awaiting assignment'}</strong>
        </div>
        <div>
          <span className="eyebrow">LAST SENSOR PACKET</span>
          <strong className={fresh ? 'accent' : 'muted'}>
            <span className={fresh ? 'live-dot' : 'offline-dot'} />
            {fresh ? 'Online' : 'Offline'} · {latest ? ago(latest.recorded_at) : 'No packets yet'}
          </strong>
          {live?.simulated && <Badge value="warning">Simulated</Badge>}
        </div>
      </div>
      <div className="live-gauges">
        <Panel>
          <Gauge
            label="Temperature"
            unit="°C"
            sensor="BMP280"
            value={live?.temp_c}
            min={profile ? Math.min(0, profile.temp_min_c - 4) : -10}
            max={profile ? Math.max(12, profile.temp_max_c + 4) : 50}
            safeMin={profile?.temp_min_c}
            safeMax={profile?.temp_max_c}
          />
        </Panel>
        <Panel>
          <Gauge
            label="Barometric pressure"
            unit="hPa"
            sensor="BMP280"
            value={live?.pressure_hpa}
            min={800}
            max={1150}
            safeMin={profile?.pressure_min_hpa}
            safeMax={profile?.pressure_max_hpa}
          />
        </Panel>
        <Panel>
          <Meter
            label="Ambient light"
            unit="lx"
            sensor="BH1750"
            value={live?.lux}
            max={profile?.max_lux}
          />
        </Panel>
        <Panel>
          <Meter
            label="Impact peak / packet"
            unit="g"
            sensor="MPU6050"
            value={live?.shock_g}
            max={profile?.max_shock_g}
          />
          <span className="peak-hold">
            Journey peak {number(fresh ? transport?.telemetry_summary?.shock_max : undefined)} g
          </span>
        </Panel>
      </div>
      <div className="barometry-gauges">
        <Panel title="Estimated barometric altitude" kicker="DERIVED / BMP280 PRESSURE">
          <div className="barometry-value" aria-label="Estimated barometric altitude">
            <NumberTicker value={barometry?.altitude_m} digits={1} /> <small>m</small>
          </div>
          <p className="barometry-note">
            Reference sea-level pressure: {number(barometry?.sea_level_pressure_hpa, 2)} hPa.
            Atmospheric estimate, not GPS elevation.
          </p>
        </Panel>
        <Panel title="Relative height change" kicker="DERIVED / STARTUP PRESSURE BASELINE">
          <div className="barometry-value" aria-label="Relative height change">
            {barometry?.height_change_m != null && barometry.height_change_m > 0 ? '+' : ''}
            <NumberTicker value={barometry?.height_change_m} digits={1} /> <small>m</small>
          </div>
          <p className="barometry-note">
            {!fresh
              ? 'Offline · waiting for fresh capsule telemetry.'
              : barometry?.height_reference_at
                ? `Relative to ${number(barometry.reference_pressure_hpa, 2)} hPa at ${new Date(barometry.height_reference_at).toLocaleTimeString()}. Positive = higher; resets on reboot.`
                : 'Waiting for a startup baseline. Upload the altitude-enabled firmware and keep the capsule still during calibration.'}
          </p>
        </Panel>
      </div>
      <p className="barometry-caution">
        Pressure-derived estimates: weather, temperature and capsule sealing affect them. Use a
        vented sensor; not a reliable floor or drop detector.
      </p>
      <div className="detail-grid">
        <Panel
          className="orientation-panel"
          title="Capsule orientation"
          kicker="MOTION / MPU6050"
          action={<Badge value={fresh ? 'info' : 'idle'}>{fresh ? 'Reporting' : 'Offline'}</Badge>}
        >
          {fresh ? (
            <Suspense fallback={<BubbleLevel pitch={live?.pitch_deg} roll={live?.roll_deg} />}>
              <Orientation pitch={live?.pitch_deg} roll={live?.roll_deg} />
            </Suspense>
          ) : (
            <div
              className="orientation-scene orientation-offline"
              role="status"
              aria-label="Orientation offline"
            >
              <span className="barometry-value">—</span>
              <div className="orientation-caption">OFFLINE · WAITING FOR FRESH TELEMETRY</div>
            </div>
          )}
          <div className="orientation-numbers">
            <span>
              PITCH <b>{number(live?.pitch_deg)}°</b>
            </span>
            <span>
              ROLL <b>{number(live?.roll_deg)}°</b>
            </span>
            <span>
              AX / AY / AZ{' '}
              <b>
                {number(live?.ax, 2)} / {number(live?.ay, 2)} / {number(live?.az, 2)} g
              </b>
            </span>
            <span>
              GYRO X / Y / Z
              <b>
                {number(live?.gx)} / {number(live?.gy)} / {number(live?.gz)} °/s
              </b>
            </span>
          </div>
        </Panel>
        <Panel className="trend-panel" title="Sensor trends" kicker="SENSOR TRENDS">
          <div className="trend-tabs">
            {(
              [
                { key: 'temp_c', label: 'Temperature' },
                { key: 'pressure_hpa', label: 'Pressure' },
                { key: 'lux', label: 'Ambient light' },
                { key: 'shock_g', label: 'Motion' },
                { key: 'altitude_m', label: 'Altitude estimate' },
                { key: 'height_change_m', label: 'Height change' },
              ] as const
            ).map((t) => (
              <button
                className={trend === t.key ? 'active' : ''}
                onClick={() => setTrend(t.key)}
                key={t.key}
              >
                {t.label}
              </button>
            ))}
          </div>
          <TrendChart readings={readings} metric={trend} profile={profile} />
          <div className="panel-bottom">
            <span>Most recent {readings.length} packets · rolling window</span>
            <span>{fresh ? 'Current stream' : 'Last recorded data'}</span>
          </div>
        </Panel>
        <Panel className="journey-panel" title="Transport journey" kicker="CHAIN OF CUSTODY">
          {transport ? (
            <>
              <Journey
                state={transport.state}
                created={transport.created_at}
                started={transport.started_at}
                arrived={transport.arrived_at}
                closed={transport.closed_at}
              />
              <div className="transport-route">
                <div>
                  <span className="eyebrow">COLLECTION</span>
                  <strong>{specimen?.origin}</strong>
                </div>
                <ArrowRight size={18} />
                <div>
                  <span className="eyebrow">RECEIVING</span>
                  <strong>{specimen?.destination_lab}</strong>
                </div>
              </div>
              {specimen?.clinical_notice && (
                <div className="notice">
                  <TriangleAlert size={16} />
                  <span>{specimen.clinical_notice}</span>
                </div>
              )}
              <div className="button-row">
                {technician && transport.state === 'registered' && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void action('prepare')}
                  >
                    <ShieldCheck size={16} />
                    Prepare transport
                  </button>
                )}
                {technician && transport.state === 'prepared' && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void action('start')}
                  >
                    <Play size={16} />
                    Start transport
                  </button>
                )}
                {doctor && transport.state === 'in_transit' && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void action('arrive')}
                  >
                    <Download size={16} />
                    Receive & end transport
                  </button>
                )}
                {doctor && transport.state === 'arrived' && (
                  <button className="button primary" onClick={() => setVerdictOpen(true)}>
                    <CheckCircle2 size={16} />
                    Review & record verdict
                  </button>
                )}
                <Link to={`/reports/${transport.id}`} className="button secondary small">
                  Custody report
                  <ArrowRight size={14} />
                </Link>
              </div>
            </>
          ) : (
            <Empty
              title="Ready for a new journey"
              description="Register a specimen and assign this capsule to create its custody timeline."
              action={
                technician ? (
                  <Link to="/register" className="button secondary">
                    Register specimen
                  </Link>
                ) : undefined
              }
            />
          )}
        </Panel>
        <Panel title="Sensor suite" kicker="SENSOR SUITE">
          <div className="sensor-suite">
            {[
              {
                icon: Thermometer,
                name: 'HW-611 / BMP280',
                text: 'Temperature · Barometric pressure',
              },
              { icon: Radio, name: 'MPU6050', text: 'Acceleration · Gyro · Tilt · Impact' },
              { icon: Lightbulb, name: 'BH1750', text: 'Ambient light · Exposure indication' },
              {
                icon: Cpu,
                name: 'ESP32 controller',
                text: 'Wi-Fi · Packet delivery controller',
              },
            ].map(({ icon: Icon, name, text }) => (
              <div key={name}>
                <span className="sensor-icon">
                  <Icon size={19} />
                </span>
                <div>
                  <strong>{name}</strong>
                  <small>{text}</small>
                </div>
                <Badge value={fresh ? 'info' : 'idle'}>{fresh ? 'Live' : 'Offline'}</Badge>
              </div>
            ))}
          </div>
          <p className="small muted sensor-note">
            A validated packet requires all three sensors. No humidity or battery measurements are
            available. Live values clear after 15 seconds without a fresh packet.
          </p>
        </Panel>
        <Panel
          title="Ingestion health"
          kicker="INGESTION HEALTH"
          action={<Wifi size={19} className="accent" />}
        >
          <dl className="key-values">
            <div>
              <dt>Last packet age</dt>
              <dd>
                {latest
                  ? `${Math.max(0, Math.floor((now - Date.parse(latest.recorded_at)) / 1000))} s`
                  : 'Awaiting'}
              </dd>
            </div>
            <div>
              <dt>Last HTTPS ingestion</dt>
              <dd>
                {latest
                  ? `${Math.max(0, Math.floor((now - Date.parse(latest.received_at)) / 1000))} s ago`
                  : 'Awaiting'}
              </dd>
            </div>
            <div>
              <dt>Observation → ingestion</dt>
              <dd>
                {latest
                  ? `${Math.max(0, (Date.parse(latest.received_at) - Date.parse(latest.recorded_at)) / 1000).toFixed(2)} s`
                  : 'Awaiting'}
              </dd>
            </div>
            <div>
              <dt>Wi-Fi RSSI</dt>
              <dd>
                <Signal size={14} />
                {live ? `${live.rssi} dBm` : '—'}
              </dd>
            </div>
            <div>
              <dt>Device identifier</dt>
              <dd className="mono small">{latest?.device_uid ?? 'No packet received'}</dd>
            </div>
            <div>
              <dt>Firmware</dt>
              <dd>{capsule.firmware_ver}</dd>
            </div>
            <div>
              <dt>Data source</dt>
              <dd>
                {latest
                  ? latest.simulated
                    ? 'SIMULATED'
                    : 'Physical capsule'
                  : 'Not yet reporting'}
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel
          className="detail-alerts"
          title="Handling event history"
          kicker="RETAINED FOR REVIEW"
          action={<span className="count-pill">{alerts.length}</span>}
        >
          {alerts.length ? (
            <div className="compact-alerts">
              {alerts.slice(0, 6).map((a) => (
                <div key={a.id}>
                  <Bell size={17} className={`text-${a.severity}`} />
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.message}</p>
                    <small>
                      {ago(a.created_at)} · {a.acknowledged ? 'Acknowledged' : 'Unacknowledged'} ·{' '}
                      {a.resolved_at ? 'Condition recovered' : 'Active'}
                    </small>
                  </div>
                  <Badge value={a.severity} />
                </div>
              ))}
            </div>
          ) : (
            <p className="quiet-message">
              <ShieldCheck size={19} />
              No handling events recorded for this capsule.
            </p>
          )}
        </Panel>
      </div>
      {verdictOpen && transport && (
        <VerdictModal
          transport={transport}
          recommendation={recommendVerdict(
            currentAlerts,
            transport.telemetry_summary,
            transport.excursion_count,
            transport.critical_excursion_count,
          )}
          alertCount={transport.excursion_count}
          onClose={() => setVerdictOpen(false)}
        />
      )}
      {qr && (
        <Modal title="Capsule identification label" onClose={() => setQr(false)}>
          <div className="print-label">
            <QRCodeSVG value={capsule.code} size={170} marginSize={3} />
            <h2 className="mono">{capsule.code}</h2>
            <p>ASQAC · Reusable specimen capsule</p>
          </div>
          <div className="modal-actions no-print">
            <button className="button primary" onClick={() => window.print()}>
              <Printer size={16} />
              Print capsule label
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function VerdictModal({
  transport,
  recommendation,
  alertCount,
  onClose,
}: {
  transport: Transport;
  recommendation: Exclude<Verdict, 'pending'>;
  alertCount: number;
  onClose: () => void;
}) {
  const { refresh } = useData();
  const [verdict, setVerdict] = useState<Exclude<Verdict, 'pending'>>(recommendation);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = transport.telemetry_summary;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('transition_transport', {
        p_transport: transport.id,
        p_action: 'close',
        p_verdict: verdict,
        p_notes: notes,
      });
      await refresh();
      toast.success('Final verdict recorded in the custody trail.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save verdict');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Receiving verdict" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="review-stats">
          <div>
            <span>Temperature range</span>
            <strong>
              {number(s?.temp_min)}–{number(s?.temp_max)} °C
            </strong>
          </div>
          <div>
            <span>Peak impact</span>
            <strong>{number(s?.shock_max, 2)} g</strong>
          </div>
          <div>
            <span>Peak light</span>
            <strong>{number(s?.light_max)} lx</strong>
          </div>
          <div>
            <span>Excursion episodes</span>
            <strong>{alertCount}</strong>
          </div>
          <div>
            <span>Transit time / target</span>
            <strong>
              {number(duration(transport.started_at, transport.arrived_at), 0)} /{' '}
              {transport.profile_snapshot.max_transport_min} min
            </strong>
          </div>
          <div>
            <span>Orientation peak / coverage gaps</span>
            <strong>
              {number(s?.tilt_max)}° / {s?.gap_count ?? 0}
            </strong>
          </div>
        </div>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            Suggested disposition: <strong>{humanize(recommendation)}</strong>. This is a
            threshold-based aid. Review missing coverage, specimen condition, local SOP and all
            excursions before deciding.
          </span>
        </div>
        {(!s?.count || !!s.simulated_count) && (
          <div className="notice warning">
            <TriangleAlert size={18} />
            <span>
              {!s?.count
                ? 'No telemetry was recorded. The specimen condition cannot be established.'
                : 'This transport contains SIMULATED readings. They are not evidence of clinical specimen integrity.'}
            </span>
          </div>
        )}
        <fieldset className="verdict-options">
          <legend>Final receiving verdict</legend>
          {(['accept', 'review_required', 'reject'] as const).map((v) => (
            <label key={v} className={verdict === v ? 'selected' : ''}>
              <input
                type="radio"
                name="verdict"
                value={v}
                checked={verdict === v}
                onChange={() => setVerdict(v)}
              />
              <Badge value={v} />
            </label>
          ))}
        </fieldset>
        <label className="field">
          Receiving notes{' '}
          {verdict === 'accept' ? '(optional)' : '(required · at least 5 characters)'}
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            minLength={verdict === 'accept' ? 0 : 5}
            maxLength={2000}
            required={verdict !== 'accept'}
            placeholder="Record the clinical reasoning for this disposition."
          />
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Continue reviewing
          </button>
          <button
            className="button primary"
            disabled={busy || (verdict !== 'accept' && notes.trim().length < 5)}
          >
            {busy ? 'Recording…' : 'Record verdict & close journey'}
            <CheckCircle2 size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
