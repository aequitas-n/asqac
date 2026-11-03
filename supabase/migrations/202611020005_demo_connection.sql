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
