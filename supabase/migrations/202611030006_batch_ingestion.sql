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
