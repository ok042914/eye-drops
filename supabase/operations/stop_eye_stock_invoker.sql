-- Emergency stop candidate. Separate incident authorization required. Eye objects only.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
revoke all on function public.eye_stock_snapshot(bigint),public.eye_stock_mutate(text,jsonb,uuid,bigint),
 public.eye_stock_operation_status(uuid),public.eye_stock_history(text,integer,date,uuid),public.eye_stock_enroll()
 from public,anon,authenticated,service_role;
revoke all on all functions in schema eye_stock from public,anon,authenticated,service_role;
-- Revoke both table and explicitly granted profile column privileges.
revoke all on all tables in schema eye_stock from public,anon,authenticated,service_role;
revoke insert(user_id),update(initialized_on,next_visit_on,revision) on eye_stock.profiles from authenticated;
revoke update(effective_on) on eye_stock.stock_movements from authenticated;
commit;
-- Does not terminate in-flight queries, delete data or alter any shared role.
