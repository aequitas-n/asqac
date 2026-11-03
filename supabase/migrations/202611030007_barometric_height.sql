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
