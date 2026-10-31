-- Eye Drops v1 MVP: SECURITY INVOKER + private tables + per-user RLS.
-- No custom role, role membership, Auth settings, or existing app changes.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $preflight$
begin
  if exists(select 1 from pg_namespace where nspname='eye_stock')
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,10)='eye_stock_') then
    raise exception 'EYE_NAMESPACE_EXISTS_REVIEW_REQUIRED';
  end if;
end;
$preflight$;
create schema eye_stock;
comment on schema eye_stock is 'Eye Drops v1: eye_stock_v1';
revoke all on schema eye_stock from public, anon, authenticated, service_role;
grant usage on schema eye_stock to authenticated;

create table eye_stock.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  enabled boolean not null default true,
  initialized_on date,
  next_visit_on date,
  revision bigint not null default 0 check(revision between 0 and 9007199254740990),
  created_at timestamptz not null default now()
);
create table eye_stock.medications (
  user_id uuid not null references eye_stock.profiles(user_id) on delete restrict,
  id text not null check(length(id) between 1 and 100),
  current_version integer not null check(current_version > 0),
  created_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table eye_stock.medication_settings (
  user_id uuid not null,
  medication_id text not null,
  version integer not null check(version > 0),
  name text not null check(length(btrim(name)) between 1 and 60),
  volume_ml numeric not null check(volume_ml > 0 and volume_ml <= 100),
  times_per_day integer not null check(times_per_day between 1 and 12),
  parallel integer not null check(parallel between 1 and 4),
  expiration_days integer check(expiration_days between 1 and 365),
  expiration_source text not null default '' check(length(expiration_source)<=300),
  directions text not null check(length(directions)<=120),
  created_at timestamptz not null default now(),
  primary key(user_id,medication_id,version),
  foreign key(user_id,medication_id) references eye_stock.medications(user_id,id) on delete restrict,
  check(expiration_days is null or length(btrim(expiration_source))>0)
);
alter table eye_stock.medications add constraint eye_stock_current_settings_fk
  foreign key(user_id,id,current_version) references eye_stock.medication_settings(user_id,medication_id,version)
  deferrable initially deferred;
create table eye_stock.stock_balances (
  user_id uuid not null,
  medication_id text not null,
  quantity integer not null check(quantity between 0 and 100000),
  primary key(user_id,medication_id),
  foreign key(user_id,medication_id) references eye_stock.medications(user_id,id) on delete restrict
);
create table eye_stock.mutation_requests (
  user_id uuid not null references eye_stock.profiles(user_id) on delete restrict,
  operation_id uuid not null,
  action text not null check(length(action) between 1 and 40),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=131072),
  completed_revision bigint not null check(completed_revision between 1 and 9007199254740990),
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
create table eye_stock.bottles (
  user_id uuid not null,
  id uuid not null default gen_random_uuid(),
  medication_id text not null,
  settings_version integer not null,
  opened_on date not null check(opened_on >= date '2026-06-01'),
  origin text not null check(origin in ('initial','historical','normal')),
  status text not null check(status in ('in_use','finished','discarded','historical','cancelled')),
  ended_on date,
  end_reason text check(end_reason in ('empty','discarded')),
  replaces_id uuid,
  created_at timestamptz not null default now(),
  primary key(user_id,id),
  unique(user_id,id,medication_id),
  foreign key(user_id,medication_id,settings_version) references eye_stock.medication_settings(user_id,medication_id,version) on delete restrict,
  foreign key(user_id,replaces_id,medication_id) references eye_stock.bottles(user_id,id,medication_id) on delete restrict,
  check(replaces_id is null or replaces_id<>id),
  check(ended_on is null or ended_on>=opened_on),
  check((status='finished' and end_reason='empty' and ended_on is not null)
    or (status='discarded' and end_reason='discarded' and ended_on is not null)
    or (status in ('in_use','historical','cancelled') and ended_on is null and end_reason is null)),
  check(status<>'historical' or origin='historical')
);
create unique index eye_stock_one_successor on eye_stock.bottles(user_id,replaces_id)
  where replaces_id is not null and status<>'cancelled';
create index eye_stock_bottles_date on eye_stock.bottles(user_id,medication_id,opened_on desc,id desc);
create index eye_stock_bottles_active on eye_stock.bottles(user_id,medication_id) where status='in_use';
create index eye_stock_bottles_settings on eye_stock.bottles(user_id,medication_id,settings_version);
create index eye_stock_bottles_predecessor on eye_stock.bottles(user_id,replaces_id,medication_id);
create table eye_stock.visits (
  user_id uuid not null references eye_stock.profiles(user_id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  visit_on date not null check(visit_on>=date '2026-06-01'),
  next_visit_on date not null,
  note text not null default '' check(length(note)<=500),
  primary key(user_id,id),
  check(next_visit_on>visit_on)
);
create index eye_stock_visits_date on eye_stock.visits(user_id,visit_on desc,id desc);
create table eye_stock.prescriptions (
  user_id uuid not null,
  id uuid not null default gen_random_uuid(),
  medication_id text not null,
  prescribed_on date not null check(prescribed_on>=date '2026-06-01'),
  prescribed_quantity integer not null check(prescribed_quantity between 1 and 100000),
  visit_id uuid,
  note text not null default '' check(length(note)<=500),
  cancelled boolean not null default false,
  primary key(user_id,id),
  unique(user_id,id,medication_id),
  foreign key(user_id,medication_id) references eye_stock.medications(user_id,id) on delete restrict,
  foreign key(user_id,visit_id) references eye_stock.visits(user_id,id) on delete restrict
);
create index eye_stock_prescriptions_date on eye_stock.prescriptions(user_id,prescribed_on desc,id desc);
create index eye_stock_prescriptions_med on eye_stock.prescriptions(user_id,medication_id);
create index eye_stock_prescriptions_visit on eye_stock.prescriptions(user_id,visit_id);
create table eye_stock.receipts (
  user_id uuid not null,
  id uuid not null default gen_random_uuid(),
  prescription_id uuid not null,
  medication_id text not null,
  received_on date not null,
  quantity integer not null check(quantity between 1 and 100000),
  cancelled boolean not null default false,
  primary key(user_id,id),
  unique(user_id,prescription_id), -- v1: one receipt, no partial follow-up receipts
  foreign key(user_id,prescription_id,medication_id) references eye_stock.prescriptions(user_id,id,medication_id) on delete restrict
);
create index eye_stock_receipts_date on eye_stock.receipts(user_id,received_on desc,id desc);
create index eye_stock_receipts_prescription on eye_stock.receipts(user_id,prescription_id,medication_id);
create table eye_stock.stock_movements (
  user_id uuid not null,
  id uuid not null default gen_random_uuid(),
  medication_id text not null,
  delta integer not null check(delta between -100000 and 100000),
  kind text not null check(kind in ('initial','opening','opening_cancel','receipt','receipt_correction','adjustment')),
  effective_on date not null,
  bottle_id uuid,
  prescription_id uuid,
  operation_id uuid not null,
  note text not null default '' check(length(note)<=500),
  created_at timestamptz not null default now(),
  primary key(user_id,id),
  foreign key(user_id,medication_id) references eye_stock.medications(user_id,id) on delete restrict,
  foreign key(user_id,bottle_id,medication_id) references eye_stock.bottles(user_id,id,medication_id) on delete restrict,
  foreign key(user_id,prescription_id,medication_id) references eye_stock.prescriptions(user_id,id,medication_id) on delete restrict,
  foreign key(user_id,operation_id) references eye_stock.mutation_requests(user_id,operation_id) on delete restrict,
  check((kind='opening' and delta=-1 and bottle_id is not null and prescription_id is null)
    or (kind='opening_cancel' and delta=1 and bottle_id is not null and prescription_id is null)
    or (kind='receipt' and delta>0 and prescription_id is not null and bottle_id is null)
    or (kind='receipt_correction' and delta<0 and prescription_id is not null and bottle_id is null)
    or (kind='initial' and delta>=0 and bottle_id is null and prescription_id is null)
    or (kind='adjustment' and bottle_id is null and prescription_id is null))
);
create unique index eye_stock_initial_once on eye_stock.stock_movements(user_id,medication_id) where kind='initial';
create unique index eye_stock_bottle_movement_once on eye_stock.stock_movements(user_id,bottle_id,kind) where bottle_id is not null;
create unique index eye_stock_receipt_movement_once on eye_stock.stock_movements(user_id,prescription_id,kind) where prescription_id is not null;
create index eye_stock_movements_med on eye_stock.stock_movements(user_id,medication_id,effective_on desc,id desc);
create index eye_stock_movements_date on eye_stock.stock_movements(user_id,effective_on desc,id desc);
create index eye_stock_movements_bottle on eye_stock.stock_movements(user_id,bottle_id,medication_id);
create index eye_stock_movements_prescription on eye_stock.stock_movements(user_id,prescription_id,medication_id);
create index eye_stock_movements_operation on eye_stock.stock_movements(user_id,operation_id);
create table eye_stock.audit_events (
  user_id uuid not null,
  id uuid not null default gen_random_uuid(),
  operation_id uuid not null,
  action text not null,
  created_at timestamptz not null default now(),
  primary key(user_id,id),
  foreign key(user_id,operation_id) references eye_stock.mutation_requests(user_id,operation_id) on delete restrict
);
create index eye_stock_audit_operation on eye_stock.audit_events(user_id,operation_id);

-- Same verified PostgREST claim source as auth.uid(), without granting access to shared auth objects.
-- No caller-provided user_id is accepted. Direct SQL sessions must not be exposed to application users.
create function eye_stock.request_uid() returns uuid
language plpgsql stable security invoker set search_path='' as $fn$
declare claims text; result uuid;
begin
  claims:=nullif(current_setting('request.jwt.claims',true),'');
  if claims is null then return null; end if;
  begin result:=nullif((claims::jsonb)->>'sub','')::uuid;
  exception when invalid_text_representation then return null;
  end;
  return result;
end;
$fn$;

-- Every API query runs as authenticated; table ownership stays with the migration operator.
-- Private schema is not exposed by Data API. RLS also checks explicit Eye enrollment.
do $rls$
declare tbl text;
begin
  foreach tbl in array array['profiles','medications','medication_settings','stock_balances','mutation_requests','bottles','visits','prescriptions','receipts','stock_movements','audit_events'] loop
    execute format('alter table eye_stock.%I enable row level security',tbl);
    execute format('alter table eye_stock.%I force row level security',tbl);
    execute format('revoke all on table eye_stock.%I from public,anon,authenticated,service_role',tbl);
    if tbl='profiles' then
      execute 'create policy own_rows on eye_stock.profiles for select to authenticated using ((select eye_stock.request_uid())=user_id and enabled)';
      execute 'create policy own_update on eye_stock.profiles for update to authenticated using ((select eye_stock.request_uid())=user_id and enabled) with check ((select eye_stock.request_uid())=user_id and enabled)';
      execute 'create policy verified_enrollment on eye_stock.profiles for insert to authenticated with check ((select eye_stock.request_uid())=user_id and sha256(convert_to(lower(current_setting(''request.jwt.claims'',true)::jsonb->>''email''),''UTF8''))=decode(''4b5fbb2c9490bb19b9ecb5a0c0222d450316d17e16fe0d0118851823d82991a7'',''hex'') and current_setting(''request.jwt.claims'',true)::jsonb->''amr'' @> ''[{"method":"otp"}]''::jsonb)';
    else
      execute format('create policy own_rows on eye_stock.%I for all to authenticated using ((select eye_stock.request_uid())=user_id and exists(select 1 from eye_stock.profiles p where p.user_id=(select eye_stock.request_uid()) and p.enabled)) with check ((select eye_stock.request_uid())=user_id and exists(select 1 from eye_stock.profiles p where p.user_id=(select eye_stock.request_uid()) and p.enabled))',tbl);
    end if;
  end loop;
end;
$rls$;
grant select on eye_stock.profiles to authenticated;
grant insert(user_id) on eye_stock.profiles to authenticated;
grant update(initialized_on,next_visit_on,revision) on eye_stock.profiles to authenticated;
grant select,insert,update on eye_stock.medications,eye_stock.stock_balances,eye_stock.bottles,eye_stock.prescriptions,eye_stock.receipts to authenticated;
grant select,insert on eye_stock.medication_settings,eye_stock.mutation_requests,eye_stock.visits,eye_stock.stock_movements,eye_stock.audit_events to authenticated;
grant update(effective_on) on eye_stock.stock_movements to authenticated;

-- Validators use safe public error markers and never interpolate caller values into SQL.
create function eye_stock.int_value(value jsonb, lo integer, hi integer) returns integer
language plpgsql immutable security invoker set search_path='' as $fn$
declare n numeric;
begin
  if jsonb_typeof(value) is distinct from 'number' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  n:=value::text::numeric;
  if n<>trunc(n) or n<lo or n>hi then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  return n::integer;
end;
$fn$;
create function eye_stock.text_value(value jsonb, maximum integer, required boolean default false) returns text
language plpgsql immutable security invoker set search_path='' as $fn$
declare s text;
begin
  if jsonb_typeof(value) is distinct from 'string' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  s:=value #>> '{}';
  if length(s)>maximum or (required and length(btrim(s))=0) then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  return s;
end;
$fn$;
create function eye_stock.date_value(value jsonb, first_day date, last_day date) returns date
language plpgsql immutable security invoker set search_path='' as $fn$
declare s text; d date;
begin
  s:=eye_stock.text_value(value,10,true);
  if s!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise sqlstate 'PT422' using message='EYE_INVALID_DATE'; end if;
  begin d:=s::date; exception when invalid_datetime_format or datetime_field_overflow then
    raise sqlstate 'PT422' using message='EYE_INVALID_DATE';
  end;
  if to_char(d,'YYYY-MM-DD')<>s or d<first_day or d>last_day then raise sqlstate 'PT422' using message='EYE_INVALID_DATE'; end if;
  return d;
end;
$fn$;
create function eye_stock.uuid_value(value jsonb) returns uuid
language plpgsql immutable security invoker set search_path='' as $fn$
declare s text;
begin
  s:=eye_stock.text_value(value,36,true);
  if s!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  return s::uuid;
end;
$fn$;
create function eye_stock.require_user() returns uuid
language plpgsql stable security invoker set search_path='' as $fn$
declare uid uuid:=eye_stock.request_uid();
begin
  if uid is null then raise sqlstate 'PT401' using message='EYE_AUTH_REQUIRED'; end if;
  if not exists(select 1 from eye_stock.profiles p where p.user_id=uid and p.enabled) then
    raise sqlstate 'PT403' using message='EYE_NOT_ALLOWED';
  end if;
  return uid;
end;
$fn$;
create function eye_stock.put_settings(uid uuid, data jsonb, setting_version integer) returns text
language plpgsql volatile security invoker set search_path='' as $fn$
declare mid text; volume numeric; expiration integer;
begin
  if jsonb_typeof(data) is distinct from 'object' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  mid:=eye_stock.text_value(data->'id',100,true);
  if jsonb_typeof(data->'volumeMl') is distinct from 'number' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  volume:=(data->>'volumeMl')::numeric;
  if volume<=0 or volume>100 then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  if data->'expirationDays' is distinct from 'null'::jsonb then expiration:=eye_stock.int_value(data->'expirationDays',1,365); end if;
  insert into eye_stock.medication_settings(user_id,medication_id,version,name,volume_ml,times_per_day,parallel,expiration_days,expiration_source,directions)
    values(uid,mid,setting_version,eye_stock.text_value(data->'name',60,true),volume,
      eye_stock.int_value(data->'timesPerDay',1,12),eye_stock.int_value(data->'parallel',1,4),expiration,
      eye_stock.text_value(data->'expirationSource',300,false),eye_stock.text_value(data->'directions',120,false));
  return mid;
end;
$fn$;
create function eye_stock.move_stock(uid uuid, mid text, amount integer, movement_kind text, day date, op uuid,
  bottle uuid default null, prescription uuid default null, memo text default '') returns void
language plpgsql volatile security invoker set search_path='' as $fn$
declare changed integer;
begin
  update eye_stock.stock_balances set quantity=quantity+amount
    where user_id=uid and medication_id=mid and quantity+amount between 0 and 100000;
  get diagnostics changed=row_count;
  if changed<>1 then raise sqlstate 'PT422' using message='EYE_STOCK_RANGE'; end if;
  insert into eye_stock.stock_movements(user_id,medication_id,delta,kind,effective_on,operation_id,bottle_id,prescription_id,note)
    values(uid,mid,amount,movement_kind,day,op,bottle,prescription,memo);
end;
$fn$;

-- Snapshot is bounded. It is NOT a full serialized Phase-2 State; adapter contract is documented.
create function eye_stock.snapshot(known_revision bigint default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare uid uuid:=eye_stock.require_user(); result jsonb;
begin
  select jsonb_build_object('apiVersion',1,'initializedOn',p.initialized_on,'nextVisitOn',p.next_visit_on,'revision',p.revision,
    'unchanged',known_revision is not null and known_revision=p.revision,
    'medications',case when known_revision=p.revision then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(s)-'user_id'||jsonb_build_object('stock',b.quantity))
      from eye_stock.medications m join eye_stock.medication_settings s on s.user_id=m.user_id and s.medication_id=m.id and s.version=m.current_version
      join eye_stock.stock_balances b on b.user_id=m.user_id and b.medication_id=m.id where m.user_id=uid),'[]'::jsonb) end,
    'bottles',case when known_revision=p.revision then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(selected)-'user_id') from (
      select distinct on (b.id) b.*,s.parallel,s.expiration_days from eye_stock.medications m
      cross join lateral (select x.* from eye_stock.bottles x where x.user_id=uid and x.medication_id=m.id and x.settings_version=m.current_version and x.status<>'cancelled'
        order by x.opened_on desc,x.id desc limit 32) b
      join eye_stock.medication_settings s on s.user_id=b.user_id and s.medication_id=b.medication_id and s.version=b.settings_version where m.user_id=uid
      union
      select b.*,s.parallel,s.expiration_days from eye_stock.bottles b join eye_stock.medication_settings s on s.user_id=b.user_id and s.medication_id=b.medication_id and s.version=b.settings_version
        where b.user_id=uid and b.status='in_use'
      union
      select b.*,s.parallel,s.expiration_days from eye_stock.medications m cross join lateral (
        select x.* from eye_stock.bottles x where x.user_id=uid and x.medication_id=m.id and x.settings_version=m.current_version and x.status='finished' and x.end_reason='empty'
          order by x.ended_on desc,x.id desc limit 3) b
      join eye_stock.medication_settings s on s.user_id=b.user_id and s.medication_id=b.medication_id and s.version=b.settings_version where m.user_id=uid
    ) selected),'[]'::jsonb) end)
    into result from eye_stock.profiles p where p.user_id=uid;
  return result;
end;
$fn$;

create function eye_stock.mutate(action text, payload jsonb, operation_id uuid, expected_revision bigint) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='1s' as $fn$
declare
  uid uuid:=eye_stock.require_user(); profile eye_stock.profiles; previous eye_stock.mutation_requests;
  today date:=(now() at time zone 'Asia/Tokyo')::date; day date; next_day date; received_day date;
  mid text; target uuid; new_id uuid; replace_id uuid; visit_id uuid;
  quantity integer; received_quantity integer; settings_version integer; current_quantity integer; parallel_count integer;
  reason text; memo text; med_data jsonb; item jsonb; item_date jsonb; previous_bottle eye_stock.bottles;
  setting eye_stock.medication_settings; prescription eye_stock.prescriptions; receipt eye_stock.receipts;
  candidate eye_stock.bottles; allowed_keys text[];
begin
  if operation_id is null or expected_revision is null or expected_revision<0
    or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>131072 then
    raise sqlstate 'PT422' using message='EYE_INVALID';
  end if;
  allowed_keys:=case action
    when 'initialize' then array['items','nextVisitOn']
    when 'open' then array['medicationId','date','replaceId','replacementReason']
    when 'import' then array['medicationId','date']
    when 'end' then array['bottleId','date','reason']
    when 'edit_opening' then array['bottleId','date']
    when 'cancel_opening' then array['bottleId']
    when 'receipt' then array['medicationId','prescribedOn','prescribedQuantity','receivedOn','receivedQuantity','note','visitId']
    when 'receive' then array['receiptId','date','quantity']
    when 'cancel_receipt' then array['receiptId']
    when 'adjust' then array['medicationId','quantity','note']
    when 'visit' then array['date','nextDate','note']
    when 'settings' then array['medication']
    when 'add_medication' then array['medication','stock'] end;
  if allowed_keys is null or exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed_keys))) then
    raise sqlstate 'PT422' using message='EYE_INVALID_ACTION';
  end if;
  -- Serialize ALL commands for this owner. No advisory hash collisions or cross-user locks.
  select * into profile from eye_stock.profiles p where p.user_id=uid and p.enabled for update;
  if not found then raise sqlstate 'PT403' using message='EYE_NOT_ALLOWED'; end if;
  -- Replay check must precede revision check. JSONB equality compares complete payload, not a weak hash.
  select * into previous from eye_stock.mutation_requests r where r.user_id=uid and r.operation_id=mutate.operation_id;
  if found then
    if previous.action is distinct from action or previous.payload is distinct from payload then
      raise sqlstate 'PT409' using message='EYE_RETRY_MISMATCH';
    end if;
    return jsonb_build_object('replayed',true,'operationId',operation_id,'completedRevision',previous.completed_revision,'snapshot',eye_stock.snapshot(null));
  end if;
  if profile.revision<>expected_revision then raise sqlstate 'PT409' using message='EYE_CONFLICT'; end if;
  if profile.revision>=9007199254740990 then raise sqlstate 'PT422' using message='EYE_REVISION_LIMIT'; end if;
  if action='initialize' then
    if profile.initialized_on is not null then raise sqlstate 'PT409' using message='EYE_ALREADY_INITIALIZED'; end if;
  elsif profile.initialized_on is null then raise sqlstate 'PT422' using message='EYE_INITIAL_REQUIRED'; end if;
  -- This command row, all ledger entries and all records commit or rollback together.
  insert into eye_stock.mutation_requests(user_id,operation_id,action,payload,completed_revision)
    values(uid,operation_id,action,payload,profile.revision+1);

  if action in ('initialize','add_medication') then
    if action='initialize' then
      if jsonb_typeof(payload->'items') is distinct from 'array' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
      if jsonb_array_length(payload->'items') not between 1 and 20 then raise sqlstate 'PT422' using message='EYE_LIMIT'; end if;
      if payload->'nextVisitOn' is not null and payload->'nextVisitOn'<>'null'::jsonb then
        next_day:=eye_stock.date_value(payload->'nextVisitOn',today,today+730);
      end if;
      update eye_stock.profiles set initialized_on=today,next_visit_on=next_day where user_id=uid;
    elsif (select count(*) from eye_stock.medications m where m.user_id=uid)>=20 then
      raise sqlstate 'PT422' using message='EYE_MEDICATION_LIMIT';
    end if;
    for item in select value from jsonb_array_elements(case when action='initialize' then payload->'items'
      else jsonb_build_array(jsonb_build_object('medication',payload->'medication','stock',payload->'stock','activeDates','[]'::jsonb,'historicalDates','[]'::jsonb)) end) loop
      med_data:=item->'medication'; mid:=eye_stock.text_value(med_data->'id',100,true);
      if exists(select 1 from eye_stock.medications m where m.user_id=uid and m.id=mid) then raise sqlstate 'PT409' using message='EYE_DUPLICATE_MEDICATION'; end if;
      quantity:=eye_stock.int_value(item->'stock',0,100000);
      if jsonb_typeof(item->'activeDates') is distinct from 'array' or jsonb_typeof(item->'historicalDates') is distinct from 'array' then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
      parallel_count:=eye_stock.int_value(med_data->'parallel',1,4);
      if jsonb_array_length(item->'activeDates')>parallel_count or jsonb_array_length(item->'historicalDates')>500 then raise sqlstate 'PT422' using message='EYE_LIMIT'; end if;
      insert into eye_stock.medications(user_id,id,current_version) values(uid,mid,1);
      perform eye_stock.put_settings(uid,med_data,1);
      insert into eye_stock.stock_balances(user_id,medication_id,quantity) values(uid,mid,0);
      perform eye_stock.move_stock(uid,mid,quantity,'initial',today,operation_id,null,null,'現在の実数。過去履歴からは減算しません。');
      for item_date in select value from jsonb_array_elements(item->'activeDates') loop
        day:=eye_stock.date_value(item_date,date '2026-06-01',today);
        insert into eye_stock.bottles(user_id,medication_id,settings_version,opened_on,origin,status) values(uid,mid,1,day,'initial','in_use');
      end loop;
      for item_date in select value from jsonb_array_elements(item->'historicalDates') loop
        day:=eye_stock.date_value(item_date,date '2026-06-01',today);
        insert into eye_stock.bottles(user_id,medication_id,settings_version,opened_on,origin,status) values(uid,mid,1,day,'historical','historical');
      end loop;
    end loop;
  else
    if action in ('open','import','receipt','adjust') then
      mid:=eye_stock.text_value(payload->'medicationId',100,true);
      select s.* into setting from eye_stock.medications m join eye_stock.medication_settings s
        on s.user_id=m.user_id and s.medication_id=m.id and s.version=m.current_version where m.user_id=uid and m.id=mid;
      if not found then raise sqlstate 'PT404' using message='EYE_MEDICATION_NOT_FOUND'; end if;
    end if;
    case action
    when 'open' then
      day:=eye_stock.date_value(payload->'date',profile.initialized_on,today);
      if payload->'replaceId' is not null and payload->'replaceId'<>'null'::jsonb then
        replace_id:=eye_stock.uuid_value(payload->'replaceId');
        reason:=eye_stock.text_value(payload->'replacementReason',20,true);
        if reason not in ('empty','discarded') then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
        select * into previous_bottle from eye_stock.bottles b where b.user_id=uid and b.id=replace_id and b.medication_id=mid and b.status='in_use';
        if not found or previous_bottle.opened_on>day then raise sqlstate 'PT422' using message='EYE_INVALID_REPLACEMENT'; end if;
        update eye_stock.bottles set status=case reason when 'empty' then 'finished' else 'discarded' end,ended_on=day,end_reason=reason where user_id=uid and id=replace_id;
      end if;
      if (select count(*) from eye_stock.bottles b where b.user_id=uid and b.medication_id=mid and b.status='in_use')>=setting.parallel then
        raise sqlstate 'PT409' using message='EYE_ACTIVE_LIMIT';
      end if;
      insert into eye_stock.bottles(user_id,medication_id,settings_version,opened_on,origin,status,replaces_id)
        values(uid,mid,setting.version,day,'normal','in_use',replace_id) returning id into new_id;
      perform eye_stock.move_stock(uid,mid,-1,'opening',day,operation_id,new_id,null,'1本開封');
    when 'import' then
      day:=eye_stock.date_value(payload->'date',date '2026-06-01',today);
      insert into eye_stock.bottles(user_id,medication_id,settings_version,opened_on,origin,status)
        values(uid,mid,setting.version,day,'historical','historical'); -- NO inventory movement
    when 'end' then
      target:=eye_stock.uuid_value(payload->'bottleId'); reason:=eye_stock.text_value(payload->'reason',20,true);
      select * into candidate from eye_stock.bottles b where b.user_id=uid and b.id=target and b.status='in_use';
      if not found or reason not in ('empty','discarded') then raise sqlstate 'PT422' using message='EYE_BOTTLE_NOT_ACTIVE'; end if;
      day:=eye_stock.date_value(payload->'date',candidate.opened_on,today);
      update eye_stock.bottles set status=case reason when 'empty' then 'finished' else 'discarded' end,ended_on=day,end_reason=reason where user_id=uid and id=target;
      -- NO inventory movement: already-opened stock was consumed at opening.
    when 'edit_opening','cancel_opening' then
      target:=eye_stock.uuid_value(payload->'bottleId');
      select * into candidate from eye_stock.bottles b where b.user_id=uid and b.id=target and b.status<>'cancelled';
      if not found then raise sqlstate 'PT404' using message='EYE_BOTTLE_NOT_FOUND'; end if;
      if action='edit_opening' then
        day:=eye_stock.date_value(payload->'date',case when candidate.origin='normal' then profile.initialized_on else date '2026-06-01' end,coalesce(candidate.ended_on,today));
        if candidate.replaces_id is not null and day<>candidate.opened_on then raise sqlstate 'PT409' using message='EYE_DEPENDENCY'; end if;
        update eye_stock.bottles set opened_on=day where user_id=uid and id=target;
        update eye_stock.stock_movements set effective_on=day where user_id=uid and bottle_id=target and kind='opening';
      else
        if candidate.ended_on is not null or candidate.replaces_id is not null or exists(select 1 from eye_stock.bottles b where b.user_id=uid and b.replaces_id=target and b.status<>'cancelled') then
          raise sqlstate 'PT409' using message='EYE_DEPENDENCY';
        end if;
        update eye_stock.bottles set status='cancelled' where user_id=uid and id=target;
        if candidate.origin='normal' then perform eye_stock.move_stock(uid,candidate.medication_id,1,'opening_cancel',today,operation_id,target,null,'実際には開封していなかった記録の訂正'); end if;
      end if;
    when 'receipt' then
      day:=eye_stock.date_value(payload->'prescribedOn',date '2026-06-01',today);
      quantity:=eye_stock.int_value(payload->'prescribedQuantity',1,100000);
      received_quantity:=eye_stock.int_value(payload->'receivedQuantity',0,100000);
      memo:=eye_stock.text_value(payload->'note',500,false);
      if payload->'visitId' is not null and payload->'visitId'<>'null'::jsonb then
        visit_id:=eye_stock.uuid_value(payload->'visitId');
        if not exists(select 1 from eye_stock.visits v where v.user_id=uid and v.id=visit_id) then raise sqlstate 'PT404' using message='EYE_VISIT_NOT_FOUND'; end if;
      end if;
      if payload->'receivedOn' is not null and payload->'receivedOn'<>'null'::jsonb then
        received_day:=eye_stock.date_value(payload->'receivedOn',greatest(day,profile.initialized_on),today);
        if received_quantity=0 or received_quantity>quantity then raise sqlstate 'PT422' using message='EYE_INVALID_RECEIPT'; end if;
      elsif received_quantity<>0 then raise sqlstate 'PT422' using message='EYE_INVALID_RECEIPT'; end if;
      insert into eye_stock.prescriptions(user_id,medication_id,prescribed_on,prescribed_quantity,visit_id,note)
        values(uid,mid,day,quantity,visit_id,memo) returning id into new_id;
      if received_day is not null then
        insert into eye_stock.receipts(user_id,prescription_id,medication_id,received_on,quantity) values(uid,new_id,mid,received_day,received_quantity);
        perform eye_stock.move_stock(uid,mid,received_quantity,'receipt',received_day,operation_id,null,new_id,'実際の受取');
      end if;
    when 'receive','cancel_receipt' then
      -- Phase-2 Receipt.id maps to prescriptions.id; physical receipt ID is separate.
      target:=eye_stock.uuid_value(payload->'receiptId');
      select * into prescription from eye_stock.prescriptions p where p.user_id=uid and p.id=target and not p.cancelled;
      if not found then raise sqlstate 'PT404' using message='EYE_PRESCRIPTION_NOT_FOUND'; end if;
      select * into receipt from eye_stock.receipts r where r.user_id=uid and r.prescription_id=target;
      if action='receive' then
        if found then raise sqlstate 'PT409' using message='EYE_ALREADY_RECEIVED'; end if;
        day:=eye_stock.date_value(payload->'date',greatest(prescription.prescribed_on,profile.initialized_on),today);
        quantity:=eye_stock.int_value(payload->'quantity',1,prescription.prescribed_quantity);
        insert into eye_stock.receipts(user_id,prescription_id,medication_id,received_on,quantity) values(uid,target,prescription.medication_id,day,quantity);
        perform eye_stock.move_stock(uid,prescription.medication_id,quantity,'receipt',day,operation_id,null,target,'後日の実受取');
      else
        if found then
          perform eye_stock.move_stock(uid,prescription.medication_id,-receipt.quantity,'receipt_correction',today,operation_id,null,target,'受取取消');
          update eye_stock.receipts set cancelled=true where user_id=uid and prescription_id=target;
        end if;
        update eye_stock.prescriptions set cancelled=true where user_id=uid and id=target;
      end if;
    when 'adjust' then
      quantity:=eye_stock.int_value(payload->'quantity',0,100000); memo:=eye_stock.text_value(payload->'note',500,true);
      select b.quantity into current_quantity from eye_stock.stock_balances b where b.user_id=uid and b.medication_id=mid;
      perform eye_stock.move_stock(uid,mid,quantity-current_quantity,'adjustment',today,operation_id,null,null,memo);
    when 'visit' then
      day:=eye_stock.date_value(payload->'date',date '2026-06-01',today);
      next_day:=eye_stock.date_value(payload->'nextDate',day+1,date '2099-12-31'); memo:=eye_stock.text_value(payload->'note',500,false);
      insert into eye_stock.visits(user_id,visit_on,next_visit_on,note) values(uid,day,next_day,memo);
      update eye_stock.profiles set next_visit_on=(select v.next_visit_on from eye_stock.visits v where v.user_id=uid order by v.visit_on desc,v.id desc limit 1) where user_id=uid;
    when 'settings' then
      med_data:=payload->'medication'; mid:=eye_stock.text_value(med_data->'id',100,true);
      select m.current_version into settings_version from eye_stock.medications m where m.user_id=uid and m.id=mid;
      if not found then raise sqlstate 'PT404' using message='EYE_MEDICATION_NOT_FOUND'; end if;
      parallel_count:=eye_stock.int_value(med_data->'parallel',1,4);
      if (select count(*) from eye_stock.bottles b where b.user_id=uid and b.medication_id=mid and b.status='in_use')>parallel_count then
        raise sqlstate 'PT409' using message='EYE_ACTIVE_LIMIT';
      end if;
      perform eye_stock.put_settings(uid,med_data,settings_version+1);
      update eye_stock.medications set current_version=settings_version+1 where user_id=uid and id=mid;
    else raise sqlstate 'PT422' using message='EYE_INVALID_ACTION';
    end case;
  end if;

  -- Postcondition for affected owner, bounded by 20 medications. Ledger is authoritative.
  if exists(select 1 from eye_stock.stock_balances b where b.user_id=uid and b.quantity is distinct from
    (select coalesce(sum(m.delta),0) from eye_stock.stock_movements m where m.user_id=uid and m.medication_id=b.medication_id)) then
    raise sqlstate 'PT409' using message='EYE_LEDGER_MISMATCH';
  end if;
  insert into eye_stock.audit_events(user_id,operation_id,action) values(uid,operation_id,action);
  update eye_stock.profiles set revision=revision+1 where user_id=uid;
  return jsonb_build_object('replayed',false,'operationId',operation_id,'completedRevision',profile.revision+1,'snapshot',eye_stock.snapshot(null));
exception
  when lock_not_available then raise sqlstate 'PT409' using message='EYE_BUSY';
  when unique_violation then raise sqlstate 'PT409' using message='EYE_UNIQUE_CONFLICT';
  when check_violation or foreign_key_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then
    raise sqlstate 'PT422' using message='EYE_INVALID';
end;
$fn$;

create function eye_stock.operation_status(operation_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare uid uuid:=eye_stock.require_user(); result jsonb;
begin
  if operation_id is null then raise sqlstate 'PT422' using message='EYE_INVALID'; end if;
  select jsonb_build_object('status','committed','operationId',r.operation_id,'completedRevision',r.completed_revision) into result
    from eye_stock.mutation_requests r where r.user_id=uid and r.operation_id=operation_status.operation_id;
  -- Missing row can mean an in-flight transaction. Never interpret as definite failure.
  return coalesce(result,jsonb_build_object('status','unknown','operationId',operation_id));
end;
$fn$;
create function eye_stock.history(kind text, page_size integer default 30, after_date date default null, after_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare uid uuid:=eye_stock.require_user(); result jsonb;
begin
  if page_size is null or page_size not between 1 and 100 or (after_date is null)<>(after_id is null) then raise sqlstate 'PT422' using message='EYE_INVALID_PAGE'; end if;
  case kind
  when 'bottles' then
    select coalesce(jsonb_agg(to_jsonb(x)-'user_id'),'[]'::jsonb) into result from (
      select b.*,s.parallel,s.expiration_days from eye_stock.bottles b join eye_stock.medication_settings s on s.user_id=b.user_id and s.medication_id=b.medication_id and s.version=b.settings_version where b.user_id=uid and (after_date is null or (b.opened_on,b.id)<(after_date,after_id)) order by b.opened_on desc,b.id desc limit page_size) x;
  when 'prescriptions' then
    select coalesce(jsonb_agg(to_jsonb(x)-'user_id'),'[]'::jsonb) into result from (
      select p.*,r.received_on,r.quantity as received_quantity,r.id as physical_receipt_id from eye_stock.prescriptions p left join eye_stock.receipts r on r.user_id=p.user_id and r.prescription_id=p.id
      where p.user_id=uid and (after_date is null or (p.prescribed_on,p.id)<(after_date,after_id)) order by p.prescribed_on desc,p.id desc limit page_size) x;
  when 'visits' then
    select coalesce(jsonb_agg(to_jsonb(x)-'user_id'),'[]'::jsonb) into result from (
      select v.* from eye_stock.visits v where v.user_id=uid and (after_date is null or (v.visit_on,v.id)<(after_date,after_id)) order by v.visit_on desc,v.id desc limit page_size) x;
  when 'movements' then
    select coalesce(jsonb_agg(to_jsonb(x)-'user_id'),'[]'::jsonb) into result from (
      select m.* from eye_stock.stock_movements m where m.user_id=uid and (after_date is null or (m.effective_on,m.id)<(after_date,after_id)) order by m.effective_on desc,m.id desc limit page_size) x;
  else raise sqlstate 'PT422' using message='EYE_INVALID_HISTORY';
  end case;
  return jsonb_build_object('items',result,'pageSize',page_size,'mayHaveMore',jsonb_array_length(result)=page_size);
end;
$fn$;

-- Public wrappers are SECURITY INVOKER. Privileged implementations stay outside exposed schemas.
create function public.eye_stock_snapshot(known_revision bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $wrap$ select eye_stock.snapshot(known_revision) $wrap$;
create function public.eye_stock_mutate(action text,payload jsonb,operation_id uuid,expected_revision bigint) returns jsonb
language sql volatile security invoker set search_path='' as $wrap$ select eye_stock.mutate(action,payload,operation_id,expected_revision) $wrap$;
create function public.eye_stock_operation_status(operation_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $wrap$ select eye_stock.operation_status(operation_id) $wrap$;
create function public.eye_stock_history(kind text,page_size integer default 30,after_date date default null,after_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $wrap$ select eye_stock.history(kind,page_size,after_date,after_id) $wrap$;

-- Privileges are closed before COMMIT (including inherited/default PUBLIC grants).
revoke all on all functions in schema eye_stock from public,anon,authenticated,service_role;
grant execute on function eye_stock.int_value(jsonb,integer,integer),eye_stock.text_value(jsonb,integer,boolean),
  eye_stock.date_value(jsonb,date,date),eye_stock.uuid_value(jsonb),eye_stock.request_uid(),eye_stock.require_user(),
  eye_stock.put_settings(uuid,jsonb,integer),eye_stock.move_stock(uuid,text,integer,text,date,uuid,uuid,uuid,text) to authenticated;
grant execute on function eye_stock.snapshot(bigint),eye_stock.mutate(text,jsonb,uuid,bigint),
  eye_stock.operation_status(uuid),eye_stock.history(text,integer,date,uuid) to authenticated;
revoke all on function public.eye_stock_snapshot(bigint),public.eye_stock_mutate(text,jsonb,uuid,bigint),
  public.eye_stock_operation_status(uuid),public.eye_stock_history(text,integer,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.eye_stock_snapshot(bigint),public.eye_stock_mutate(text,jsonb,uuid,bigint),
  public.eye_stock_operation_status(uuid),public.eye_stock_history(text,integer,date,uuid) to authenticated;

-- Enrollment is restricted by RLS to the approved address hash + signed OTP AMR.
create function eye_stock.enroll() returns void
language plpgsql volatile security invoker set search_path='' set lock_timeout='1s' as $fn$
begin
  if exists(select 1 from eye_stock.profiles p where p.user_id=eye_stock.request_uid() and p.enabled) then return; end if;
  if eye_stock.request_uid() is null then raise sqlstate 'PT401' using message='EYE_AUTH_REQUIRED'; end if;
  insert into eye_stock.profiles(user_id) values(eye_stock.request_uid()) on conflict do nothing;
  perform eye_stock.require_user();
exception when insufficient_privilege then raise sqlstate 'PT403' using message='EYE_NOT_ALLOWED';
end;
$fn$;
create function public.eye_stock_enroll() returns void
language sql volatile security invoker set search_path='' as $wrap$ select eye_stock.enroll() $wrap$;
revoke all on function eye_stock.enroll(),public.eye_stock_enroll() from public,anon,authenticated,service_role;
grant execute on function eye_stock.enroll(),public.eye_stock_enroll() to authenticated;

commit;
