-- Run as postgres when pg_cron is available. No HTTP invocation or secret.
create extension if not exists pg_cron with schema pg_catalog;
do $jobs$
begin
  if not exists(select 1 from cron.job where jobname='asqac-health') then
    perform cron.schedule('asqac-health','* * * * *','select public.check_transport_health();');
  end if;
  if not exists(select 1 from cron.job where jobname='asqac-retention') then
    perform cron.schedule('asqac-retention','17 * * * *','select public.prune_telemetry();');
  end if;
end;
$jobs$;
select jobname,schedule,active from cron.job where jobname in ('asqac-health','asqac-retention');
