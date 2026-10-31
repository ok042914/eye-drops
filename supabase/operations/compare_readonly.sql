-- READ-ONLY REFERENCE ONLY. Not executed during preparation. Capture before/after; compare non_eye hashes.
select jsonb_build_object(
  'at',clock_timestamp(),
  'database',current_database(),
  'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname in ('eye_stock','lens_stock')),
  'non_eye_tables',(select md5(string_agg(c.oid::text||n.nspname||c.relname||coalesce(c.relacl::text,'')||c.relrowsecurity::text||c.relowner::text,'|' order by c.oid))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','lens_stock') and c.relkind in ('r','v','m') and c.relname not like 'eye_stock\_%' escape '\'),
  'non_eye_functions',(select md5(string_agg(p.oid::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text,'|' order by p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','lens_stock') and p.prokind='f' and p.proname not like 'eye_stock\_%' escape '\'),
  'non_eye_policies',(select md5(string_agg(to_jsonb(p)::text,'|' order by schemaname,tablename,policyname)) from pg_policies p where schemaname<>'eye_stock'),
  'shared_role_attributes',(select md5(string_agg(rolname||rolsuper::text||rolinherit::text||rolcreaterole::text||rolcreatedb::text||rolcanlogin::text||rolreplication::text||rolbypassrls::text||coalesce(rolconfig::text,''),'|' order by rolname)) from pg_roles where rolname<>'eye_stock_executor'),
  'eye_tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)) from pg_class c where c.relnamespace=to_regnamespace('eye_stock') and c.relkind='r'),
  'eye_functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='eye_stock' or (n.nspname='public' and p.proname like 'eye_stock\_%' escape '\')),
  'role_memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'admin',admin_option,'inherit',inherit_option,'set',set_option)),'[]'::jsonb) from pg_auth_members),
  'statistics',(select jsonb_build_object('stats_reset',stats_reset,'commits',xact_commit,'rollbacks',xact_rollback,'deadlocks',deadlocks,'connections',numbackends) from pg_stat_database where datname=current_database()),
  'database_bytes',pg_database_size(current_database())
) as comparison;

-- No reset. Run at two separated timestamps to compute rates; normalized SQL only, no JWT/header values.
select clock_timestamp() as at, userid::regrole as role, queryid, calls,total_exec_time,mean_exec_time
from extensions.pg_stat_statements
where query like 'select set_config(%' or query like '%eye_stock_mutate(%'
order by calls desc limit 20;
