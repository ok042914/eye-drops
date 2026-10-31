-- PREPARED ONLY / NEVER RUN ON PRODUCTION, including inside ROLLBACK.
-- Requires an existing isolated PostgreSQL 17+ DB named eye_drops_security_test,
-- reviewed candidate schema, anon/authenticated roles, privileged test operator,
-- and fixture owners A/B with >=1 valid row EACH in ALL eleven tables.
-- Fixtures must be prepared separately in the isolated DB; no real users/data.
-- A=11111111-1111-4111-8111-111111111111 B=22222222-2222-4222-8222-222222222222.
-- No GRANT/ALTER ROLE here. SET ROLE/claims are transaction-local test simulation,
-- NOT signed JWT verification. HTTP tests remain a separate requirement.
begin;
set local statement_timeout='10s';
set local lock_timeout='1s';
do $guard$
begin
  if current_database()<>'eye_drops_security_test' or current_setting('eye_drops.isolated_tests',true) is distinct from 'approved' then
    raise exception 'ISOLATED_TEST_DATABASE_AND_EXPLICIT_OPT_IN_REQUIRED';
  end if;
  if not (select rolsuper from pg_roles where rolname=current_user) then
    raise exception 'ISOLATED_TEST_OPERATOR_MUST_BE_SUPERUSER';
  end if;
end;
$guard$;
-- Test harness temporarily sets roles, never adds membership or privileges.
do $tests$
declare
  tables text[]:=array['profiles','medications','medication_settings','stock_balances','mutation_requests','bottles','visits','prescriptions','receipts','stock_movements','audit_events'];
  tbl text; app_role text; owner_a uuid:='11111111-1111-4111-8111-111111111111';
  owner_b uuid:='22222222-2222-4222-8222-222222222222';
  own_count bigint; foreign_count bigint; total_count bigint; checks integer:=0;
begin
  foreach tbl in array tables loop
    if not exists(select 1 from pg_class c where c.oid=to_regclass('eye_stock.'||tbl) and c.relrowsecurity and c.relforcerowsecurity and c.relowner<>(select oid from pg_roles where rolname='eye_stock_executor')) then
      raise exception 'MISSING_RLS_FORCE_OR_EXECUTOR_OWNS_TABLE: %',tbl;
    end if;
    execute format('select count(*) filter(where user_id=$1),count(*) filter(where user_id=$2) from eye_stock.%I',tbl) into own_count,foreign_count using owner_a,owner_b;
    if own_count=0 or foreign_count=0 then raise exception 'MISSING_A_OR_B_FIXTURE: %',tbl; end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='eye_stock_executor' and (rolcanlogin or rolbypassrls or rolsuper or rolcreaterole or rolcreatedb)) then
    raise exception 'UNSAFE_EXECUTOR_ATTRIBUTES';
  end if;
  if pg_has_role('authenticated','eye_stock_executor','SET') or pg_has_role('anon','eye_stock_executor','SET') or pg_has_role('authenticator','eye_stock_executor','SET') then
    raise exception 'APP_CAN_SET_EXECUTOR';
  end if;

  foreach app_role in array array['anon','authenticated'] loop
    foreach tbl in array tables loop
      if has_table_privilege(app_role,'eye_stock.'||tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(app_role,'eye_stock.'||tbl,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'APP_HAS_DIRECT_PRIVILEGE: %.%',app_role,tbl;
      end if;
      execute format('set local role %I',app_role);
      perform set_config('request.jwt.claims',case when app_role='anon' then '{}' else jsonb_build_object('sub',owner_a,'role','authenticated')::text end,true);
      begin
        execute format('select count(*) from eye_stock.%I',tbl) into total_count;
        raise exception 'DIRECT_READ_UNEXPECTEDLY_SUCCEEDED: %.%',app_role,tbl;
      exception when insufficient_privilege then checks:=checks+1;
      end;
      execute 'reset role';
    end loop;
  end loop;

  -- No JWT => no rows through the execution role on all tables.
  execute 'set local role eye_stock_executor';
  perform set_config('request.jwt.claims','{}',true);
  foreach tbl in array tables loop
    execute format('select count(*) from eye_stock.%I',tbl) into total_count;
    if total_count<>0 then raise exception 'NO_JWT_LEAK: %',tbl; end if;
    checks:=checks+1;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
  foreach tbl in array tables loop
    execute format('select count(*) filter(where user_id=$1),count(*) filter(where user_id<>$1) from eye_stock.%I',tbl) into own_count,foreign_count using owner_a;
    if own_count=0 or foreign_count<>0 then raise exception 'OWNER_ISOLATION_FAILED: %',tbl; end if;
    -- RLS hidden rows generally return zero rows, not HTTP 403.
    checks:=checks+1;
    if has_column_privilege(current_user,'eye_stock.'||tbl,'user_id','UPDATE') then
      begin
        execute format('update eye_stock.%I set user_id=$1 where user_id=$2',tbl) using owner_b,owner_a;
        raise exception 'WITH_CHECK_UNEXPECTEDLY_SUCCEEDED: %',tbl;
      exception when insufficient_privilege then checks:=checks+1;
      end;
    end if;
  end loop;
  execute 'reset role';
  -- Unauthenticated app cannot execute either public or private entrypoints.
  execute 'set local role anon';
  begin
    perform public.eye_stock_snapshot(null);
    raise exception 'ANON_RPC_UNEXPECTEDLY_SUCCEEDED';
  exception when insufficient_privilege then checks:=checks+1;
  end;
  execute 'reset role';
  -- Authenticated role with absent sub must fail even though it can execute RPC.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.eye_stock_snapshot(null);
    raise exception 'MISSING_SUB_RPC_UNEXPECTEDLY_SUCCEEDED';
  exception when sqlstate 'PT401' then checks:=checks+1;
  end;
  perform set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
  begin
    perform public.eye_stock_snapshot(null);
    raise exception 'UNENROLLED_RPC_UNEXPECTEDLY_SUCCEEDED';
  exception when sqlstate 'PT403' then checks:=checks+1;
  end;
  execute 'reset role';
  raise notice 'Isolated security checks passed: % (NOT an HTTP/JWT/concurrency test)',checks;
end;
$tests$;
rollback;
