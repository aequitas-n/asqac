import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight,
  Box,
  Check,
  ExternalLink,
  FlaskConical,
  Printer,
  QrCode,
  ShieldCheck,
  Thermometer,
  TriangleAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useData } from '../hooks/useData';
import { rpc } from '../lib/supabase';
import { sources } from '../lib/format';
import type { Specimen, Transport, RegistrationInput } from '../types';
import { Badge, Modal, PageTitle, Panel } from '../components/ui';
const QRScanner = lazy(() => import('../components/QRScanner'));
const schema = z.object({
  patient_ref: z.string().trim().min(2, 'Enter an anonymised patient reference.').max(80),
  requested_test: z.string().trim().min(2, 'Enter the requested test.').max(160),
  specimen_type: z.enum(['BLOOD', 'URINE', 'PLASMA', 'TISSUE', 'SWAB', 'VACCINE']),
  handling_profile_id: z.string().uuid('Choose a handling profile.'),
  priority: z.enum(['routine', 'urgent', 'critical']),
  origin: z.string().trim().min(2, 'Enter the origin ward.').max(100),
  destination_lab: z.string().trim().min(2, 'Enter the receiving lab.').max(100),
  clinical_notice: z.string().trim().max(2000),
  capsule_id: z.string().uuid('Assign an available capsule.'),
});
export default function Register() {
  const { profiles, capsules, transports, refresh } = useData();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ specimen: Specimen; transport: Transport } | null>(null);
  const [submitError, setSubmitError] = useState('');
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      specimen_type: 'BLOOD',
      priority: 'routine',
      patient_ref: '',
      requested_test: '',
      origin: '',
      destination_lab: '',
      clinical_notice: '',
      handling_profile_id: '',
      capsule_id: '',
    },
  });
  const type = watch('specimen_type');
  const profileId = watch('handling_profile_id');
  const selectedProfile = profiles.find((p) => p.id === profileId);
  const chosenCapsule = capsules.find((c) => c.id === watch('capsule_id'));
  const available = capsules.filter(
    (c) =>
      c.status === 'idle' && !transports.some((t) => t.capsule_id === c.id && t.state !== 'closed'),
  );
  useEffect(() => {
    const current = profiles.find((p) => p.id === profileId);
    if (!current || current.specimen_type !== type)
      setValue('handling_profile_id', profiles.find((p) => p.specimen_type === type)?.id ?? '');
  }, [type, profiles, profileId, setValue]);
  const onScan = useCallback(
    (text: string) => {
      let code = text.trim();
      try {
        const parsed = JSON.parse(code) as { capsule_code?: string };
        code = parsed.capsule_code ?? code;
      } catch {
        try {
          const url = new URL(code);
          code = url.searchParams.get('capsule') ?? url.pathname.split('/').at(-1) ?? code;
        } catch {
          /* Plain code QR is supported. */
        }
      }
      const target = available.find((c) => c.code === code || c.id === code);
      if (!target) {
        toast.error('This capsule is not available. Scan an idle capsule.');
        return;
      }
      setValue('capsule_id', target.id, { shouldValidate: true });
      setScanning(false);
      toast.success(`${target.code} assigned`);
    },
    [available, setValue],
  );
  async function submit(input: RegistrationInput) {
    setSubmitError('');
    try {
      const saved = await rpc<{ specimen: Specimen; transport: Transport }>('register_specimen', {
        p_input: input,
      });
      setResult(saved);
      await refresh();
      toast.success('Specimen registered. Capsule reserved.');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Registration failed');
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="SPECIMEN DESK / NEW REGISTRATION"
        title="Register a specimen"
        description="Register the specimen, confirm its handling profile, and connect a capsule."
      />
      {result ? (
        <Panel
          title="Registered. Reserved. Ready for preparation."
          className="registration-success"
        >
          <div className="success-icon">
            <Check size={30} />
          </div>
          <div className="print-label">
            <BrandLabel />
            <QRCodeSVG
              value={JSON.stringify({
                specimen_code: result.specimen.specimen_code,
                capsule_code: chosenCapsule?.code,
                transport_code: result.transport.transport_code,
              })}
              size={150}
              bgColor="#ffffff"
              fgColor="#0b1722"
              marginSize={3}
            />
            <h2 className="mono">{result.specimen.specimen_code}</h2>
            <p>
              {chosenCapsule?.code} · {result.specimen.specimen_type} · {result.specimen.priority}
            </p>
            <small>
              {result.specimen.origin} → {result.specimen.destination_lab}
            </small>
          </div>
          <div className="button-row no-print">
            <button className="button secondary" onClick={() => window.print()}>
              <Printer size={16} />
              Print specimen label
            </button>
            <Link className="button primary" to={`/capsules/${result.transport.capsule_id}`}>
              Prepare transport
              <ArrowRight size={16} />
            </Link>
          </div>
        </Panel>
      ) : (
        <form onSubmit={handleSubmit(submit)} noValidate className="registration-grid">
          <div className="form-column">
            <Panel
              title="Specimen & clinical context"
              kicker="01 / IDENTIFY"
              action={<FlaskConical size={20} className="accent" />}
            >
              <div className="form-grid">
                <label className="field">
                  Patient reference
                  <input
                    {...register('patient_ref')}
                    placeholder="e.g. REF-2048 (anonymised)"
                    aria-invalid={!!errors.patient_ref}
                  />
                  <small>Use a project reference. Do not enter names or birth dates.</small>
                  {errors.patient_ref && (
                    <span className="field-error">{errors.patient_ref.message}</span>
                  )}
                </label>
                <label className="field">
                  Requested test
                  <input
                    {...register('requested_test')}
                    placeholder="e.g. Separated chemistry panel"
                    aria-invalid={!!errors.requested_test}
                  />
                  {errors.requested_test && (
                    <span className="field-error">{errors.requested_test.message}</span>
                  )}
                </label>
                <label className="field">
                  Specimen type
                  <select {...register('specimen_type')}>
                    {['BLOOD', 'URINE', 'PLASMA', 'TISSUE', 'SWAB', 'VACCINE'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Handling profile
                  <select
                    {...register('handling_profile_id')}
                    aria-invalid={!!errors.handling_profile_id}
                  >
                    <option value="">Select profile</option>
                    {profiles
                      .filter((p) => p.specimen_type === type)
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  {errors.handling_profile_id && (
                    <span className="field-error">{errors.handling_profile_id.message}</span>
                  )}
                </label>
                <label className="field">
                  Priority
                  <select {...register('priority')}>
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
              </div>
            </Panel>
            <Panel title="The route to receiving" kicker="02 / CONNECT">
              <div className="form-grid">
                <label className="field">
                  Origin ward
                  <input
                    {...register('origin')}
                    placeholder="e.g. Emergency ward"
                    aria-invalid={!!errors.origin}
                  />
                  {errors.origin && <span className="field-error">{errors.origin.message}</span>}
                </label>
                <label className="field">
                  Destination laboratory
                  <input
                    {...register('destination_lab')}
                    placeholder="e.g. Clinical biochemistry"
                    aria-invalid={!!errors.destination_lab}
                  />
                  {errors.destination_lab && (
                    <span className="field-error">{errors.destination_lab.message}</span>
                  )}
                </label>
                <label className="field full-span">
                  Clinical notice <span className="muted">(optional)</span>
                  <textarea
                    {...register('clinical_notice')}
                    rows={3}
                    placeholder="Handling context for the receiving team. No direct patient identifiers."
                  />
                  {errors.clinical_notice && (
                    <span className="field-error">{errors.clinical_notice.message}</span>
                  )}
                </label>
              </div>
            </Panel>
            <Panel
              title="Reserve a smart capsule"
              kicker="03 / ASSIGN"
              action={
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setScanning(true)}
                >
                  <QrCode size={15} />
                  Scan QR
                </button>
              }
            >
              <label className="field">
                Available capsule
                <select {...register('capsule_id')} aria-invalid={!!errors.capsule_id}>
                  <option value="">Choose an idle capsule</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.label}
                    </option>
                  ))}
                </select>
                {errors.capsule_id && (
                  <span className="field-error">{errors.capsule_id.message}</span>
                )}
              </label>
              {!available.length && (
                <div className="notice warning">
                  <TriangleAlert size={18} />
                  <span>
                    No idle capsule is available. Connect Supabase or complete an open journey to
                    release a capsule.
                  </span>
                </div>
              )}
              {chosenCapsule && (
                <div className="assignment-confirm">
                  <Box size={24} />
                  <div>
                    <strong className="mono">{chosenCapsule.code}</strong>
                    <span>Reserved atomically when you register.</span>
                  </div>
                  <Badge value="idle" />
                </div>
              )}
            </Panel>
            {submitError && (
              <div className="error-banner" role="alert">
                {submitError}
              </div>
            )}
            <div className="form-submit">
              <span>
                <ShieldCheck size={16} />A custody entry is created automatically.
              </span>
              <button className="button primary" disabled={isSubmitting}>
                {isSubmitting ? 'Registering…' : 'Register & reserve capsule'}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <aside className="profile-column">
            <Panel title="Handling profile" kicker="PROFILE / PREVIEW" className="profile-summary">
              {selectedProfile ? (
                <>
                  <Badge value="info">{selectedProfile.code}</Badge>
                  <h3>{selectedProfile.name}</h3>
                  <div className="profile-temp">
                    <Thermometer size={26} />
                    <strong>
                      {selectedProfile.temp_min_c}–{selectedProfile.temp_max_c}
                      <small>°C</small>
                    </strong>
                  </div>
                  <dl className="key-values">
                    <div>
                      <dt>Transport window</dt>
                      <dd>{selectedProfile.max_transport_min} min</dd>
                    </div>
                    <div>
                      <dt>Impact peak</dt>
                      <dd>≤ {selectedProfile.max_shock_g} g</dd>
                    </div>
                    <div>
                      <dt>Orientation</dt>
                      <dd>≤ {selectedProfile.max_tilt_deg}°</dd>
                    </div>
                    <div>
                      <dt>Light exposure</dt>
                      <dd>≤ {selectedProfile.max_lux} lx</dd>
                    </div>
                    <div>
                      <dt>Pressure band</dt>
                      <dd>
                        {selectedProfile.pressure_min_hpa}–{selectedProfile.pressure_max_hpa} hPa
                      </dd>
                    </div>
                  </dl>
                  <div className="profile-note">
                    <TriangleAlert size={17} />
                    <span>
                      {selectedProfile.freezing_risk
                        ? 'Freezing risk · Do not freeze.'
                        : 'Follow assay-specific processing instructions.'}
                    </span>
                  </div>
                  <p className="small muted">{selectedProfile.notes}</p>
                  <div className="notice">
                    <ShieldCheck size={18} />
                    <span>
                      {selectedProfile.lab_confirmation_req
                        ? 'Confirm these illustrative limits with the receiving laboratory.'
                        : 'Follow your validated local laboratory SOP.'}
                    </span>
                  </div>
                </>
              ) : (
                <p className="muted">
                  Handling profiles appear after your database migrations are applied.
                </p>
              )}
            </Panel>
            <Panel title="Laboratory references" kicker="SOURCE REFERENCES">
              <p className="small muted">
                References inform local SOP design. The displayed project limits are illustrative
                and require lab approval.
              </p>
              <div className="source-links">
                {sources.map((s) => (
                  <a href={s.url} key={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                    <ExternalLink size={13} />
                  </a>
                ))}
              </div>
            </Panel>
          </aside>
        </form>
      )}
      {scanning && (
        <Modal title="Scan a capsule QR" onClose={() => setScanning(false)}>
          <Suspense fallback={<p>Starting camera…</p>}>
            <QRScanner onScan={onScan} />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
function BrandLabel() {
  return <div className="qr-label-brand">ASQAC · SPECIMEN CUSTODY</div>;
}
