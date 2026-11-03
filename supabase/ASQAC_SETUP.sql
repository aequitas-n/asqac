-- ASQAC setup for chhpbpqoaikbcicxdnzj
-- Paste this entire file into the Supabase SQL Editor as postgres.
-- Includes role policies, audited RPCs, Realtime, closed synthetic history,
-- confirmed demo accounts, and the hashed CAP0001 device token.
-- Re-running skips completed migrations; it never drops clinical records.

begin;
create table if not exists public.asqac_schema_migrations(version text primary key,applied_at timestamptz not null default now());
alter table public.asqac_schema_migrations enable row level security;
revoke all on public.asqac_schema_migrations from anon,authenticated;
grant all on public.asqac_schema_migrations to service_role;

-- 202611020001_schema.sql
do $asqac_202611020001$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611020001') then
    execute $source_202611020001$
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

$source_202611020001$;
    insert into public.asqac_schema_migrations(version) values('202611020001');
  end if;
end;
$asqac_202611020001$;

-- 202611020002_workflows.sql
do $asqac_202611020002$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611020002') then
    execute $source_202611020002$
create function public.write_audit(p_action text,p_entity_type text,p_entity_id uuid,p_detail jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(actor_id,actor_label,action,entity_type,entity_id,detail)
  values(auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'ASQAC ingestion'),p_action,p_entity_type,p_entity_id,p_detail);
end;
$$;
create function public.register_specimen(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.capsules; p public.handling_profiles; s public.specimens; t public.transports;
begin
  if coalesce(public.staff_role(),'') not in ('technician','admin') then raise exception 'Technician role required' using errcode='42501'; end if;
  select * into c from public.capsules where id=(p_input->>'capsule_id')::uuid for update;
  if not found or c.status<>'idle' or exists(select 1 from public.transports where capsule_id=c.id and state<>'closed') then raise exception 'This capsule is no longer available. Choose another capsule.'; end if;
  select * into p from public.handling_profiles where id=(p_input->>'handling_profile_id')::uuid;
  if not found or p.specimen_type is distinct from p_input->>'specimen_type' then raise exception 'Select a handling profile for this specimen type'; end if;
  insert into public.specimens(patient_ref,requested_test,specimen_type,priority,handling_profile_id,origin,destination_lab,clinical_notice,registered_by)
  values(trim(p_input->>'patient_ref'),trim(p_input->>'requested_test'),p.specimen_type,p_input->>'priority',p.id,trim(p_input->>'origin'),trim(p_input->>'destination_lab'),coalesce(trim(p_input->>'clinical_notice'),''),auth.uid()) returning * into s;
  insert into public.transports(capsule_id,specimen_id,handling_profile_id,profile_snapshot) values(c.id,s.id,p.id,to_jsonb(p)) returning * into t;
  update public.capsules set status='prepared' where id=c.id;
  perform public.write_audit('Specimen registered','transport',t.id,jsonb_build_object('specimen_code',s.specimen_code,'capsule_code',c.code,'transport_code',t.transport_code,'profile_code',p.code));
  return jsonb_build_object('specimen',to_jsonb(s),'transport',to_jsonb(t));
end;
$$;
create function public.transition_transport(p_transport uuid,p_action text,p_verdict text default null,p_notes text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.transports; role_name text:=public.staff_role();
begin
  -- Serialize against ingestion and other transport actions with the capsule lock first.
  perform 1 from public.capsules where id=(select capsule_id from public.transports where id=p_transport) for update;
  select * into t from public.transports where id=p_transport for update;
  if not found then raise exception 'Transport not found'; end if;
  if p_action in ('prepare','start') then
    if coalesce(role_name,'') not in ('technician','admin') then raise exception 'Technician role required' using errcode='42501'; end if;
    if p_action='prepare' and t.state='registered' then
      update public.transports set state='prepared' where id=t.id;
    elsif p_action='start' and t.state='prepared' then
      update public.transports set state='in_transit',started_at=now(),started_by=auth.uid() where id=t.id;
      update public.capsules set status='in_transit' where id=t.capsule_id;
    else raise exception 'Transport state changed. Refresh and try again.'; end if;
  elsif p_action in ('arrive','close') then
    if coalesce(role_name,'') not in ('doctor','admin') then raise exception 'Doctor role required' using errcode='42501'; end if;
    if p_action='arrive' and t.state='in_transit' then
      if coalesce((t.telemetry_summary->>'last_at')::timestamptz,t.started_at)<now()-interval '2 minutes' or coalesce((t.telemetry_summary->>'count')::int,0)=0 then
        perform public.raise_excursion(t.id,t.capsule_id,'connectivity','warning','Telemetry coverage incomplete at receiving','No recent telemetry at receiving; inspect the full handling record.');
      end if;
      if now()>t.started_at+make_interval(mins=>(t.profile_snapshot->>'max_transport_min')::int) then
        perform public.raise_excursion(t.id,t.capsule_id,'delay','warning','Transport time exceeded','Receiving handoff occurred after the profile time limit.');
      end if;
      update public.transports set state='arrived',arrived_at=now(),received_by=auth.uid() where id=t.id;
      update public.capsules set status='arrived' where id=t.capsule_id;
      update public.alerts set resolved_at=now() where transport_id=t.id and resolved_at is null;
    elsif p_action='close' and t.state='arrived' then
      if p_verdict is null or p_verdict not in ('accept','review_required','reject') then raise exception 'Choose a final verdict'; end if;
      if p_verdict in ('review_required','reject') and coalesce(length(trim(p_notes)),0)<5 then raise exception 'A clinical explanation of at least 5 characters is required'; end if;
      if coalesce(length(p_notes),0)>2000 then raise exception 'Notes must be at most 2000 characters'; end if;
      update public.transports set state='closed',closed_at=now(),verdict=p_verdict,verdict_notes=trim(p_notes),verdict_at=now(),received_by=auth.uid() where id=t.id;
      update public.capsules set status='idle' where id=t.capsule_id;
    else raise exception 'Transport state changed. Refresh and try again.'; end if;
  else raise exception 'Unknown transport action'; end if;
  perform public.write_audit(case p_action when 'prepare' then 'Transport prepared' when 'start' then 'Transport started' when 'arrive' then 'Transport received' else 'Final verdict recorded' end,'transport',t.id,jsonb_build_object('transport_code',t.transport_code,'verdict',p_verdict,'notes',p_notes));
  return (select to_jsonb(x) from public.transports x where id=t.id);
end;
$$;
create function public.acknowledge_alert(p_alert uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.alerts;
begin
  if coalesce(public.staff_role(),'') not in ('technician','doctor','admin') then raise exception 'Staff role required' using errcode='42501'; end if;
  select * into a from public.alerts where id=p_alert for update;
  if not found then raise exception 'Alert not found'; end if;
  if a.acknowledged then return; end if;
  update public.alerts set acknowledged=true,acknowledged_by=auth.uid(),acknowledged_at=now() where id=a.id;
  perform public.write_audit('Alert acknowledged','transport',a.transport_id,jsonb_build_object('alert_id',a.id,'type',a.alert_type,'severity',a.severity));
end;
$$;
create function public.raise_excursion(p_transport uuid,p_capsule uuid,p_type text,p_severity text,p_title text,p_message text,p_reading bigint default null) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
  insert into public.alerts(transport_id,capsule_id,alert_type,severity,title,message,reading_id)
  values(p_transport,p_capsule,p_type,p_severity,p_title,p_message,p_reading)
  on conflict (transport_id,alert_type) where resolved_at is null do nothing returning id into a;
  if a is not null then
    update public.transports set excursion_count=excursion_count+1,critical_excursion_count=critical_excursion_count+case when p_severity='critical' then 1 else 0 end where id=p_transport;
    perform public.write_audit('Handling excursion detected','transport',p_transport,jsonb_build_object('alert_id',a,'type',p_type,'severity',p_severity,'message',p_message));
  elsif p_severity='critical' then
    update public.alerts set severity='critical',message=p_message where transport_id=p_transport and alert_type=p_type and resolved_at is null and severity<>'critical' returning id into a;
    if a is not null then
      update public.transports set critical_excursion_count=critical_excursion_count+1 where id=p_transport;
      perform public.write_audit('Excursion severity escalated','transport',p_transport,jsonb_build_object('alert_id',a,'type',p_type,'severity','critical','message',p_message));
    end if;
  end if;
end;
$$;
create function public.ingest_reading(p_uid text,p_hash text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; t public.transports; r public.readings; p jsonb; summary jsonb; stamp timestamptz; breach boolean; kind text; severity text; message text; old_id bigint; fresh boolean;
begin
  -- Lock order capsule -> device -> transport matches the workflow RPC.
  perform 1 from public.capsules where id=(select capsule_id from public.devices where device_uid=p_uid and active and token_hash=p_hash) for update;
  select * into d from public.devices where device_uid=p_uid and active and token_hash=p_hash for update;
  if not found then raise exception 'Invalid device credentials' using errcode='28000'; end if;
  stamp:=(p_payload->>'recorded_at')::timestamptz;
  if stamp is null or stamp>clock_timestamp()+interval '30 seconds' or stamp<clock_timestamp()-interval '24 hours' then raise exception 'Timestamp outside allowed window'; end if;
  select id into old_id from public.readings where device_uid=p_uid and recorded_at=stamp;
  if old_id is not null then return jsonb_build_object('ok',true,'duplicate',true,'reading_id',old_id); end if;
  if d.last_ingested_at>clock_timestamp()-interval '2 seconds' then raise exception 'Device rate limit: wait 2 seconds' using errcode='P0001'; end if;
  -- Timestamp membership prevents offline packets being assigned to a new journey.
  select * into t from public.transports where capsule_id=d.capsule_id and started_at<=stamp and (arrived_at is null or stamp<=arrived_at) and state in ('in_transit','arrived','closed') order by started_at desc limit 1 for update;
  if t.state='closed' then raise exception 'Transport already reviewed; late readings need manual review'; end if;
  insert into public.readings(capsule_id,transport_id,device_uid,recorded_at,temp_c,pressure_hpa,lux,ax,ay,az,gx,gy,gz,pitch_deg,roll_deg,shock_g,rssi,simulated)
  values(d.capsule_id,t.id,p_uid,stamp,(p_payload->>'temp_c')::float8,(p_payload->>'pressure_hpa')::float8,(p_payload->>'lux')::float8,(p_payload->>'ax')::float8,(p_payload->>'ay')::float8,(p_payload->>'az')::float8,coalesce((p_payload->>'gx')::float8,0),coalesce((p_payload->>'gy')::float8,0),coalesce((p_payload->>'gz')::float8,0),(p_payload->>'pitch_deg')::float8,(p_payload->>'roll_deg')::float8,(p_payload->>'shock_g')::float8,(p_payload->>'rssi')::int,coalesce((p_payload->>'simulated')::boolean,false)) returning * into r;
  update public.devices set last_ingested_at=clock_timestamp() where id=d.id;
  fresh:=stamp>clock_timestamp()-interval '2 minutes';
  -- Exact receive heartbeat; do not refresh it with old buffered observations.
  update public.capsules set last_seen_at=clock_timestamp() where id=d.capsule_id and fresh;
  if t.id is not null then
    p:=t.profile_snapshot; summary:=t.telemetry_summary;
    update public.transports set telemetry_summary=jsonb_build_object(
      'count',coalesce((summary->>'count')::int,0)+1,
      'simulated_count',coalesce((summary->>'simulated_count')::int,0)+case when r.simulated then 1 else 0 end,
      'temp_min',least((summary->>'temp_min')::float8,r.temp_c),'temp_max',greatest((summary->>'temp_max')::float8,r.temp_c),
      'shock_max',greatest((summary->>'shock_max')::float8,r.shock_g),'light_max',greatest((summary->>'light_max')::float8,r.lux),
      'tilt_max',greatest((summary->>'tilt_max')::float8,abs(r.pitch_deg),abs(r.roll_deg)),
      'first_at',least((summary->>'first_at')::timestamptz,stamp),'last_at',greatest((summary->>'last_at')::timestamptz,stamp),
      'gap_count',coalesce((summary->>'gap_count')::int,0)+case when stamp>coalesce((summary->>'last_at')::timestamptz,t.started_at)+interval '2 minutes' then 1 else 0 end
    ) where id=t.id;
    foreach kind in array array['temperature','shock','tilt','light','pressure','delay','connectivity'] loop
      severity:='warning';
      case kind
        when 'temperature' then breach:=r.temp_c<(p->>'temp_min_c')::float8 or r.temp_c>(p->>'temp_max_c')::float8; if r.temp_c<(p->>'temp_min_c')::float8-2 or r.temp_c>(p->>'temp_max_c')::float8+2 then severity:='critical';end if;message:=format('Temperature %s °C; target %s–%s °C.',r.temp_c,p->>'temp_min_c',p->>'temp_max_c');
        when 'shock' then breach:=r.shock_g>(p->>'max_shock_g')::float8;severity:='critical';message:=format('Impact peak %s g; limit %s g.',r.shock_g,p->>'max_shock_g');
        when 'tilt' then breach:=greatest(abs(r.pitch_deg),abs(r.roll_deg))>(p->>'max_tilt_deg')::float8;message:=format('Pitch %s°, roll %s°; limit %s°.',r.pitch_deg,r.roll_deg,p->>'max_tilt_deg');
        when 'light' then breach:=r.lux>(p->>'max_lux')::float8;message:=format('Light %s lx; limit %s lx. Possible lid opening.',r.lux,p->>'max_lux');
        when 'pressure' then breach:=r.pressure_hpa<(p->>'pressure_min_hpa')::float8 or r.pressure_hpa>(p->>'pressure_max_hpa')::float8;message:=format('Pressure %s hPa; band %s–%s hPa.',r.pressure_hpa,p->>'pressure_min_hpa',p->>'pressure_max_hpa');
        when 'delay' then breach:=stamp>t.started_at+make_interval(mins=>(p->>'max_transport_min')::int);message:=format('Transport exceeded the %s minute target.',p->>'max_transport_min');
        when 'connectivity' then breach:=false;message:='Connection restored';
      end case;
      if breach then
        perform public.raise_excursion(t.id,d.capsule_id,kind,severity,case kind when 'temperature' then 'Temperature outside handling band' when 'shock' then 'Impact threshold exceeded' when 'tilt' then 'Orientation threshold exceeded' when 'light' then 'Light exposure detected' when 'pressure' then 'Pressure outside expected band' else 'Transport time exceeded' end,message,r.id);
      -- Buffered packets must not clear a newer excursion; current packets clear it.
      elsif fresh and stamp>=coalesce((summary->>'last_at')::timestamptz,stamp) then
        update public.alerts set resolved_at=clock_timestamp() where transport_id=t.id and alert_type=kind and resolved_at is null;
      end if;
    end loop;
    if t.state='in_transit' then
      update public.capsules set status=case when exists(select 1 from public.alerts where transport_id=t.id and resolved_at is null) then 'alert' else 'in_transit' end where id=d.capsule_id and status is distinct from case when exists(select 1 from public.alerts where transport_id=t.id and resolved_at is null) then 'alert' else 'in_transit' end;
    end if;
  end if;
  return jsonb_build_object('ok',true,'reading_id',r.id,'transport_id',t.id,'simulated',r.simulated);
end;
$$;
create function public.check_transport_health() returns integer
language plpgsql security definer set search_path='' as $$
declare t record; total integer:=0;
begin
  for t in select tr.*,c.last_seen_at from public.transports tr join public.capsules c on c.id=tr.capsule_id where tr.state='in_transit' loop
    perform 1 from public.capsules where id=t.capsule_id for update;
    if not exists(select 1 from public.transports where id=t.id and state='in_transit') then continue;end if;
    if greatest(t.last_seen_at,t.started_at)<now()-interval '2 minutes' then
      perform public.raise_excursion(t.id,t.capsule_id,'connectivity','warning','Capsule connection lost','No current telemetry for over two minutes. Inspect capsule connectivity.');
      update public.capsules set status='alert' where id=t.capsule_id and status<>'alert';total:=total+1;
    end if;
    if now()>t.started_at+make_interval(mins=>(t.profile_snapshot->>'max_transport_min')::int) then
      perform public.raise_excursion(t.id,t.capsule_id,'delay','warning','Transport time exceeded','Transport exceeded the profile time limit.');total:=total+1;
    end if;
  end loop;return total;
end;
$$;
create function public.recent_fleet_readings() returns setof public.readings
language sql stable security invoker set search_path='' as $$
  select r.* from public.capsules c cross join lateral (select * from public.readings where capsule_id=c.id order by recorded_at desc limit 180) r order by r.recorded_at;
$$;
create function public.simulator_devices() returns table(device_uid text,capsule_id uuid)
language sql stable security definer set search_path='' as $$
  select device_uid,capsule_id from public.devices where active and public.staff_role() in ('technician','admin') order by device_uid;
$$;
create function public.prune_telemetry() returns bigint
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
  -- Summary extrema, excursion evidence/messages and audit trail remain indefinitely.
  -- Keep all raw data for open journeys and a 48-hour review/print window after closure.
  delete from public.readings r where r.received_at<now()-interval '48 hours' and (r.transport_id is null or exists(select 1 from public.transports t where t.id=r.transport_id and t.state='closed' and t.closed_at<now()-interval '48 hours'));
  get diagnostics n=row_count;return n;
end;
$$;
revoke all on function public.write_audit(text,text,uuid,jsonb),public.raise_excursion(uuid,uuid,text,text,text,text,bigint),public.ingest_reading(text,text,jsonb),public.check_transport_health(),public.prune_telemetry(),public.register_specimen(jsonb),public.transition_transport(uuid,text,text,text),public.acknowledge_alert(uuid),public.recent_fleet_readings(),public.simulator_devices() from public,anon,authenticated;
grant execute on function public.register_specimen(jsonb),public.transition_transport(uuid,text,text,text),public.acknowledge_alert(uuid),public.recent_fleet_readings(),public.simulator_devices() to authenticated;
grant execute on function public.ingest_reading(text,text,jsonb),public.check_transport_health(),public.prune_telemetry() to service_role;

$source_202611020002$;
    insert into public.asqac_schema_migrations(version) values('202611020002');
  end if;
end;
$asqac_202611020002$;

-- 202611020003_seed.sql
do $asqac_202611020003$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611020003') then
    execute $source_202611020003$
-- Illustrative project presets, NOT universal clinical rules. Confirm the requested
-- assay, additive, container and local SOP with the receiving laboratory.
insert into public.handling_profiles(id,code,name,specimen_type,temp_min_c,temp_max_c,max_transport_min,max_shock_g,max_tilt_deg,max_lux,freezing_risk,lab_confirmation_req,notes,source_refs) values
('10000000-0000-4000-8000-000000000001','BLD-COLD','Blood · separated chemistry / chilled','BLOOD',2,8,60,2.5,45,100,true,true,'Demonstration only. Chilling is assay-specific; not a universal whole-blood or CBC rule. Confirm separation, additive and stability with the receiving lab. Do not freeze.',array['https://clsi.org/shop/standards/pre04/','https://www.ouh.nhs.uk/media/a0gmzj5t/directorate-protocol.pdf']),
('10000000-0000-4000-8000-000000000002','BLD-AMBIENT','Blood · ambient / expedited','BLOOD',18,25,30,2.5,45,150,false,true,'Illustrative ambient whole-blood workflow. Confirm requested assay and tube requirements. Blood gases, cultures and coagulation studies need their own validated SOP.',array['https://clsi.org/shop/standards/pre04/']),
('10000000-0000-4000-8000-000000000003','URI-COLD','Urine · refrigerated / unpreserved','URINE',2,8,120,3,60,200,true,true,'Illustrative unpreserved urine workflow when immediate processing is unavailable. Preservatives and the requested test change stability requirements. Confirm local SOP.',array['https://www.ouh.nhs.uk/microbiology/diagnostic-tests/transport/']),
('10000000-0000-4000-8000-000000000004','PLS-COLD','Plasma · separated / chilled','PLASMA',2,8,45,2.5,45,100,true,true,'Illustrative separated plasma transport; not a coagulation or frozen-plasma SOP. Confirm anticoagulant, processing interval and assay-specific conditions.',array['https://clsi.org/shop/standards/pre04/']),
('10000000-0000-4000-8000-000000000005','TIS-URGENT','Tissue · fresh / immediate delivery','TISSUE',18,25,15,2,30,150,false,true,'Fresh tissue for immediate pathology review. Confirm with pathology before collection. Frozen section, fixed tissue and microbiology require distinct preparation and transport rules.',array['https://www.ouh.nhs.uk/services/departments/laboratory-medicine/']),
('10000000-0000-4000-8000-000000000006','SWB-AMBIENT','Swab · transport-medium / ambient','SWAB',15,25,60,3,60,200,false,true,'Demonstration medium-based swab workflow. Follow the transport-medium manufacturer and organism-specific lab instructions. Some organisms require different conditions.',array['https://www.ouh.nhs.uk/microbiology/diagnostic-tests/transport/']),
('10000000-0000-4000-8000-000000000007','VAC-COLD','Vaccine · cold chain / light sensitive','VACCINE',2,8,45,2,30,20,true,true,'Training cold-chain example only. Follow the exact vaccine product insert; light sensitivity and freezing tolerance vary. Capsule readings alone cannot establish product potency.',array['https://www.who.int/publications/i/item/9789240089525']);
insert into public.capsules(id,code,label) values
('20000000-0000-4000-8000-000000000001','CAP0001','Clinical chemistry capsule'),
('20000000-0000-4000-8000-000000000002','CAP0002','Rapid response capsule'),
('20000000-0000-4000-8000-000000000003','CAP0003','Pathology transfer capsule'),
('20000000-0000-4000-8000-000000000004','CAP0004','Cold-chain research capsule');

-- Synthetic, CLOSED history only. Never create a pretend live journey.
do $$
declare i integer; s uuid; t uuid; c uuid; p public.handling_profiles; began timestamptz; ended timestamptz; decision text; r_id bigint;
begin
  select * into p from public.handling_profiles where code='BLD-COLD';
  for i in 1..9 loop
    c:=('20000000-0000-4000-8000-'||lpad((((i-1)%4)+1)::text,12,'0'))::uuid;
    began:=now()-make_interval(days=>((i-1)%7)+1,hours=>i);
    ended:=began+make_interval(mins=>12+i*2);
    decision:=case when i=3 then 'reject' when i in (5,7) then 'review_required' else 'accept' end;
    insert into public.specimens(patient_ref,requested_test,specimen_type,priority,handling_profile_id,origin,destination_lab,clinical_notice,created_at)
    values('DEMO-REF-'||lpad(i::text,3,'0'),'Research chemistry panel','BLOOD',case when i%3=0 then 'urgent' else 'routine' end,p.id,case when i%2=0 then 'Emergency ward' else 'Ward B · Level 2' end,'Clinical biochemistry','SYNTHETIC HISTORY — university demonstration only.',began-interval '4 minutes') returning id into s;
    insert into public.transports(capsule_id,specimen_id,handling_profile_id,profile_snapshot,state,started_at,arrived_at,closed_at,verdict,verdict_at,verdict_notes,excursion_count,created_at,telemetry_summary)
    values(c,s,p.id,to_jsonb(p),'closed',began,ended,ended+interval '3 minutes',decision,ended+interval '3 minutes','Synthetic historical example; not a clinical disposition.',case when decision='accept' then 0 else 1 end,began-interval '4 minutes',jsonb_build_object('count',30,'simulated_count',30,'temp_min',4.2,'temp_max',case when decision='reject' then 12.1 when decision='review_required' then 8.6 else 5.8 end,'shock_max',1.15,'light_max',4.2,'tilt_max',5.4,'first_at',began,'last_at',ended,'gap_count',0)) returning id into t;
    if decision='reject' then update public.transports set critical_excursion_count=1 where id=t;end if;
    if decision<>'accept' then
      insert into public.alerts(capsule_id,transport_id,severity,alert_type,title,message,acknowledged,acknowledged_at,created_at,resolved_at)
      values(c,t,case when decision='reject' then 'critical' else 'warning' end,'temperature','Historical demo · temperature excursion','Synthetic historical excursion retained to demonstrate review and reporting.',true,ended,began+interval '5 minutes',ended);
    end if;
    insert into public.audit_log(actor_label,action,entity_type,entity_id,detail,created_at) values
    ('Historical demo · simulated','Specimen registered','transport',t,jsonb_build_object('specimen_id',s,'synthetic',true),began-interval '4 minutes'),
    ('Historical demo · simulated','Transport prepared','transport',t,'{"synthetic":true}',began-interval '2 minutes'),
    ('Historical demo · simulated','Transport started','transport',t,'{"synthetic":true}',began),
    ('Historical demo · simulated','Transport received','transport',t,'{"synthetic":true}',ended),
    ('Historical demo · simulated','Final verdict recorded','transport',t,jsonb_build_object('verdict',decision,'synthetic',true),ended+interval '3 minutes');
  end loop;
end;
$$;

$source_202611020003$;
    insert into public.asqac_schema_migrations(version) values('202611020003');
  end if;
end;
$asqac_202611020003$;

-- 202611020004_realtime.sql
do $asqac_202611020004$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611020004') then
    execute $source_202611020004$
-- Supabase hosts this publication. Guarded for local PostgreSQL tests.
do $$
declare table_name text;
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach table_name in array array['capsules','transports','readings','alerts','audit_log','specimens'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
        execute format('alter publication supabase_realtime add table public.%I',table_name);
      end if;
    end loop;
  end if;
end;
$$;

$source_202611020004$;
    insert into public.asqac_schema_migrations(version) values('202611020004');
  end if;
end;
$asqac_202611020004$;

-- 202611020005_demo_connection.sql
do $asqac_202611020005$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611020005') then
    execute $source_202611020005$
-- Exact demo users requested for the university project. Only these two accounts
-- are provisioned; no application or unrelated user data is removed.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $demo_users$
declare demo record; user_id uuid; crypto_schema text; password_hash text;
begin
  select ns.nspname into crypto_schema from pg_extension ex join pg_namespace ns on ns.oid=ex.extnamespace where ex.extname='pgcrypto';
  for demo in select * from (values
    ('technician@asqac.test','technician','Demo Technician','technician'),
    ('doctor@asqac.test','doctor','Dr. Demo Receiver','doctor')
  ) as demos(email,password,full_name,staff_role) loop
    select id into user_id from auth.users where lower(email)=demo.email limit 1;
    execute format('select %I.crypt($1,%I.gen_salt(''bf'',10))',crypto_schema,crypto_schema) into password_hash using demo.password;
    if user_id is null then
      user_id:=gen_random_uuid();
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token,is_sso_user,is_anonymous)
      values('00000000-0000-0000-0000-000000000000',user_id,'authenticated','authenticated',demo.email,password_hash,now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',demo.full_name),false,now(),now(),'','','','','','','','',false,false);
    else
      update auth.users set encrypted_password=password_hash,email_confirmed_at=coalesce(email_confirmed_at,now()),aud='authenticated',role='authenticated',raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||'{"provider":"email","providers":["email"]}'::jsonb,raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('full_name',demo.full_name),confirmation_token=coalesce(confirmation_token,''),recovery_token=coalesce(recovery_token,''),email_change_token_new=coalesce(email_change_token_new,''),email_change=coalesce(email_change,''),email_change_token_current=coalesce(email_change_token_current,''),reauthentication_token=coalesce(reauthentication_token,''),phone_change=coalesce(phone_change,''),phone_change_token=coalesce(phone_change_token,''),is_sso_user=false,is_anonymous=false,updated_at=now() where id=user_id;
    end if;
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
    values(gen_random_uuid(),user_id,user_id::text,jsonb_build_object('sub',user_id::text,'email',demo.email,'email_verified',true,'phone_verified',false),'email',now(),now())
    on conflict(provider_id,provider) do update set user_id=excluded.user_id,identity_data=excluded.identity_data,updated_at=now();
    insert into public.profiles(id,email,full_name,role) values(user_id,demo.email,demo.full_name,demo.staff_role)
    on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role;
    user_id:=null;
  end loop;
end;
$demo_users$;

-- A known demo device credential. Only its hash is retained by Postgres.
-- The plaintext demo token is intentionally documented in README.md.
insert into public.devices(capsule_id,device_uid,token_hash,active)
select id,'CAP0001-ESP32-001','cfac982618c8c63edd03338c361c648bda3e884d8e946a666fad54bc69f3ab8c',true from public.capsules where code='CAP0001'
on conflict(device_uid) do update set token_hash=excluded.token_hash,active=true;

-- Explicit role policies also repair installations using automatic RLS.
do $policies$
declare item record;
begin
  for item in select * from (values
    ('handling_profiles','staff_read_handling'),('capsules','staff_read_capsules'),
    ('specimens','staff_read_specimens'),('transports','staff_read_transports'),
    ('readings','staff_read_readings'),('alerts','staff_read_alerts'),('audit_log','staff_read_audit')
  ) as tables(table_name,policy_name) loop
    execute format('alter table public.%I enable row level security',item.table_name);
    execute format('drop policy if exists %I on public.%I',item.policy_name,item.table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.staff_role() in (''technician'',''doctor'',''admin''))',item.policy_name,item.table_name);
  end loop;
  alter table public.profiles enable row level security;
  alter table public.devices enable row level security;
  drop policy if exists devices_no_client_access on public.devices;
  create policy devices_no_client_access on public.devices for all to authenticated using (false) with check (false);
end;
$policies$;

notify pgrst,'reload schema';

$source_202611020005$;
    insert into public.asqac_schema_migrations(version) values('202611020005');
  end if;
end;
$asqac_202611020005$;

-- 202611030006_batch_ingestion.sql
do $asqac_202611030006$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611030006') then
    execute $source_202611030006$
-- Batch existing validated readings in observation order. Rate limiting applies
-- to authenticated requests, not each row inside that request. Legacy single
-- packet ingestion remains available with its original two-second limit.
create function public.ingest_reading_batch(p_uid text,p_hash text,p_payloads jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; item jsonb; result jsonb; results jsonb := '[]';
  failure_message text; batch_started timestamptz;
begin
  if jsonb_typeof(p_payloads) is distinct from 'array' then
    raise exception 'Expected readings array' using errcode='22023';
  end if;
  if jsonb_array_length(p_payloads) not between 1 and 16 then
    raise exception 'Batch must contain 1 to 16 readings' using errcode='22023';
  end if;
  perform 1 from public.capsules where id=(select capsule_id from public.devices
    where device_uid=p_uid and active and token_hash=p_hash) for update;
  select * into d from public.devices where device_uid=p_uid and active and token_hash=p_hash for update;
  if not found then raise exception 'Invalid device credentials' using errcode='28000'; end if;
  if d.last_ingested_at > clock_timestamp()-interval '750 milliseconds' then
    raise exception 'Device rate limit: wait 750 ms' using errcode='P0001';
  end if;
  batch_started:=clock_timestamp();
  if exists(select 1 from jsonb_array_elements(p_payloads) x where x->>'device_uid' is distinct from p_uid) then
    raise exception 'Mixed device IDs are not allowed' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_payloads) order by (value->>'recorded_at')::timestamptz loop
    begin
      -- The outer lock/request limiter owns concurrency. Retain all existing
      -- timestamp membership, summaries, episode detection and audit logic.
      update public.devices set last_ingested_at=null where id=d.id;
      result := public.ingest_reading(p_uid,p_hash,item);
      results := results || jsonb_build_array(result || jsonb_build_object('recorded_at',item->>'recorded_at'));
    exception when others then
      get stacked diagnostics failure_message=message_text;
      if failure_message like '%already reviewed%' then
        results := results || jsonb_build_array(jsonb_build_object('ok',false,'rejected',true,
          'recorded_at',item->>'recorded_at','error','Transport already reviewed; late reading rejected'));
      else
        -- Transient/unknown errors roll back the whole batch for safe retry.
        raise;
      end if;
    end;
  end loop;
  -- Anchor the batch limit at its accepted start, not its completion. Otherwise
  -- a slow request followed by a fast one can spuriously hit the limiter.
  update public.devices set last_ingested_at=batch_started where id=d.id;
  return jsonb_build_object('ok',true,'batch',true,'results',results);
end;
$$;
revoke all on function public.ingest_reading_batch(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_reading_batch(text,text,jsonb) to service_role;
notify pgrst,'reload schema';

$source_202611030006$;
    insert into public.asqac_schema_migrations(version) values('202611030006');
  end if;
end;
$asqac_202611030006$;

-- 202611030007_barometric_height.sql
do $asqac_202611030007$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611030007') then
    execute $source_202611030007$
-- Pressure-derived estimates only. No extra sensor channel or clinical limit.
alter table public.readings
  add column sea_level_pressure_hpa double precision not null default 1013.25
    check(sea_level_pressure_hpa between 800 and 1100),
  add column reference_pressure_hpa double precision
    check(reference_pressure_hpa between 300 and 1200),
  add column height_reference_at timestamptz,
  add column altitude_m double precision generated always as
    (44330.0*(1.0-power(pressure_hpa/sea_level_pressure_hpa,0.1903))) stored,
  add column height_change_m double precision generated always as
    (case when reference_pressure_hpa is not null then
      44330.0*(1.0-power(pressure_hpa/reference_pressure_hpa,0.1903)) else null end) stored,
  add constraint paired_height_reference check
    ((reference_pressure_hpa is null)=(height_reference_at is null)),
  add constraint height_reference_precedes_sample check
    (height_reference_at is null or height_reference_at<=recorded_at);
comment on column public.readings.altitude_m is 'Estimated barometric altitude using declared sea-level pressure; not GPS/geodetic elevation.';
comment on column public.readings.height_change_m is 'Estimated pressure-relative displacement since the transmitted startup baseline; resets with a new baseline. Weather/sealing affect it.';

create or replace function public.ingest_reading(p_uid text,p_hash text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; t public.transports; r public.readings; p jsonb; summary jsonb; stamp timestamptz; breach boolean; kind text; severity text; message text; old_id bigint; fresh boolean;
begin
  -- Lock order capsule -> device -> transport matches the workflow RPC.
  perform 1 from public.capsules where id=(select capsule_id from public.devices where device_uid=p_uid and active and token_hash=p_hash) for update;
  select * into d from public.devices where device_uid=p_uid and active and token_hash=p_hash for update;
  if not found then raise exception 'Invalid device credentials' using errcode='28000'; end if;
  stamp:=(p_payload->>'recorded_at')::timestamptz;
  if stamp is null or stamp>clock_timestamp()+interval '30 seconds' or stamp<clock_timestamp()-interval '24 hours' then raise exception 'Timestamp outside allowed window'; end if;
  select id into old_id from public.readings where device_uid=p_uid and recorded_at=stamp;
  if old_id is not null then return jsonb_build_object('ok',true,'duplicate',true,'reading_id',old_id); end if;
  if d.last_ingested_at>clock_timestamp()-interval '2 seconds' then raise exception 'Device rate limit: wait 2 seconds' using errcode='P0001'; end if;
  -- Timestamp membership prevents offline packets being assigned to a new journey.
  select * into t from public.transports where capsule_id=d.capsule_id and started_at<=stamp and (arrived_at is null or stamp<=arrived_at) and state in ('in_transit','arrived','closed') order by started_at desc limit 1 for update;
  if t.state='closed' then raise exception 'Transport already reviewed; late readings need manual review'; end if;
  insert into public.readings(capsule_id,transport_id,device_uid,recorded_at,temp_c,pressure_hpa,lux,ax,ay,az,gx,gy,gz,pitch_deg,roll_deg,shock_g,rssi,simulated,sea_level_pressure_hpa,reference_pressure_hpa,height_reference_at)
  values(d.capsule_id,t.id,p_uid,stamp,(p_payload->>'temp_c')::float8,(p_payload->>'pressure_hpa')::float8,(p_payload->>'lux')::float8,(p_payload->>'ax')::float8,(p_payload->>'ay')::float8,(p_payload->>'az')::float8,coalesce((p_payload->>'gx')::float8,0),coalesce((p_payload->>'gy')::float8,0),coalesce((p_payload->>'gz')::float8,0),(p_payload->>'pitch_deg')::float8,(p_payload->>'roll_deg')::float8,(p_payload->>'shock_g')::float8,(p_payload->>'rssi')::int,coalesce((p_payload->>'simulated')::boolean,false),coalesce((p_payload->>'sea_level_pressure_hpa')::float8,1013.25),(p_payload->>'reference_pressure_hpa')::float8,(p_payload->>'height_reference_at')::timestamptz) returning * into r;
  update public.devices set last_ingested_at=clock_timestamp() where id=d.id;
  fresh:=stamp>clock_timestamp()-interval '2 minutes';
  -- Exact receive heartbeat; do not refresh it with old buffered observations.
  update public.capsules set last_seen_at=clock_timestamp() where id=d.capsule_id and fresh;
  if t.id is not null then
    p:=t.profile_snapshot; summary:=t.telemetry_summary;
    update public.transports set telemetry_summary=jsonb_build_object(
      'count',coalesce((summary->>'count')::int,0)+1,
      'simulated_count',coalesce((summary->>'simulated_count')::int,0)+case when r.simulated then 1 else 0 end,
      'temp_min',least((summary->>'temp_min')::float8,r.temp_c),'temp_max',greatest((summary->>'temp_max')::float8,r.temp_c),
      'shock_max',greatest((summary->>'shock_max')::float8,r.shock_g),'light_max',greatest((summary->>'light_max')::float8,r.lux),
      'tilt_max',greatest((summary->>'tilt_max')::float8,abs(r.pitch_deg),abs(r.roll_deg)),
      'first_at',least((summary->>'first_at')::timestamptz,stamp),'last_at',greatest((summary->>'last_at')::timestamptz,stamp),
      'altitude_min_m',least((summary->>'altitude_min_m')::float8,r.altitude_m),
      'altitude_max_m',greatest((summary->>'altitude_max_m')::float8,r.altitude_m),
      'height_change_min_m',least((summary->>'height_change_min_m')::float8,r.height_change_m),
      'height_change_max_m',greatest((summary->>'height_change_max_m')::float8,r.height_change_m),
      'height_reference_at',case when stamp>=coalesce((summary->>'last_at')::timestamptz,stamp) then coalesce(r.height_reference_at::text,summary->>'height_reference_at') else summary->>'height_reference_at' end,
      'height_reference_changed',coalesce((summary->>'height_reference_changed')::boolean,false) or (r.height_reference_at is not null and summary->>'height_reference_at' is not null and r.height_reference_at is distinct from (summary->>'height_reference_at')::timestamptz),
      'gap_count',coalesce((summary->>'gap_count')::int,0)+case when stamp>coalesce((summary->>'last_at')::timestamptz,t.started_at)+interval '2 minutes' then 1 else 0 end
    ) where id=t.id;
    foreach kind in array array['temperature','shock','tilt','light','pressure','delay','connectivity'] loop
      severity:='warning';
      case kind
        when 'temperature' then breach:=r.temp_c<(p->>'temp_min_c')::float8 or r.temp_c>(p->>'temp_max_c')::float8; if r.temp_c<(p->>'temp_min_c')::float8-2 or r.temp_c>(p->>'temp_max_c')::float8+2 then severity:='critical';end if;message:=format('Temperature %s °C; target %s–%s °C.',r.temp_c,p->>'temp_min_c',p->>'temp_max_c');
        when 'shock' then breach:=r.shock_g>(p->>'max_shock_g')::float8;severity:='critical';message:=format('Impact peak %s g; limit %s g.',r.shock_g,p->>'max_shock_g');
        when 'tilt' then breach:=greatest(abs(r.pitch_deg),abs(r.roll_deg))>(p->>'max_tilt_deg')::float8;message:=format('Pitch %s°, roll %s°; limit %s°.',r.pitch_deg,r.roll_deg,p->>'max_tilt_deg');
        when 'light' then breach:=r.lux>(p->>'max_lux')::float8;message:=format('Light %s lx; limit %s lx. Possible lid opening.',r.lux,p->>'max_lux');
        when 'pressure' then breach:=r.pressure_hpa<(p->>'pressure_min_hpa')::float8 or r.pressure_hpa>(p->>'pressure_max_hpa')::float8;message:=format('Pressure %s hPa; band %s–%s hPa.',r.pressure_hpa,p->>'pressure_min_hpa',p->>'pressure_max_hpa');
        when 'delay' then breach:=stamp>t.started_at+make_interval(mins=>(p->>'max_transport_min')::int);message:=format('Transport exceeded the %s minute target.',p->>'max_transport_min');
        when 'connectivity' then breach:=false;message:='Connection restored';
      end case;
      if breach then
        perform public.raise_excursion(t.id,d.capsule_id,kind,severity,case kind when 'temperature' then 'Temperature outside handling band' when 'shock' then 'Impact threshold exceeded' when 'tilt' then 'Orientation threshold exceeded' when 'light' then 'Light exposure detected' when 'pressure' then 'Pressure outside expected band' else 'Transport time exceeded' end,message,r.id);
      -- Buffered packets must not clear a newer excursion; current packets clear it.
      elsif fresh and stamp>=coalesce((summary->>'last_at')::timestamptz,stamp) then
        update public.alerts set resolved_at=clock_timestamp() where transport_id=t.id and alert_type=kind and resolved_at is null;
      end if;
    end loop;
    if t.state='in_transit' then
      update public.capsules set status=case when exists(select 1 from public.alerts where transport_id=t.id and resolved_at is null) then 'alert' else 'in_transit' end where id=d.capsule_id and status is distinct from case when exists(select 1 from public.alerts where transport_id=t.id and resolved_at is null) then 'alert' else 'in_transit' end;
    end if;
  end if;
  return jsonb_build_object('ok',true,'reading_id',r.id,'transport_id',t.id,'simulated',r.simulated);
end;
$$;
notify pgrst,'reload schema';

$source_202611030007$;
    insert into public.asqac_schema_migrations(version) values('202611030007');
  end if;
end;
$asqac_202611030007$;

-- 202611030008_device_rate_limit.sql
do $asqac_202611030008$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611030008') then
    execute $source_202611030008$
-- Shared 250 ms admission window for legacy and batched device uploads.
-- Authentication, row validation, audit and bounded batching are unchanged.
create or replace function public.ingest_reading(p_uid text,p_hash text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; t public.transports; r public.readings; p jsonb; summary jsonb; stamp timestamptz; breach boolean; kind text; severity text; message text; old_id bigint; fresh boolean;
begin
  -- Lock order capsule -> device -> transport matches the workflow RPC.
  perform 1 from public.capsules where id=(select capsule_id from public.devices where device_uid=p_uid and active and token_hash=p_hash) for update;
  select * into d from public.devices where device_uid=p_uid and active and token_hash=p_hash for update;
  if not found then raise exception 'Invalid device credentials' using errcode='28000'; end if;
  stamp:=(p_payload->>'recorded_at')::timestamptz;
  if stamp is null or stamp>clock_timestamp()+interval '30 seconds' or stamp<clock_timestamp()-interval '24 hours' then raise exception 'Timestamp outside allowed window'; end if;
  select id into old_id from public.readings where device_uid=p_uid and recorded_at=stamp;
  if old_id is not null then return jsonb_build_object('ok',true,'duplicate',true,'reading_id',old_id); end if;
  if d.last_ingested_at>clock_timestamp()-interval '250 milliseconds' then raise exception 'Device rate limit: wait 250 ms' using errcode='P0001'; end if;
  -- Timestamp membership prevents offline packets being assigned to a new journey.
  select * into t from public.transports where capsule_id=d.capsule_id and started_at<=stamp and (arrived_at is null or stamp<=arrived_at) and state in ('in_transit','arrived','closed') order by started_at desc limit 1 for update;
  if t.state='closed' then raise exception 'Transport already reviewed; late readings need manual review'; end if;
  insert into public.readings(capsule_id,transport_id,device_uid,recorded_at,temp_c,pressure_hpa,lux,ax,ay,az,gx,gy,gz,pitch_deg,roll_deg,shock_g,rssi,simulated,sea_level_pressure_hpa,reference_pressure_hpa,height_reference_at)
  values(d.capsule_id,t.id,p_uid,stamp,(p_payload->>'temp_c')::float8,(p_payload->>'pressure_hpa')::float8,(p_payload->>'lux')::float8,(p_payload->>'ax')::float8,(p_payload->>'ay')::float8,(p_payload->>'az')::float8,coalesce((p_payload->>'gx')::float8,0),coalesce((p_payload->>'gy')::float8,0),coalesce((p_payload->>'gz')::float8,0),(p_payload->>'pitch_deg')::float8,(p_payload->>'roll_deg')::float8,(p_payload->>'shock_g')::float8,(p_payload->>'rssi')::int,coalesce((p_payload->>'simulated')::boolean,false),coalesce((p_payload->>'sea_level_pressure_hpa')::float8,1013.25),(p_payload->>'reference_pressure_hpa')::float8,(p_payload->>'height_reference_at')::timestamptz) returning * into r;
  update public.devices set last_ingested_at=clock_timestamp() where id=d.id;
  fresh:=stamp>clock_timestamp()-interval '2 minutes';
  -- Exact receive heartbeat; do not refresh it with old buffered observations.
  update public.capsules set last_seen_at=clock_timestamp() where id=d.capsule_id and fresh;
  if t.id is not null then
    p:=t.profile_snapshot; summary:=t.telemetry_summary;
    update public.transports set telemetry_summary=jsonb_build_object(
      'count',coalesce((summary->>'count')::int,0)+1,
      'simulated_count',coalesce((summary->>'simulated_count')::int,0)+case when r.simulated then 1 else 0 end,
      'temp_min',least((summary->>'temp_min')::float8,r.temp_c),'temp_max',greatest((summary->>'temp_max')::float8,r.temp_c),
      'shock_max',greatest((summary->>'shock_max')::float8,r.shock_g),'light_max',greatest((summary->>'light_max')::float8,r.lux),
      'tilt_max',greatest((summary->>'tilt_max')::float8,abs(r.pitch_deg),abs(r.roll_deg)),
      'first_at',least((summary->>'first_at')::timestamptz,stamp),'last_at',greatest((summary->>'last_at')::timestamptz,stamp),
      'altitude_min_m',least((summary->>'altitude_min_m')::float8,r.altitude_m),
      'altitude_max_m',greatest((summary->>'altitude_max_m')::float8,r.altitude_m),
      'height_change_min_m',least((summary->>'height_change_min_m')::float8,r.height_change_m),
      'height_change_max_m',greatest((summary->>'height_change_max_m')::float8,r.height_change_m),
      'height_reference_at',case when stamp>=coalesce((summary->>'last_at')::timestamptz,stamp) then coalesce(r.height_reference_at::text,summary->>'height_reference_at') else summary->>'height_reference_at' end,
      'height_reference_changed',coalesce((summary->>'height_reference_changed')::boolean,false) or (r.height_reference_at is not null and summary->>'height_reference_at' is not null and r.height_reference_at is distinct from (summary->>'height_reference_at')::timestamptz),
      'gap_count',coalesce((summary->>'gap_count')::int,0)+case when stamp>coalesce((summary->>'last_at')::timestamptz,t.started_at)+interval '2 minutes' then 1 else 0 end
    ) where id=t.id;
    foreach kind in array array['temperature','shock','tilt','light','pressure','delay','connectivity'] loop
      severity:='warning';
      case kind
        when 'temperature' then breach:=r.temp_c<(p->>'temp_min_c')::float8 or r.temp_c>(p->>'temp_max_c')::float8; if r.temp_c<(p->>'temp_min_c')::float8-2 or r.temp_c>(p->>'temp_max_c')::float8+2 then severity:='critical';end if;message:=format('Temperature %s °C; target %s–%s °C.',r.temp_c,p->>'temp_min_c',p->>'temp_max_c');
        when 'shock' then breach:=r.shock_g>(p->>'max_shock_g')::float8;severity:='critical';message:=format('Impact peak %s g; limit %s g.',r.shock_g,p->>'max_shock_g');
        when 'tilt' then breach:=greatest(abs(r.pitch_deg),abs(r.roll_deg))>(p->>'max_tilt_deg')::float8;message:=format('Pitch %s°, roll %s°; limit %s°.',r.pitch_deg,r.roll_deg,p->>'max_tilt_deg');
        when 'light' then breach:=r.lux>(p->>'max_lux')::float8;message:=format('Light %s lx; limit %s lx. Possible lid opening.',r.lux,p->>'max_lux');
        when 'pressure' then breach:=r.pressure_hpa<(p->>'pressure_min_hpa')::float8 or r.pressure_hpa>(p->>'pressure_max_hpa')::float8;message:=format('Pressure %s hPa; band %s–%s hPa.',r.pressure_hpa,p->>'pressure_min_hpa',p->>'pressure_max_hpa');
        when 'delay' then breach:=stamp>t.started_at+make_interval(mins=>(p->>'max_transport_min')::int);message:=format('Transport exceeded the %s minute target.',p->>'max_transport_min');
        when 'connectivity' then breach:=false;message:='Connection restored';
      end case;
      if breach then
        perform public.raise_excursion(t.id,d.capsule_id,kind,severity,case kind when 'temperature' then 'Temperature outside handling band' when 'shock' then 'Impact threshold exceeded' when 'tilt' then 'Orientation threshold exceeded' when 'light' then 'Light exposure detected' when 'pressure' then 'Pressure outside expected band' else 'Transport time exceeded' end,message,r.id);
      -- Buffered packets must not clear a newer excursion; current packets clear it.
      elsif fresh and stamp>=coalesce((summary->>'last_at')::timestamptz,stamp) then
        update public.alerts set resolved_at=clock_timestamp() where transport_id=t.id and alert_type=kind and resolved_at is null;
      end if;
    end loop;
    if t.state='in_transit' then
      update public.capsules set status=case when exists(select 1 from public.alerts where transport_id=t.id and resolved_at is null) then 'alert' else 'in_transit' end where id=d.capsule_id and status is distinct from case when exists(select 1 from public.alerts where transport_id=t.id and resolved_at is null) then 'alert' else 'in_transit' end;
    end if;
  end if;
  return jsonb_build_object('ok',true,'reading_id',r.id,'transport_id',t.id,'simulated',r.simulated);
end;
$$;
notify pgrst,'reload schema';

create or replace function public.ingest_reading_batch(p_uid text,p_hash text,p_payloads jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; item jsonb; result jsonb; results jsonb := '[]';
  failure_message text; batch_started timestamptz;
begin
  if jsonb_typeof(p_payloads) is distinct from 'array' then
    raise exception 'Expected readings array' using errcode='22023';
  end if;
  if jsonb_array_length(p_payloads) not between 1 and 16 then
    raise exception 'Batch must contain 1 to 16 readings' using errcode='22023';
  end if;
  perform 1 from public.capsules where id=(select capsule_id from public.devices
    where device_uid=p_uid and active and token_hash=p_hash) for update;
  select * into d from public.devices where device_uid=p_uid and active and token_hash=p_hash for update;
  if not found then raise exception 'Invalid device credentials' using errcode='28000'; end if;
  if d.last_ingested_at > clock_timestamp()-interval '250 milliseconds' then
    raise exception 'Device rate limit: wait 250 ms' using errcode='P0001';
  end if;
  batch_started:=clock_timestamp();
  if exists(select 1 from jsonb_array_elements(p_payloads) x where x->>'device_uid' is distinct from p_uid) then
    raise exception 'Mixed device IDs are not allowed' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_payloads) order by (value->>'recorded_at')::timestamptz loop
    begin
      -- The outer lock/request limiter owns concurrency. Retain all existing
      -- timestamp membership, summaries, episode detection and audit logic.
      update public.devices set last_ingested_at=null where id=d.id;
      result := public.ingest_reading(p_uid,p_hash,item);
      results := results || jsonb_build_array(result || jsonb_build_object('recorded_at',item->>'recorded_at'));
    exception when others then
      get stacked diagnostics failure_message=message_text;
      if failure_message like '%already reviewed%' then
        results := results || jsonb_build_array(jsonb_build_object('ok',false,'rejected',true,
          'recorded_at',item->>'recorded_at','error','Transport already reviewed; late reading rejected'));
      else
        -- Transient/unknown errors roll back the whole batch for safe retry.
        raise;
      end if;
    end;
  end loop;
  -- Anchor the batch limit at its accepted start, not its completion. Otherwise
  -- a slow request followed by a fast one can spuriously hit the limiter.
  update public.devices set last_ingested_at=batch_started where id=d.id;
  return jsonb_build_object('ok',true,'batch',true,'results',results);
end;
$$;
revoke all on function public.ingest_reading_batch(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_reading_batch(text,text,jsonb) to service_role;
notify pgrst,'reload schema';

$source_202611030008$;
    insert into public.asqac_schema_migrations(version) values('202611030008');
  end if;
end;
$asqac_202611030008$;

-- 202611030009_remove_synthetic_history.sql
do $asqac_202611030009$
begin
  if not exists(select 1 from public.asqac_schema_migrations where version='202611030009') then
    execute $source_202611030009$
-- Explicitly requested removal of ASQAC's own demo/verification data only.
-- User-entered specimens, physical readings, capsule inventory and staff stay.
do $$
declare specimen_ids uuid[]; transport_ids uuid[]; open_capsule_ids uuid[]; device_ids uuid[]; temporary_uids text[];
  kept_physical integer; deleted_readings integer; deleted_alerts integer; deleted_audit integer;
  deleted_transports integer; deleted_specimens integer; deleted_devices integer;
begin
  select coalesce(array_agg(id),'{}') into specimen_ids from public.specimens where
    (patient_ref ~ '^DEMO-REF-00[1-9]$' and requested_test='Research chemistry panel' and clinical_notice like 'SYNTHETIC HISTORY%')
    or (patient_ref='ASQAC-VERIFY' and requested_test='Connection verification (simulated)' and clinical_notice='Synthetic end-to-end connection check. No patient specimen.')
    or (patient_ref='ASQAC-UI-VERIFY' and requested_test='Live interface verification')
    or (patient_ref='ASQAC-ALERT-VERIFY' and requested_test='Simulated alert workflow verification' and clinical_notice like 'Synthetic workflow verification.%');
  select coalesce(array_agg(id),'{}') into transport_ids from public.transports where specimen_id=any(specimen_ids);
  select coalesce(array_agg(distinct capsule_id),'{}') into open_capsule_ids from public.transports where id=any(transport_ids) and state<>'closed';
  select coalesce(array_agg(id),'{}'),coalesce(array_agg(device_uid),'{}') into device_ids,temporary_uids
    from public.devices where device_uid ~ '^CAP0004-(BATCH|ALERT)-VERIFY-[0-9]{13}$';
  -- Follow the same capsule -> device -> transport lock order as ingestion.
  perform 1 from public.capsules where id in (
    select capsule_id from public.transports where id=any(transport_ids)
    union select capsule_id from public.devices where id=any(device_ids)
  ) order by id for update;
  perform 1 from public.devices where id=any(device_ids) order by id for update;
  perform 1 from public.transports where id=any(transport_ids) order by id for update;

  -- Retain any genuine sensor observation accidentally associated with a
  -- synthetic verification journey. Only remove its artificial association.
  update public.readings set transport_id=null where transport_id=any(transport_ids) and not simulated;
  get diagnostics kept_physical=row_count;
  delete from public.readings where simulated and (transport_id=any(transport_ids) or device_uid=any(temporary_uids));
  get diagnostics deleted_readings=row_count;
  delete from public.alerts where transport_id=any(transport_ids);
  get diagnostics deleted_alerts=row_count;
  delete from public.audit_log where entity_id=any(transport_ids) or entity_id=any(specimen_ids) or entity_id=any(device_ids);
  get diagnostics deleted_audit=row_count;
  delete from public.transports where id=any(transport_ids);
  get diagnostics deleted_transports=row_count;
  delete from public.specimens where id=any(specimen_ids);
  get diagnostics deleted_specimens=row_count;
  delete from public.devices d where d.id=any(device_ids) and not exists(select 1 from public.readings r where r.device_uid=d.device_uid);
  get diagnostics deleted_devices=row_count;
  update public.capsules c set status='idle' where c.id=any(open_capsule_ids)
    and c.status in ('prepared','in_transit','arrived','alert')
    and not exists(select 1 from public.transports t where t.capsule_id=c.id and t.state<>'closed');
  raise notice 'Synthetic cleanup: % specimens, % transports, % readings, % alerts, % audit events, % devices removed; % physical observations preserved.',
    deleted_specimens,deleted_transports,deleted_readings,deleted_alerts,deleted_audit,deleted_devices,kept_physical;
end;
$$;

$source_202611030009$;
    insert into public.asqac_schema_migrations(version) values('202611030009');
  end if;
end;
$asqac_202611030009$;

notify pgrst,'reload schema';
commit;

-- Verification summary (no credentials or patient information)
select 'capsules' as entity,count(*) as row_count from public.capsules
union all select 'handling profiles',count(*) from public.handling_profiles
union all select 'demo staff',count(*) from public.profiles where email in ('technician@asqac.test','doctor@asqac.test')
union all select 'demo devices',count(*) from public.devices where device_uid='CAP0001-ESP32-001'
union all select 'historical transports',count(*) from public.transports where state='closed';
