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
