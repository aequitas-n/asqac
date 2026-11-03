import { motion, useReducedMotion } from 'framer-motion';
import { number } from '../../lib/format';
import { NumberTicker } from './LiveText';
export function Gauge({
  value,
  min = 0,
  max = 12,
  safeMin,
  safeMax,
  label,
  unit,
  sensor,
}: {
  value?: number;
  min?: number;
  max?: number;
  safeMin?: number;
  safeMax?: number;
  label: string;
  unit: string;
  sensor: string;
}) {
  const reduce = useReducedMotion();
  const clamp = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const circumference = 251.3;
  const bad =
    value !== undefined &&
    ((safeMin !== undefined && value < safeMin) || (safeMax !== undefined && value > safeMax));
  const color = bad ? '#d84348' : '#0e6e73';
  return (
    <div
      className="gauge"
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={value === undefined ? 'Waiting for telemetry' : `${value.toFixed(1)} ${unit}`}
    >
      <div className="widget-label">
        {label}
        <span className="sensor-label">{sensor}</span>
      </div>
      <div className="gauge-visual">
        <svg viewBox="0 0 210 130">
          <path
            d="M25 108A80 80 0 0 1 185 108"
            stroke="#e4ebee"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />
          {safeMin !== undefined && safeMax !== undefined && (
            <path
              d="M25 108A80 80 0 0 1 185 108"
              stroke="#0e6e73"
              strokeOpacity=".3"
              strokeWidth="8"
              fill="none"
              strokeDasharray={`${(clamp(safeMax) - clamp(safeMin)) * circumference} ${circumference}`}
              strokeDashoffset={-clamp(safeMin) * circumference}
            />
          )}
          <motion.path
            d="M25 108A80 80 0 0 1 185 108"
            stroke={color}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: value === undefined ? 0 : clamp(value) }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          />
          <text
            x="105"
            y="94"
            textAnchor="middle"
            fill={color}
            fontSize="38"
            fontFamily="var(--mono)"
          >
            <NumberTicker value={value} digits={1} svg />
          </text>
          <text x="105" y="116" textAnchor="middle" fill="#7e8f97" fontSize="11">
            {unit}
          </text>
        </svg>
      </div>
      <div className="gauge-foot">
        <span>
          {safeMin !== undefined ? `${safeMin}–${safeMax} ${unit} target` : `${min}–${max} ${unit}`}
        </span>
        <span className={bad ? 'text-critical' : 'accent'}>
          {value === undefined
            ? 'Awaiting'
            : bad
              ? 'Outside band'
              : safeMin === undefined && safeMax === undefined
                ? 'Measured'
                : 'In range'}
        </span>
      </div>
    </div>
  );
}
export function Meter({
  value,
  max,
  label,
  unit,
  sensor,
}: {
  value?: number;
  max?: number;
  label: string;
  unit: string;
  sensor: string;
}) {
  const bad = value !== undefined && max !== undefined && value > max;
  return (
    <div className="meter">
      <div className="widget-label">
        {label}
        <span className="sensor-label">{sensor}</span>
      </div>
      <div className={`meter-value ${bad ? 'text-critical' : ''}`}>
        <NumberTicker value={value} digits={1} />
        <small>{unit}</small>
      </div>
      <div className="meter-track">
        {Array.from({ length: 24 }, (_, i) => (
          <span
            key={i}
            className={
              value !== undefined &&
              i / 24 < Math.min(1, value / (Math.max(max ?? (unit === 'lx' ? 1000 : 8), 1) * 1.4))
                ? bad
                  ? 'lit bad'
                  : 'lit'
                : ''
            }
          />
        ))}
      </div>
      <div className="gauge-foot">
        <span>{max !== undefined ? `Limit ${max} ${unit}` : 'No active profile'}</span>
        <span className={bad ? 'text-critical' : 'muted'}>
          {value === undefined
            ? 'Awaiting'
            : bad
              ? unit === 'lx'
                ? 'Exposure detected'
                : 'Limit exceeded'
              : max === undefined
                ? 'Measured'
                : 'Within limit'}
        </span>
      </div>
    </div>
  );
}
export function BubbleLevel({ pitch, roll }: { pitch?: number; roll?: number }) {
  return (
    <div
      className="bubble-widget"
      aria-label={
        pitch === undefined
          ? 'Orientation awaiting telemetry'
          : `Pitch ${pitch.toFixed(1)}°, roll ${roll?.toFixed(1)}°`
      }
    >
      <div className="bubble-level">
        <span className="level-h" />
        <span className="level-v" />
        <span className="level-circle" />
        <span
          className="level-bubble"
          style={{
            transform: `translate(${Math.max(-40, Math.min(40, (roll ?? 0) / 2))}px,${Math.max(-40, Math.min(40, (pitch ?? 0) / 2))}px)`,
            opacity: pitch === undefined ? 0.25 : 1,
          }}
        />
      </div>
      <div className="bubble-values">
        <span>
          PITCH <b>{number(pitch)}°</b>
        </span>
        <span>
          ROLL <b>{number(roll)}°</b>
        </span>
      </div>
    </div>
  );
}
