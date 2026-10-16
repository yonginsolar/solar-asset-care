-- GoTrue can store an internally generated password when creating an invite.
-- Only a subsequent Auth-owned password change satisfies initial setup.
create table private.invited_password_setups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  required boolean not null default true,
  completed_at timestamptz
);
alter table private.invited_password_setups enable row level security;
revoke all on private.invited_password_setups from public, anon, authenticated;
create policy invited_password_setups_no_direct_access on private.invited_password_setups
  for all to anon, authenticated using (false) with check (false);
create policy organization_super_admins_no_direct_access on private.organization_super_admins
  for all to anon, authenticated using (false) with check (false);

-- Existing active administrators are not forced to repeat first-time setup.
insert into private.invited_password_setups(user_id)
select distinct u.id from auth.users u join public.organization_members m on m.user_id = u.id
where u.invited_at is not null and m.status = 'invited';

create or replace function private.require_password_for_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and exists (
    select 1 from private.invited_password_setups s where s.user_id = new.user_id and s.required
  ) then new.status := 'invited';
  elsif new.status = 'invited' and exists (
    select 1 from private.invited_password_setups s join auth.users u on u.id = s.user_id
    where s.user_id = new.user_id and not s.required and s.completed_at is not null
      and u.email_confirmed_at is not null
  ) then new.status := 'active'; end if;
  return new;
end $$;

create or replace function private.activate_invited_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.invited_at is not null then
    insert into private.invited_password_setups(user_id) values(new.id) on conflict do nothing;
  end if;
  if tg_op = 'UPDATE' then
    if old.invited_at is not null and old.encrypted_password is distinct from new.encrypted_password
      and coalesce(new.encrypted_password, '') <> '' then
      update private.invited_password_setups set required = false, completed_at = now()
        where user_id = new.id and required;
    end if;
  end if;
  if new.email_confirmed_at is not null and not exists (
    select 1 from private.invited_password_setups where user_id = new.id and required
  ) then
    update public.organization_members set status = 'active', joined_at = coalesce(joined_at, now())
      where user_id = new.id and status = 'invited';
  end if;
  return new;
end $$;
drop trigger activate_membership_after_invite_acceptance on auth.users;
create trigger activate_membership_after_invite_acceptance
  after insert or update of email_confirmed_at, encrypted_password, invited_at on auth.users
  for each row execute function private.activate_invited_membership();

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
      and m.status = 'active' and (p_roles is null or m.role = any(p_roles)) and u.deleted_at is null
      and not exists(select 1 from private.invited_password_setups s where s.user_id = u.id and s.required)
  );
$$;
create or replace function private.get_my_account_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  member_row public.organization_members%rowtype;
  super_id uuid;
begin
  if actor_id is null then raise exception '로그인이 필요합니다.'; end if;
  select * into member_row from public.organization_members
    where user_id = actor_id and status in ('active', 'invited') order by created_at limit 1;
  select user_id into super_id from private.organization_super_admins where organization_id = member_row.organization_id;
  return jsonb_build_object('needs_initial_password', member_row.user_id is not null and exists (
      select 1 from private.invited_password_setups where user_id = actor_id and required),
    'super_admin_user_id', super_id, 'organization_id', member_row.organization_id,
    'access_removed', member_row.user_id is null and exists (
      select 1 from public.organization_members where user_id = actor_id and status = 'removed'));
end $$;
update public.organization_members m set status = 'invited'
where m.status = 'active' and exists (
  select 1 from private.invited_password_setups s where s.user_id = m.user_id and s.required
);
notify pgrst, 'reload schema';
