-- A single staff action acknowledges the pending queue atomically, including
-- events outside the UI's loaded history. Each event retains its own audit entry.
create function public.acknowledge_all_alerts() returns integer
language plpgsql security definer set search_path='' as $$
declare a public.alerts; total integer := 0;
begin
  if coalesce(public.staff_role(),'') not in ('technician','doctor','admin') then
    raise exception 'Staff role required' using errcode='42501';
  end if;
  for a in
    update public.alerts
      set acknowledged=true, acknowledged_by=auth.uid(), acknowledged_at=now()
      where not acknowledged
      returning *
  loop
    perform public.write_audit('Alert acknowledged','transport',a.transport_id,
      jsonb_build_object('alert_id',a.id,'type',a.alert_type,'severity',a.severity,'bulk',true));
    total := total + 1;
  end loop;
  return total;
end;
$$;
revoke all on function public.acknowledge_all_alerts() from public,anon,authenticated;
grant execute on function public.acknowledge_all_alerts() to authenticated;
