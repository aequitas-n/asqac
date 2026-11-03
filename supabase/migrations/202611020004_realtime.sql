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
