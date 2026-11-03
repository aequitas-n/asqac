export type Role = 'technician' | 'doctor' | 'admin';
export type SpecimenType = 'BLOOD' | 'URINE' | 'PLASMA' | 'TISSUE' | 'SWAB' | 'VACCINE';
export type CapsuleStatus =
  'idle' | 'prepared' | 'in_transit' | 'arrived' | 'alert' | 'charging' | 'maintenance';
export type TransportState = 'registered' | 'prepared' | 'in_transit' | 'arrived' | 'closed';
export type Verdict = 'pending' | 'accept' | 'review_required' | 'reject';
export type Severity = 'critical' | 'warning' | 'info';
export type AlertType =
  'temperature' | 'shock' | 'light' | 'tilt' | 'pressure' | 'delay' | 'connectivity';
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}
export interface HandlingProfile {
  id: string;
  code: string;
  name: string;
  specimen_type: SpecimenType;
  temp_min_c: number;
  temp_max_c: number;
  max_transport_min: number;
  max_shock_g: number;
  max_tilt_deg: number;
  max_lux: number;
  pressure_min_hpa: number;
  pressure_max_hpa: number;
  freezing_risk: boolean;
  lab_confirmation_req: boolean;
  notes: string;
  source_refs: string[];
}
export interface Capsule {
  id: string;
  code: string;
  label: string;
  status: CapsuleStatus;
  firmware_ver: string;
  last_seen_at: string | null;
}
export interface Specimen {
  id: string;
  specimen_code: string;
  patient_ref: string;
  requested_test: string;
  specimen_type: SpecimenType;
  priority: 'routine' | 'urgent' | 'critical';
  handling_profile_id: string;
  origin: string;
  destination_lab: string;
  clinical_notice: string;
  registered_by: string | null;
  created_at: string;
}
export interface Transport {
  id: string;
  transport_code: string;
  capsule_id: string;
  specimen_id: string;
  handling_profile_id: string;
  profile_snapshot: HandlingProfile;
  state: TransportState;
  started_at: string | null;
  arrived_at: string | null;
  closed_at: string | null;
  started_by: string | null;
  received_by: string | null;
  verdict: Verdict;
  verdict_notes: string | null;
  verdict_at: string | null;
  excursion_count: number;
  critical_excursion_count: number;
  created_at: string;
  telemetry_summary: TelemetrySummary | null;
}
export interface TelemetrySummary {
  count: number;
  temp_min: number | null;
  temp_max: number | null;
  shock_max: number | null;
  light_max: number | null;
  tilt_max: number | null;
  simulated_count: number;
  first_at: string | null;
  last_at: string | null;
  gap_count?: number;
  altitude_min_m?: number | null;
  altitude_max_m?: number | null;
  height_change_min_m?: number | null;
  height_change_max_m?: number | null;
  height_reference_at?: string | null;
  height_reference_changed?: boolean;
}
export interface Reading {
  id: number;
  capsule_id: string;
  transport_id: string | null;
  device_uid: string;
  recorded_at: string;
  received_at: string;
  temp_c: number;
  pressure_hpa: number;
  sea_level_pressure_hpa?: number;
  reference_pressure_hpa?: number | null;
  height_reference_at?: string | null;
  altitude_m?: number | null;
  height_change_m?: number | null;
  lux: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  pitch_deg: number;
  roll_deg: number;
  shock_g: number;
  rssi: number;
  simulated: boolean;
}
export interface Alert {
  id: string;
  capsule_id: string;
  transport_id: string;
  severity: Severity;
  alert_type: AlertType;
  title: string;
  message: string;
  reading_id: number | null;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  resolved_at: string | null;
}
export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_label: string;
  action: string;
  entity_type: string;
  entity_id: string;
  detail: Record<string, unknown>;
  created_at: string;
}
export interface DeviceInfo {
  device_uid: string;
  capsule_id: string;
}
export interface RegistrationInput {
  patient_ref: string;
  requested_test: string;
  specimen_type: SpecimenType;
  handling_profile_id: string;
  priority: 'routine' | 'urgent' | 'critical';
  origin: string;
  destination_lab: string;
  clinical_notice: string;
  capsule_id: string;
}
