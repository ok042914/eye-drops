-- REVIEW ONLY. Separate approval required. Stop Eye Drops API without deleting data or sessions.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $guard$
begin
  if obj_description(to_regnamespace('eye_stock'),'pg_namespace') is distinct from 'Eye Drops v1: eye_stock_v1' then
    raise exception 'EYE_UNRECOGNIZED_SCHEMA';
  end if;
end;
$guard$;
revoke all on function public.eye_stock_snapshot(bigint),public.eye_stock_mutate(text,jsonb,uuid,bigint),
  public.eye_stock_operation_status(uuid),public.eye_stock_history(text,integer,date,uuid) from public,anon,authenticated,service_role;
revoke all on function eye_stock.snapshot(bigint),eye_stock.mutate(text,jsonb,uuid,bigint),
  eye_stock.operation_status(uuid),eye_stock.history(text,integer,date,uuid) from public,anon,authenticated,service_role;
commit;
-- Already-running transactions are not forcibly terminated. Observe first; never kill pooled sessions indiscriminately.
