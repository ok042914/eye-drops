-- Simulated two-device sync through existing authenticated RPCs; no persistent test data.
-- No Auth or Lens writes. All temporary Eye data is rolled back, including on failure.
do $test$
declare uid uuid; first_revision bigint; op uuid:=gen_random_uuid(); result jsonb; day text:=to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD');
begin
  select u.id into uid from auth.users u where not exists(select 1 from eye_stock.profiles p where p.user_id=u.id) limit 1;
  if uid is null then raise exception 'NO_UNUSED_AUTH_UUID_FOR_ROLLBACK_TEST'; end if;
  begin
    insert into eye_stock.profiles(user_id) values(uid);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
    set local role authenticated;
    perform public.eye_stock_mutate('initialize',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication',jsonb_build_object('id','reserve-test','name','Reserve test','volumeMl',5,'timesPerDay',1,'parallel',1,'expirationDays',null,'expirationSource','','directions',''),'stock',2,'activeDates','[]'::jsonb,'historicalDates','[]'::jsonb)),'nextVisitOn',null),gen_random_uuid(),0);
    result:=public.eye_stock_snapshot(null);
    if result->>'reserveDays'<>'14' then raise exception 'DEFAULT_FAILED'; end if;
    first_revision:=(result->>'revision')::bigint;
    perform public.eye_stock_mutate('preferences','{"reserveDays":30}'::jsonb,op,first_revision);
    -- The other device still holds first_revision and must receive the new preference.
    result:=public.eye_stock_snapshot(first_revision);
    if result->>'reserveDays'<>'30' or result->>'unchanged'<>'false' or (result->>'revision')::bigint<>first_revision+1 then raise exception 'OTHER_DEVICE_SYNC_FAILED'; end if;
    result:=public.eye_stock_mutate('preferences','{"reserveDays":30}'::jsonb,op,first_revision);
    if result->>'replayed'<>'true' then raise exception 'REPLAY_FAILED'; end if;
    begin
      perform public.eye_stock_mutate('preferences','{"reserveDays":45}'::jsonb,op,first_revision);
      raise exception 'MISMATCH_ACCEPTED';
    exception when sqlstate 'PT409' then null; end;
    begin
      perform public.eye_stock_mutate('preferences','{"reserveDays":45}'::jsonb,gen_random_uuid(),first_revision);
      raise exception 'STALE_DEVICE_ACCEPTED';
    exception when sqlstate 'PT409' then null; end;
    begin
      perform public.eye_stock_mutate('preferences','{"reserveDays":91}'::jsonb,gen_random_uuid(),first_revision+1);
      raise exception 'INVALID_ACCEPTED';
    exception when sqlstate 'PT422' then null; end;
    begin
      perform public.eye_stock_mutate('preferences','{"reserveDays":0.5}'::jsonb,gen_random_uuid(),first_revision+1);
      raise exception 'FRACTION_ACCEPTED';
    exception when sqlstate 'PT422' then null; end;
    perform public.eye_stock_mutate('preferences','{"reserveDays":0}'::jsonb,gen_random_uuid(),first_revision+1);
    result:=public.eye_stock_snapshot(null);
    if result->>'reserveDays'<>'0' then raise exception 'ZERO_FAILED'; end if;
    if (select quantity from eye_stock.stock_balances where user_id=uid)<>2 or (select count(*) from eye_stock.stock_movements where user_id=uid)<>1 then raise exception 'INVENTORY_CHANGED'; end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
    begin
      perform public.eye_stock_mutate('preferences','{"reserveDays":30}'::jsonb,gen_random_uuid(),first_revision+2);
      raise exception 'OTHER_OWNER_ACCEPTED';
    exception when sqlstate 'PT403' then null; end;
    raise sqlstate 'ZX001' using message='ROLLBACK_SUCCESS';
  exception when sqlstate 'ZX001' then null;
  end;
  if exists(select 1 from eye_stock.profiles where user_id=uid) then raise exception 'TEST_DATA_REMAINED'; end if;
end;
$test$;
select 'passed: default, two-device snapshot, replay, stale revision, invalid input, zero, inventory unchanged, RLS, rollback' as result;
