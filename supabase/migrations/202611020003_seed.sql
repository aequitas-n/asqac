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
