import { z } from 'zod';
export const readingSchema = z
  .object({
    device_uid: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    recorded_at: z.string().datetime({ offset: true }),
    temp_c: z.number().finite().min(-40).max(85),
    pressure_hpa: z.number().finite().min(300).max(1200),
    sea_level_pressure_hpa: z.number().finite().min(800).max(1100).optional(),
    reference_pressure_hpa: z.number().finite().min(300).max(1200).optional(),
    height_reference_at: z.string().datetime({ offset: true }).optional(),
    lux: z.number().finite().min(0).max(65535),
    ax: z.number().finite().min(-16).max(16),
    ay: z.number().finite().min(-16).max(16),
    az: z.number().finite().min(-16).max(16),
    gx: z.number().finite().min(-2000).max(2000).default(0),
    gy: z.number().finite().min(-2000).max(2000).default(0),
    gz: z.number().finite().min(-2000).max(2000).default(0),
    pitch_deg: z.number().finite().min(-180).max(180),
    roll_deg: z.number().finite().min(-180).max(180),
    shock_g: z.number().finite().min(0).max(28),
    rssi: z.number().int().min(-127).max(0),
    simulated: z.boolean().default(false),
  })
  .strict()
  .superRefine((r, ctx) => {
    if ((r.reference_pressure_hpa === undefined) !== (r.height_reference_at === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['height_reference_at'],
        message: 'Height reference pressure and timestamp must be supplied together',
      });
    if (r.height_reference_at && Date.parse(r.height_reference_at) > Date.parse(r.recorded_at))
      ctx.addIssue({
        code: 'custom',
        path: ['height_reference_at'],
        message: 'Height reference cannot be newer than the reading',
      });
  });
export const telemetrySchema = z.union([
  readingSchema,
  z
    .object({ readings: z.array(readingSchema).min(1).max(16) })
    .strict()
    .refine(
      ({ readings }) => readings.every((r) => r.device_uid === readings[0].device_uid),
      'All readings in a batch must belong to the same device',
    ),
]);
export function validateTimestamp(timestamp: string, now = Date.now()) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now + 30000 && time >= now - 86400000;
}
export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
