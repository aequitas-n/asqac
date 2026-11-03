import {
  Activity,
  ArrowRight,
  Cloud,
  Cpu,
  Database,
  Lightbulb,
  LockKeyhole,
  Radio,
  RotateCw,
  ShieldCheck,
  Thermometer,
  Wifi,
} from 'lucide-react';
import { Badge, PageTitle, Panel } from '../components/ui';
import { CapsuleDrawing } from '../components/Illustrations';
export default function Hardware() {
  return (
    <>
      <PageTitle
        eyebrow="ENGINEERING / THE CAPSULE"
        title="Capsule hardware"
        description="A reusable sensing capsule. A traceable data path. A clearer receiving decision."
      />
      <div className="hardware-hero panel">
        <div>
          <div className="eyebrow">ADAPTIVE SPECIMEN QUALITY ASSURANCE CAPSULE</div>
          <h2>
            Care on the inside.
            <br />
            <span className="accent">Intelligence all around.</span>
          </h2>
          <p>
            A compact ESP32-C3 controller brings environmental and inertial observations together,
            turning a specimen transfer into a continuous handling record.
          </p>
          <div className="hardware-chips">
            <Badge value="info">Wi-Fi interface</Badge>
            <Badge value="info">I²C sensor bus</Badge>
            <Badge value="idle">Research prototype</Badge>
          </div>
        </div>
        <div className="hardware-drawing">
          <CapsuleDrawing className="capsule-drawing" />
          <span>CONCEPT ILLUSTRATION / NOT LIVE DATA</span>
        </div>
      </div>
      <div className="hardware-sensors">
        {[
          {
            icon: Cpu,
            title: 'ESP32-C3 Super Mini',
            tag: 'CONTROLLER',
            text: 'Wi-Fi delivery, buffered readings and an I²C sensor bus. SDA GPIO9, SCL GPIO8, with 4.7 kΩ pull-ups.',
          },
          {
            icon: Activity,
            title: 'MPU6050',
            tag: '6-AXIS INERTIAL',
            text: 'Acceleration x/y/z in g, angular velocity in °/s, calculated pitch and roll, and the peak acceleration magnitude between packets.',
          },
          {
            icon: Lightbulb,
            title: 'BH1750',
            tag: 'AMBIENT LIGHT',
            text: 'Light in lux. An unexpected rise can indicate lid opening or exposure; it does not independently prove that the lid opened.',
          },
          {
            icon: Thermometer,
            title: 'HW-611 / BMP280',
            tag: 'ENVIRONMENTAL',
            text: 'Air temperature in °C and barometric pressure in hPa. Sensor module address auto-detection at 0x76 and 0x77. No humidity measurement.',
          },
        ].map(({ icon: Icon, title, tag, text }) => (
          <Panel key={title}>
            <Icon size={26} className="accent" />
            <div className="eyebrow">{tag}</div>
            <h3>{title}</h3>
            <p>{text}</p>
          </Panel>
        ))}
      </div>
      <Panel title="From physical signal to accountable care" kicker="SYSTEM ARCHITECTURE">
        <div className="architecture">
          {[
            { icon: Radio, title: 'Sense', text: 'MPU6050 · BH1750 · BMP280' },
            { icon: Wifi, title: 'Transmit', text: 'ESP32-C3 · HTTPS · device token' },
            { icon: Cloud, title: 'Validate', text: 'Edge Function · hashed credentials' },
            { icon: Database, title: 'Preserve', text: 'Postgres · RLS · audit trail' },
            { icon: ShieldCheck, title: 'Decide', text: 'Realtime console · doctor verdict' },
          ].map(({ icon: Icon, title, text }, i) => (
            <div key={title}>
              <span className="architecture-node">
                <Icon size={25} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
              {i < 4 && <ArrowRight size={18} className="architecture-arrow" />}
            </div>
          ))}
        </div>
        <div className="notice">
          <LockKeyhole size={17} />
          <span>
            The device holds its own secret. Supabase service-role credentials stay inside the Edge
            Function. Staff permissions are enforced by the database.
          </span>
        </div>
      </Panel>
      <div className="roadmap-grid">
        <Panel title="Motor-driven tube rotation" kicker="MECHANICAL SYSTEM / INFORMATIONAL">
          <RotateCw size={30} className="accent" />
          <p>
            The capsule includes a motor-driven test-tube rotation mechanism. This interface does
            not claim to measure rotation speed or control the motor. Operation must follow the
            specimen-specific laboratory protocol.
          </p>
          <Badge value="idle">Hardware information</Badge>
        </Panel>
        <Panel title="MR-damper vibration isolation" kicker="RESEARCH ROADMAP / FUTURE WORK">
          <Activity size={30} className="muted" />
          <p>
            A planned magnetorheological damper will investigate vibration isolation during
            transport. Damper telemetry and control are outside the present sensor suite and are not
            shown as live measurements.
          </p>
          <Badge value="warning">Future investigation</Badge>
        </Panel>
      </div>
    </>
  );
}
