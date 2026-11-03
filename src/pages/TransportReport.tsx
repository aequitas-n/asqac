import { useEffect, useState } from 'react';
import { ArrowLeft, Printer, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../lib/queries';
import { dateTime, duration, humanize, number, auditDescription } from '../lib/format';
import type { Alert, AuditEntry, Capsule, Specimen, Transport } from '../types';
import { Badge, Brand, Empty, Journey, PageTitle, Panel, Skeleton } from '../components/ui';
export default function TransportReport() {
  const { id } = useParams();
  const data = useData();
  const [record, setRecord] = useState<{
    transport: Transport;
    specimen: Specimen;
    capsule: Capsule;
    alerts: Alert[];
    audit: AuditEntry[];
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    if (!supabase || !id) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const { data: t, error: e } = await supabase!
          .from('transports')
          .select('*')
          .eq('id', id)
          .single();
        if (e) throw new Error(e.message);
        const transport = t as Transport;
        const [s, c, alerts, audit] = await Promise.all([
          supabase!.from('specimens').select('*').eq('id', transport.specimen_id).single(),
          supabase!.from('capsules').select('*').eq('id', transport.capsule_id).single(),
          fetchAll<Alert>('alerts', { column: 'transport_id', value: id }),
          fetchAll<AuditEntry>('audit_log', { column: 'entity_id', value: id }),
        ]);
        if (s.error || c.error) throw new Error('Unable to load specimen or capsule');
        if (live)
          setRecord({
            transport,
            specimen: s.data as Specimen,
            capsule: c.data as Capsule,
            alerts,
            audit,
          });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Report unavailable');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [id, data.transports]);
  if (loading) return <Skeleton />;
  if (!record)
    return (
      <Empty
        title="Report unavailable"
        description={error || 'Connect Supabase to retrieve a transport report.'}
      />
    );
  const { transport: t, specimen: s, capsule: c, alerts, audit } = record;
  const summary = t.telemetry_summary;
  const p = t.profile_snapshot;
  return (
    <div className="transport-report">
      <Link className="back-link no-print" to="/reports">
        <ArrowLeft size={14} />
        Back to reports
      </Link>
      <div className="print-only">
        <Brand />
      </div>
      <PageTitle
        eyebrow="TRANSPORT / CHAIN-OF-CUSTODY REPORT"
        title={t.transport_code}
        description={`${s.specimen_code} · ${c.code} · ${s.requested_test}`}
        action={
          <button className="button primary" onClick={() => window.print()}>
            <Printer size={16} />
            Print report
          </button>
        }
      />
      <Panel>
        <div className="report-header">
          <Badge value={t.state} />
          <Badge value={t.verdict} />
          <span className="muted small">Generated {new Date().toLocaleString()}</span>
        </div>
        <Journey
          state={t.state}
          created={t.created_at}
          started={t.started_at}
          arrived={t.arrived_at}
          closed={t.closed_at}
        />
        <div className="report-facts">
          <dl className="key-values">
            <div>
              <dt>Patient reference</dt>
              <dd>{s.patient_ref}</dd>
            </div>
            <div>
              <dt>Specimen type</dt>
              <dd>{s.specimen_type}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{humanize(s.priority)}</dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd>{s.origin}</dd>
            </div>
            <div>
              <dt>Receiving lab</dt>
              <dd>{s.destination_lab}</dd>
            </div>
          </dl>
          <dl className="key-values">
            <div>
              <dt>Handling profile</dt>
              <dd>{p.name}</dd>
            </div>
            <div>
              <dt>Target temperature</dt>
              <dd>
                {p.temp_min_c}–{p.temp_max_c} °C
              </dd>
            </div>
            <div>
              <dt>Transit time / target</dt>
              <dd>
                {number(duration(t.started_at, t.arrived_at), 0)} / {p.max_transport_min} min
              </dd>
            </div>
            <div>
              <dt>Recorded readings</dt>
              <dd>
                {summary?.count ?? 0} ({summary?.simulated_count ?? 0} simulated)
              </dd>
            </div>
            <div>
              <dt>Temp min / max · shock peak</dt>
              <dd>
                {number(summary?.temp_min)} / {number(summary?.temp_max)} °C ·{' '}
                {number(summary?.shock_max)} g
              </dd>
            </div>
          </dl>
        </div>
        <div className="report-verdict">
          <ShieldCheck size={23} />
          <div>
            <span className="eyebrow">FINAL CLINICAL DISPOSITION</span>
            <h3>{humanize(t.verdict)}</h3>
            <p>{t.verdict_notes || 'No receiving notes recorded.'}</p>
            <small>{dateTime(t.verdict_at)}</small>
          </div>
        </div>
        {s.clinical_notice && <p className="notice">{s.clinical_notice}</p>}
        {!!summary?.simulated_count && (
          <p className="notice warning">
            Contains simulated data. This record demonstrates the system and is not evidence of
            clinical specimen integrity.
          </p>
        )}
      </Panel>
      <Panel title="Barometric estimates" kicker="INFORMATIONAL / PRESSURE-DERIVED">
        <dl className="key-values report-barometry">
          <div>
            <dt>Estimated altitude min / max</dt>
            <dd>
              {number(summary?.altitude_min_m)} / {number(summary?.altitude_max_m)} m
            </dd>
          </div>
          <div>
            <dt>Relative height change min / max</dt>
            <dd>
              {number(summary?.height_change_min_m)} / {number(summary?.height_change_max_m)} m
            </dd>
          </div>
          <div>
            <dt>Startup reference changed</dt>
            <dd>
              {summary?.height_reference_at
                ? summary.height_reference_changed
                  ? 'Yes · values span separate reference zeroes'
                  : 'No reset recorded'
                : 'No startup reference recorded'}
            </dd>
          </div>
        </dl>
        <p className="barometry-note">
          Atmospheric estimates, not GPS elevation, total vertical distance or a floor detector.
          Weather and sealing affect pressure. Relative zero resets on reboot. These metrics do not
          determine the clinical verdict.
        </p>
      </Panel>
      <Panel title="Handling excursions" kicker="FULL TRANSPORT EVENT HISTORY">
        {alerts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Evidence</th>
                  <th>Acknowledgement</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{dateTime(a.created_at)}</td>
                    <td>{humanize(a.alert_type)}</td>
                    <td>
                      <Badge value={a.severity} />
                    </td>
                    <td>{a.message}</td>
                    <td>{a.acknowledged ? dateTime(a.acknowledged_at) : 'Not acknowledged'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No excursion episodes recorded. Missing telemetry is not evidence of compliant handling.
          </p>
        )}
      </Panel>
      <Panel title="Every custody event" kicker="TIMESTAMPED / ACTOR-ATTRIBUTED">
        <div className="audit-timeline">
          {audit
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
            .map((a) => (
              <div key={a.id}>
                <span className="audit-node" />
                <time>{dateTime(a.created_at)}</time>
                <div>
                  <strong>{a.action}</strong>
                  <span>{a.actor_label}</span>
                  <small>{auditDescription(a.detail)}</small>
                </div>
              </div>
            ))}
        </div>
      </Panel>
      <p className="report-footnote">
        ASQAC university research prototype. Profile limits require receiving-laboratory validation.
        Summary extrema and custody records persist after the 48-hour closed-transport raw telemetry
        window.
      </p>
    </div>
  );
}
