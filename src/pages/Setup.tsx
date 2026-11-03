import { BookOpen, CheckCircle2, Database, KeyRound, Radio } from 'lucide-react';
import { PageTitle, Panel } from '../components/ui';
export default function Setup() {
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / CONNECTION GUIDE"
        title="Connect the care network."
        description="The interface is ready. A Supabase project brings your capsule data to life."
      />
      <div className="setup-grid">
        {[
          {
            icon: Database,
            title: '01. Provision your database',
            text: 'Create a Supabase Free project. Apply the SQL files in supabase/migrations in filename order, using the SQL editor or Supabase CLI.',
          },
          {
            icon: KeyRound,
            title: '02. Configure staff access',
            text: 'Copy .env.example to .env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Use the create-users script to provision technician and doctor accounts.',
          },
          {
            icon: Radio,
            title: '03. Connect a capsule',
            text: 'Deploy the telemetry Edge Function. Generate a per-device token with the device-token script. Paste it into the simulator, or flash the ESP32 with your secrets.h.',
          },
          {
            icon: CheckCircle2,
            title: '04. Complete a journey',
            text: 'Sign in as a technician, register a specimen, prepare and start transport. Sign in as a doctor to receive the capsule and record a verdict.',
          },
        ].map(({ icon: Icon, title, text }) => (
          <Panel title={title} key={title}>
            <div className="setup-step">
              <Icon size={30} />
              <p>{text}</p>
            </div>
          </Panel>
        ))}
      </div>
      <div className="notice">
        <BookOpen size={21} />
        <span>
          The project README contains exact commands, deployment options, firmware libraries, device
          token rotation, data retention and verification steps. Connection secrets belong in .env
          and secrets.h only.
        </span>
      </div>
    </>
  );
}
