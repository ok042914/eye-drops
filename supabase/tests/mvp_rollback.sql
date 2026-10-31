-- Run as the existing maintenance connection. No Auth writes or schema changes.
-- All test data is rolled back in the nested exception block, including on failure.
-- Uses one existing Auth UUID with no Eye profile; never returns personal data.
do $test$
declare
  uid uuid;
  day text:=to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD');
  op uuid:=gen_random_uuid();
  opened uuid;
  prescription uuid;
  result jsonb;
  payload jsonb;
begin
  select u.id into uid from auth.users u where not exists(select 1 from eye_stock.profiles p where p.user_id=u.id) limit 1;
  if uid is null then raise exception 'NO_UNUSED_AUTH_UUID_FOR_ROLLBACK_TEST'; end if;
  begin
    insert into eye_stock.profiles(user_id) values(uid);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
    set local role authenticated;
    payload:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
      'medication',jsonb_build_object('id','release-smoke','name','Release smoke','volumeMl',5,'timesPerDay',1,'parallel',1,'expirationDays',null,'expirationSource','','directions',''),
      'stock',2,'activeDates','[]'::jsonb,'historicalDates','[]'::jsonb)), 'nextVisitOn',null);
    result:=public.eye_stock_mutate('initialize',payload,op,0);
    if (result->>'completedRevision')::int<>1 then raise exception 'INITIALIZE_FAILED'; end if;
    result:=public.eye_stock_mutate('initialize',payload,op,0);
    if result->>'replayed'<>'true' then raise exception 'REPLAY_FAILED'; end if;
    begin
      perform public.eye_stock_mutate('open',jsonb_build_object('medicationId','release-smoke','date',day),gen_random_uuid(),0);
      raise exception 'STALE_REVISION_ACCEPTED';
    exception when sqlstate 'PT409' then null; end;
    result:=public.eye_stock_mutate('open',jsonb_build_object('medicationId','release-smoke','date',day),gen_random_uuid(),1);
    select id into opened from eye_stock.bottles where user_id=uid;
    if (select quantity from eye_stock.stock_balances where user_id=uid)<>1 then raise exception 'OPEN_STOCK_FAILED'; end if;
    perform public.eye_stock_mutate('end',jsonb_build_object('bottleId',opened,'date',day,'reason','empty'),gen_random_uuid(),2);
    if (select quantity from eye_stock.stock_balances where user_id=uid)<>1 then raise exception 'END_CHANGED_STOCK'; end if;
    perform public.eye_stock_mutate('receipt',jsonb_build_object('medicationId','release-smoke','prescribedOn',day,'prescribedQuantity',2,'receivedOn',null,'receivedQuantity',0,'note',''),gen_random_uuid(),3);
    select id into prescription from eye_stock.prescriptions where user_id=uid;
    if (select quantity from eye_stock.stock_balances where user_id=uid)<>1 then raise exception 'PRESCRIPTION_CHANGED_STOCK'; end if;
    perform public.eye_stock_mutate('receive',jsonb_build_object('receiptId',prescription,'date',day,'quantity',2),gen_random_uuid(),4);
    if (select quantity from eye_stock.stock_balances where user_id=uid)<>3 then raise exception 'RECEIVE_FAILED'; end if;
    perform public.eye_stock_mutate('cancel_receipt',jsonb_build_object('receiptId',prescription),gen_random_uuid(),5);
    perform public.eye_stock_mutate('adjust',jsonb_build_object('medicationId','release-smoke','quantity',0,'note','release test'),gen_random_uuid(),6);
    begin
      perform public.eye_stock_mutate('open',jsonb_build_object('medicationId','release-smoke','date',day),gen_random_uuid(),7);
      raise exception 'NEGATIVE_STOCK_ACCEPTED';
    exception when sqlstate 'PT422' or sqlstate 'PT409' then null; end;
    if (select revision from eye_stock.profiles where user_id=uid)<>7 or (select quantity from eye_stock.stock_balances where user_id=uid)<>0 then raise exception 'FAILED_WRITE_NOT_ATOMIC'; end if;
    result:=public.eye_stock_history('bottles',100,null,null);
    if jsonb_array_length(result->'items')<>1 then raise exception 'HISTORY_FAILED'; end if;
    result:=public.eye_stock_operation_status(op);
    if result->>'status'<>'committed' then raise exception 'OPERATION_STATUS_FAILED'; end if;
    result:=public.eye_stock_snapshot(7);
    if result->>'unchanged'<>'true' then raise exception 'SNAPSHOT_FAILED'; end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
    if exists(select 1 from eye_stock.stock_balances) then raise exception 'OWNER_ISOLATION_FAILED'; end if;
    begin
      perform public.eye_stock_snapshot(null);
      raise exception 'UNENROLLED_USER_ACCEPTED';
    exception when sqlstate 'PT403' then null; end;
    raise sqlstate 'ZX001' using message='ROLLBACK_SUCCESS';
  exception when sqlstate 'ZX001' then null;
  end;
  if exists(select 1 from eye_stock.profiles where user_id=uid) then raise exception 'TEST_DATA_REMAINED'; end if;
end;
$test$;
select 'passed: initialize, replay, conflict, open, end, prescription, receive, cancel, adjust, atomicity, history, status, snapshot, RLS; all test data rolled back' as result;
