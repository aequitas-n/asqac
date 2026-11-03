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
