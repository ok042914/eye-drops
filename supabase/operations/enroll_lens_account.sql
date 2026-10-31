-- Authorised operator only. Reuse the one existing, verified Lens Stock account.
-- Adds only an Eye Drops profile; never creates/updates Auth or Lens Stock rows.
-- Abort rather than enrolling multiple accounts or replacing an existing profile.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $enroll$
declare uid uuid;
begin
  if (select count(*) from lens_stock.profiles)<>1 then
    raise exception 'EXPECTED_ONE_LENS_ACCOUNT_REVIEW_REQUIRED';
  end if;
  select p.user_id into uid from lens_stock.profiles p join auth.users u on u.id=p.user_id
    where u.email_confirmed_at is not null and u.deleted_at is null;
  if uid is null then raise exception 'VERIFIED_LENS_ACCOUNT_REQUIRED'; end if;
  if exists(select 1 from eye_stock.profiles where user_id=uid and not enabled) then
    raise exception 'EYE_ACCOUNT_DISABLED_REVIEW_REQUIRED';
  end if;
  insert into eye_stock.profiles(user_id) values(uid) on conflict(user_id) do nothing;
end;
$enroll$;
commit;
