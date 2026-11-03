-- ASQAC / single-hospital staff workspace. All writes use audited RPCs.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null, full_name text not null default '',
  role text not null default 'technician' check (role in ('technician','doctor','admin'))
);
create table public.handling_profiles (
  id uuid primary key default gen_random_uuid(), code text unique not null, name text not null,
  specimen_type text not null check (specimen_type in ('BLOOD','URINE','PLASMA','TISSUE','SWAB','VACCINE')),
  temp_min_c double precision not null, temp_max_c double precision not null,
  max_transport_min integer not null check (max_transport_min between 1 and 1440),
  max_shock_g double precision not null check (max_shock_g > 1),
  max_tilt_deg double precision not null check (max_tilt_deg between 1 and 180),
  max_lux double precision not null check (max_lux >= 0),
  pressure_min_hpa double precision not null default 850, pressure_max_hpa double precision not null default 1100,
  freezing_risk boolean not null default false, lab_confirmation_req boolean not null default true,
  notes text not null, source_refs text[] not null default '{}',
  check (temp_min_c < temp_max_c), check (pressure_min_hpa < pressure_max_hpa)
);
create table public.capsules (
  id uuid primary key default gen_random_uuid(), code text unique not null, label text not null,
  status text not null default 'idle' check (status in ('idle','prepared','in_transit','arrived','alert','charging','maintenance')),
  firmware_ver text not null default '1.0.0', last_seen_at timestamptz
);
create table public.devices (
  id uuid primary key default gen_random_uuid(), capsule_id uuid not null references public.capsules,
  device_uid text unique not null check (length(device_uid) between 3 and 80),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'), active boolean not null default true,
  last_ingested_at timestamptz, created_at timestamptz not null default now()
);
create unique index one_active_device_per_capsule on public.devices(capsule_id) where active;
create sequence public.specimen_code_seq;
create sequence public.transport_code_seq;
create table public.specimens (
  id uuid primary key default gen_random_uuid(),
  specimen_code text unique not null default ('SP-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('public.specimen_code_seq')::text,5,'0')),
  patient_ref text not null check (length(patient_ref) between 2 and 80),
  requested_test text not null check (length(requested_test) between 2 and 160),
  specimen_type text not null check (specimen_type in ('BLOOD','URINE','PLASMA','TISSUE','SWAB','VACCINE')),
  priority text not null check (priority in ('routine','urgent','critical')),
  handling_profile_id uuid not null references public.handling_profiles,
  origin text not null check (length(origin) between 2 and 100), destination_lab text not null check (length(destination_lab) between 2 and 100),
  clinical_notice text not null default '' check (length(clinical_notice)<=2000),
  registered_by uuid references public.profiles on delete set null, created_at timestamptz not null default now()
);
create table public.transports (
  id uuid primary key default gen_random_uuid(),
  transport_code text unique not null default ('TR-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('public.transport_code_seq')::text,5,'0')),
  capsule_id uuid not null references public.capsules, specimen_id uuid unique not null references public.specimens,
  handling_profile_id uuid not null references public.handling_profiles, profile_snapshot jsonb not null,
  state text not null default 'registered' check (state in ('registered','prepared','in_transit','arrived','closed')),
  started_at timestamptz, arrived_at timestamptz, closed_at timestamptz,
  started_by uuid references public.profiles on delete set null, received_by uuid references public.profiles on delete set null,
  verdict text not null default 'pending' check (verdict in ('pending','accept','review_required','reject')),
  verdict_notes text, verdict_at timestamptz, excursion_count integer not null default 0,
  critical_excursion_count integer not null default 0 check(critical_excursion_count>=0 and critical_excursion_count<=excursion_count),
  telemetry_summary jsonb not null default '{"count":0,"simulated_count":0,"temp_min":null,"temp_max":null,"shock_max":null,"light_max":null,"tilt_max":null,"first_at":null,"last_at":null,"gap_count":0}',
  created_at timestamptz not null default now(),
  check (verdict not in ('review_required','reject') or length(trim(verdict_notes)) >= 5),
  check ((state='closed' and verdict<>'pending' and verdict_at is not null and closed_at is not null) or (state<>'closed' and verdict='pending')),
  check (state not in ('in_transit','arrived','closed') or started_at is not null),
  check (state not in ('arrived','closed') or arrived_at is not null)
);
create unique index one_open_transport_per_capsule on public.transports(capsule_id) where state<>'closed';
create index transports_started on public.transports(started_at desc);
create table public.readings (
  id bigint generated always as identity primary key, capsule_id uuid not null references public.capsules,
  transport_id uuid references public.transports, device_uid text not null references public.devices(device_uid),
  recorded_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
  temp_c double precision not null check (temp_c between -40 and 85),
  pressure_hpa double precision not null check (pressure_hpa between 300 and 1200),
  lux double precision not null check (lux between 0 and 65535),
  ax double precision not null check (ax between -16 and 16), ay double precision not null check (ay between -16 and 16), az double precision not null check (az between -16 and 16),
  gx double precision not null default 0 check (gx between -2000 and 2000), gy double precision not null default 0 check (gy between -2000 and 2000), gz double precision not null default 0 check (gz between -2000 and 2000),
  pitch_deg double precision not null check (pitch_deg between -180 and 180), roll_deg double precision not null check (roll_deg between -180 and 180),
  shock_g double precision not null check (shock_g between 0 and 28), rssi integer not null check (rssi between -127 and 0),
  simulated boolean not null default false, unique(device_uid, recorded_at)
);
create index readings_capsule_time on public.readings(capsule_id, recorded_at desc);
create index readings_transport_time on public.readings(transport_id, recorded_at);
create index readings_retention on public.readings(received_at);
create table public.alerts (
  id uuid primary key default gen_random_uuid(), capsule_id uuid not null references public.capsules,
  transport_id uuid not null references public.transports, severity text not null check (severity in ('critical','warning','info')),
  alert_type text not null check (alert_type in ('temperature','shock','light','tilt','pressure','delay','connectivity')),
  title text not null, message text not null, reading_id bigint references public.readings on delete set null,
  acknowledged boolean not null default false, acknowledged_by uuid references public.profiles on delete set null,
  acknowledged_at timestamptz, created_at timestamptz not null default now(), resolved_at timestamptz
);
create unique index one_active_excursion on public.alerts(transport_id,alert_type) where resolved_at is null;
create index alerts_created on public.alerts(created_at desc);
create table public.audit_log (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles on delete set null,
  actor_label text not null, action text not null, entity_type text not null, entity_id uuid not null,
  detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index audit_created on public.audit_log(created_at desc);
create index audit_entity on public.audit_log(entity_id,created_at);

create function public.staff_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid();
$$;
create function public.provision_staff_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,email,full_name,role) values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','Staff member'),'technician');
  return new;
end;
$$;
create trigger provision_staff after insert on auth.users for each row execute function public.provision_staff_profile();

alter table public.profiles enable row level security;
alter table public.handling_profiles enable row level security;
alter table public.capsules enable row level security;
alter table public.devices enable row level security;
alter table public.specimens enable row level security;
alter table public.transports enable row level security;
alter table public.readings enable row level security;
alter table public.alerts enable row level security;
alter table public.audit_log enable row level security;
create policy staff_read_profiles on public.profiles for select to authenticated using (id=auth.uid() or public.staff_role()='admin');
create policy staff_read_handling on public.handling_profiles for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
create policy staff_read_capsules on public.capsules for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
create policy staff_read_specimens on public.specimens for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
create policy staff_read_transports on public.transports for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
create policy staff_read_readings on public.readings for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
create policy staff_read_alerts on public.alerts for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
create policy staff_read_audit on public.audit_log for select to authenticated using (public.staff_role() in ('technician','doctor','admin'));
-- No devices SELECT policy: token hashes never leave the service role.
create policy devices_no_client_access on public.devices for all to authenticated using (false) with check (false);
revoke all on public.profiles,public.handling_profiles,public.capsules,public.devices,public.specimens,public.transports,public.readings,public.alerts,public.audit_log from anon, authenticated;
grant select on public.profiles,public.handling_profiles,public.capsules,public.specimens,public.transports,public.readings,public.alerts,public.audit_log to authenticated;
grant all on public.profiles,public.handling_profiles,public.capsules,public.devices,public.specimens,public.transports,public.readings,public.alerts,public.audit_log to service_role;
grant usage, select on public.specimen_code_seq,public.transport_code_seq,public.readings_id_seq,public.audit_log_id_seq to service_role;
revoke all on function public.provision_staff_profile() from public;
revoke all on function public.staff_role() from public;
grant execute on function public.staff_role() to authenticated;
