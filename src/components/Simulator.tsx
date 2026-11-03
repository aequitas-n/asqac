import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Pause, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './ui';
import { useData } from '../hooks/useData';
import { rpc, telemetryUrl } from '../lib/supabase';
import type { DeviceInfo } from '../types';
import { uploadTelemetryBatch } from '../lib/telemetryUpload';
export function Simulator({
  openRequest = 0,
  onRunningChange,
}: {
  openRequest?: number;
  onRunningChange?: (running: boolean) => void;
}) {
  const { capsules, transports, refresh } = useData();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const [token, setToken] = useState('');
  const [stress, setStress] = useState(false);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [retryMessage, setRetryMessage] = useState('');
  const stressRef = useRef(stress);
  stressRef.current = stress;
  const controller = useRef<AbortController>();
  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);
  useEffect(() => {
    if (open)
      rpc<DeviceInfo[]>('simulator_devices')
        .then((d) => {
          setDevices(d);
          setDevice((v) => v || d[0]?.device_uid || '');
        })
        .catch((e) => setError(e.message));
  }, [open]);
  const transportsRef = useRef(transports);
  transportsRef.current = transports;
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!running) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let n = 0;
    const heightReferenceAt = new Date().toISOString();
    const send = async () => {
      const target = devicesRef.current.find((d) => d.device_uid === device);
      const transport = transportsRef.current.find(
        (t) => t.capsule_id === target?.capsule_id && t.state === 'in_transit',
      );
      const profile = transport?.profile_snapshot;
      const middle = profile ? (profile.temp_min_c + profile.temp_max_c) / 2 : 5;
      const event = stressRef.current && n % 6 === 4;
      const kind = Math.floor(n / 6) % 4;
      controller.current = new AbortController();
      try {
        await uploadTelemetryBatch({
          endpoint: telemetryUrl,
          token,
          signal: controller.current.signal,
          onRetry: (ms) => {
            if (alive) setRetryMessage(`Device busy · retrying in ${(ms / 1000).toFixed(1)} s`);
          },
          readings: [
            {
              device_uid: device,
              recorded_at: new Date().toISOString(),
              temp_c:
                event && kind === 0
                  ? (profile?.temp_max_c ?? 8) + 4
                  : middle + Math.sin(n / 5) * 0.5,
              pressure_hpa: 1012 + Math.sin(n / 7) * 2,
              sea_level_pressure_hpa: 1013.25,
              reference_pressure_hpa: 1012,
              height_reference_at: heightReferenceAt,
              lux: event && kind === 3 ? (profile?.max_lux ?? 50) + 250 : 2 + Math.random() * 3,
              ax: 0.02,
              ay: 0.03,
              az: 1,
              gx: 0.1,
              gy: 0.1,
              gz: 0,
              pitch_deg: event && kind === 2 ? 65 : Math.sin(n / 4) * 4,
              roll_deg: Math.cos(n / 6) * 3,
              shock_g: event && kind === 1 ? 4.5 : 1 + Math.random() * 0.09,
              rssi: -49 - Math.floor(Math.random() * 10),
              simulated: true,
            },
          ],
        });
        if (alive) {
          n++;
          setCount(n);
          setError('');
          setRetryMessage('');
          if (n === 1) void refreshRef.current();
        }
      } catch (e) {
        if (alive) {
          const message = e instanceof Error ? e.message : 'Simulator failed';
          setError(message);
          setRunning(false);
          toast.error(message);
          return;
        }
      }
      if (alive) timer = setTimeout(() => void send(), 10000);
    };
    void send();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [running, device, token]);
  return (
    <>
      <button className={`sim-button ${running ? 'active' : ''}`} onClick={() => setOpen(true)}>
        <FlaskConical size={15} />
        <span>{running ? 'Simulated' : 'Simulator'}</span>
        <span className="switch-mini" data-on={running} />
      </button>
      {open && (
        <Modal title="Telemetry simulator" onClose={() => setOpen(false)}>
          <p className="modal-copy">
            Send labelled, simulated packets through the same ingestion endpoint used by the ESP32.
            Keep simulation on a dedicated demo capsule.
          </p>
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              The device secret stays in memory for this session. It is never saved to browser
              storage.
            </span>
          </div>
          <label className="field">
            Capsule / registered device
            <select value={device} disabled={running} onChange={(e) => setDevice(e.target.value)}>
              <option value="">Select a device</option>
              {devices.map((d) => (
                <option key={d.device_uid} value={d.device_uid}>
                  {capsules.find((c) => c.id === d.capsule_id)?.code} · {d.device_uid}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Device token
            <input
              type="password"
              autoComplete="off"
              value={token}
              disabled={running}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the per-device secret"
            />
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={stress} onChange={(e) => setStress(e.target.checked)} />
            <span>
              <strong>Stress scenario</strong>
              <small>Periodically exceed temperature, shock, tilt or light limits.</small>
            </span>
            <TriangleAlert size={18} />
          </label>
          {!devices.length && (
            <p className="muted small">Register a device using the device-token script first.</p>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {running && retryMessage && (
            <p className="muted small" role="status">
              {retryMessage}
            </p>
          )}
          {running && (
            <div className="sim-status">
              <span className="live-dot" />
              SIMULATED · {count} packets accepted · 10 s interval
            </div>
          )}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setOpen(false)}>
              Close
            </button>
            <button
              className="button primary"
              disabled={!running && (!device || token.length < 32 || !telemetryUrl)}
              onClick={() => {
                setCount(0);
                setError('');
                setRetryMessage('');
                setRunning((v) => !v);
              }}
            >
              {running ? <Pause size={16} /> : <Play size={16} />}{' '}
              {running ? 'Stop simulator' : 'Start simulator'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
