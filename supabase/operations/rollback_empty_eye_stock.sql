-- REVIEW ONLY. Destructive rollback ONLY BEFORE any profile/enrollment/data has been created.
-- For populated environments use stop_eye_stock.sql and retain data; restore/forward fix requires separate review.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $guard$
begin
  if obj_description(to_regnamespace('eye_stock'),'pg_namespace') is distinct from 'Eye Drops v1: eye_stock_v1' then
    raise exception 'EYE_UNRECOGNIZED_SCHEMA';
  end if;
  if exists(select 1 from eye_stock.profiles) then
    raise exception 'EYE_ROLLBACK_HAS_USER_DATA_STOP_ONLY';
  end if;
end;
$guard$;
drop function public.eye_stock_mutate(text,jsonb,uuid,bigint) restrict;
drop function public.eye_stock_operation_status(uuid) restrict;
drop function public.eye_stock_history(text,integer,date,uuid) restrict;
drop function public.eye_stock_snapshot(bigint) restrict;
drop function eye_stock.mutate(text,jsonb,uuid,bigint) restrict;
drop function eye_stock.operation_status(uuid) restrict;
drop function eye_stock.history(text,integer,date,uuid) restrict;
drop function eye_stock.snapshot(bigint) restrict;
drop function eye_stock.move_stock(uuid,text,integer,text,date,uuid,uuid,uuid,text) restrict;
drop function eye_stock.put_settings(uuid,jsonb,integer) restrict;
drop function eye_stock.require_user() restrict;
-- request_uid is used by table RLS policies: remove it after dropping tables.
drop function eye_stock.uuid_value(jsonb) restrict;
drop function eye_stock.date_value(jsonb,date,date) restrict;
drop function eye_stock.text_value(jsonb,integer,boolean) restrict;
drop function eye_stock.int_value(jsonb,integer,integer) restrict;
drop table eye_stock.audit_events restrict;
drop table eye_stock.stock_movements restrict;
drop table eye_stock.receipts restrict;
drop table eye_stock.prescriptions restrict;
drop table eye_stock.visits restrict;
drop table eye_stock.bottles restrict;
drop table eye_stock.stock_balances restrict;
alter table eye_stock.medications drop constraint eye_stock_current_settings_fk;
drop table eye_stock.medication_settings restrict;
drop table eye_stock.medications restrict;
drop table eye_stock.mutation_requests restrict;
drop table eye_stock.profiles restrict;
drop function eye_stock.request_uid() restrict;
drop schema eye_stock restrict;
drop role eye_stock_executor;
commit;
