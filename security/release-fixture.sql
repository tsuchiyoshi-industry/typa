-- Synthetic data for isolated release verification databases only.
insert into public.roles(role_name) values('Admin'),('Reviewer'),('Employee') on conflict(role_name) do nothing;
insert into public.common_evaluation_item_sets(id,name) values(9001,'Release verification');
insert into public.employee_grades(id,grade_name,item_set_id) values(9001,'Release verification',9001);
insert into public.common_evaluation_items(id,title,description,weight,item_set_id)
  values(900001,'Release item A','Synthetic',2,9001),(900002,'Release item B','Synthetic',3,9001);
insert into auth.users(id,email,aud,role,created_at,updated_at,email_confirmed_at)
  select ('00000000-0000-0000-0000-'||lpad((900000+n)::text,12,'0'))::uuid,
    'typa-release00'||n||'@release.example','authenticated','authenticated',now(),now(),now()
  from generate_series(1,6) n;
insert into public.employees(id,user_id,name,employee_no,role_id,grade_id)
  select 900000+n,('00000000-0000-0000-0000-'||lpad((900000+n)::text,12,'0'))::uuid,
    'Release test '||n,'RELEASE00'||n,(select id from public.roles where role_name=case when n=1 then 'Admin' when n in(2,3) then 'Reviewer' else 'Employee' end),9001
  from generate_series(1,6) n;
insert into public.employees(id,name,employee_no,role_id,grade_id)
  values(900007,'Release unregistered','RELEASE007',(select id from public.roles where role_name='Employee'),9001);
update public.employees set primary_evaluator_id=900002,secondary_evaluator_id=900003 where id=900004;
update public.employees set primary_evaluator_id=900002,no_secondary_evaluator=true where id=900006;
update public.evaluation_periods set is_active=false;
insert into public.evaluation_periods(id,period_name,start_date,end_date,is_active)
  values(900001,'Release verification','2026-10-01','2027-03-31',true);
update public.workspace_settings set required_domain='release.example';
