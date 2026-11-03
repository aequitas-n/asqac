import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
} from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import type { HandlingProfile, Reading } from '../../types';
import { Empty } from '../ui';
import { withBarometry } from '../../lib/barometry';
export type Trend =
  'temp_c' | 'pressure_hpa' | 'lux' | 'shock_g' | 'altitude_m' | 'height_change_m';
const names: Record<Trend, { label: string; unit: string }> = {
  temp_c: { label: 'Temperature', unit: '°C' },
  pressure_hpa: { label: 'Pressure', unit: 'hPa' },
  lux: { label: 'Ambient light', unit: 'lx' },
  shock_g: { label: 'Shock peak', unit: 'g' },
  altitude_m: { label: 'Estimated barometric altitude', unit: 'm' },
  height_change_m: { label: 'Relative height change', unit: 'm' },
};
export const TrendChart = memo(function TrendChart({
  readings,
  profile,
  metric = 'temp_c',
  height = 260,
}: {
  readings: Reading[];
  profile?: HandlingProfile;
  metric?: Trend;
  height?: number;
}) {
  if (!readings.length)
    return (
      <div style={{ minHeight: height }}>
        <Empty />
      </div>
    );
  const derived = readings.map(withBarometry);
  const rows = derived.flatMap((r, i) => {
    const row = { ...r, time: Date.parse(r.recorded_at) };
    // Do not draw a false displacement connecting two different startup zeroes.
    return metric === 'height_change_m' &&
      i > 0 &&
      r.height_reference_at !== derived[i - 1].height_reference_at
      ? [{ ...row, time: row.time - 0.01, height_change_m: null }, row]
      : [row];
  });
  const values = derived
    .map((r) => r[metric])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!values.length)
    return (
      <div style={{ minHeight: height }}>
        <Empty
          title="Height reference unavailable"
          description="This reading has no startup pressure baseline. Upload the updated firmware and keep the capsule still during calibration."
        />
      </div>
    );
  const min =
    metric === 'temp_c' && profile
      ? Math.min(profile.temp_min_c - 2, ...values)
      : Math.min(...values);
  const max =
    metric === 'temp_c' && profile
      ? Math.max(profile.temp_max_c + 2, ...values)
      : Math.max(...values);
  return (
    <div
      className="chart"
      role="img"
      aria-label={`${names[metric].label} trend: ${readings.length} readings. Latest ${values.at(-1)?.toFixed(1)} ${names[metric].unit}.`}
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ top: 14, right: 16, left: -15, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e5ecef" strokeDasharray="3 5" />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(n) =>
              new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
            minTickGap={55}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: '#87969d' }}
          />
          <YAxis
            domain={[Math.floor(min - 1), Math.ceil(max + 1)]}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: '#87969d' }}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #e3e9ed',
              borderRadius: 10,
              color: '#253c44',
              fontSize: 12,
            }}
            labelFormatter={(n) => new Date(Number(n)).toLocaleTimeString()}
            formatter={(n: number) => [
              `${n.toFixed(2)} ${names[metric].unit}`,
              names[metric].label,
            ]}
          />
          {metric === 'temp_c' && profile && (
            <ReferenceArea
              y1={profile.temp_min_c}
              y2={profile.temp_max_c}
              fill="#0e6e73"
              fillOpacity={0.07}
              stroke="#0e6e73"
              strokeOpacity={0.16}
              strokeDasharray="4 4"
            />
          )}
          <Area
            type="monotone"
            dataKey={metric}
            stroke="#0e6e73"
            strokeWidth={2}
            fill="#0e6e73"
            fillOpacity={0.04}
            isAnimationActive={false}
            connectNulls={false}
            dot={rows.length < 3}
            activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});
export function Sparkline({ readings }: { readings: Reading[] }) {
  const reduce = useReducedMotion();
  if (readings.length < 2) return <div className="spark-empty">— awaiting stream —</div>;
  return (
    <div className="spark" aria-label="Recent temperature trend">
      <ResponsiveContainer width="100%" height={42}>
        <LineChart data={readings}>
          <Line
            dataKey="temp_c"
            stroke="#0e6e73"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={!reduce}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export function DeliveryChart({
  data,
}: {
  data: { day: string; deliveries: number; excursions: number }[];
}) {
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={245}>
      <ComposedChart data={data} margin={{ left: -20, right: 10, top: 15 }}>
        <CartesianGrid vertical={false} stroke="#e5ecef" strokeDasharray="3 5" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: '#87969d' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 10, fill: '#87969d' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ background: '#ffffff', border: '1px solid #e3e9ed', borderRadius: 10 }}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar
          name="Deliveries"
          dataKey="deliveries"
          fill="#0e6e73"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={!reduce}
        />
        <Line
          name="Excursions"
          dataKey="excursions"
          type="monotone"
          stroke="#cf9b55"
          strokeWidth={2}
          isAnimationActive={!reduce}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
