-- One protected, transferable super administrator per organization.
-- The canonical assignment is private: browser clients cannot write it directly.
create table private.organization_super_admins (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id)
    deferrable initially deferred
);
alter table private.organization_super_admins enable row level security;
revoke all on private.organization_super_admins from public, anon, authenticated;
create index organization_super_admins_user_id_idx on private.organization_super_admins(user_id);

alter table public.organization_members drop constraint organization_members_status_check;
alter table public.organization_members add constraint organization_members_status_check
  check (status in ('invited', 'active', 'suspended', 'removed'));

-- A removed administrator keeps authorship/history and cannot self-register as
-- a requester: its existing owner membership remains, with no active access.
create or replace function private.guard_super_admin_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations where id = old.organization_id
  ) then return old; end if;
  if exists (select 1 from private.organization_super_admins
    where organization_id = old.organization_id and user_id = old.user_id)
    and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active'
      or new.user_id <> old.user_id or new.organization_id <> old.organization_id) then
    raise exception '최고 관리자는 삭제하거나 권한·상태를 변경할 수 없습니다. 먼저 최고 관리자 권한을 양도해 주세요.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.guard_super_admin_membership() from public, anon, authenticated;
create trigger guard_super_admin_membership
  before update or delete on public.organization_members
  for each row execute function private.guard_super_admin_membership();

-- Invited accounts are not activated merely by opening a verification link.
-- The Auth-owned password hash, never user-editable metadata, is authoritative.
create or replace function private.require_password_for_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and exists (
    select 1 from auth.users u where u.id = new.user_id
      and u.invited_at is not null and coalesce(u.encrypted_password, '') = ''
  ) then new.status := 'invited'; end if;
  return new;
end $$;
revoke all on function private.require_password_for_membership() from public, anon, authenticated;
create trigger require_password_for_membership
  before insert or update on public.organization_members
  for each row execute function private.require_password_for_membership();

create or replace function private.initialize_super_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'owner' and new.status = 'active' then
    perform 1 from public.organizations where id = new.organization_id for update;
    insert into private.organization_super_admins(organization_id, user_id)
      values (new.organization_id, new.user_id) on conflict (organization_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.initialize_super_admin() from public, anon, authenticated;
create trigger initialize_super_admin
  after insert or update on public.organization_members
  for each row execute function private.initialize_super_admin();

-- Explicit user-authorized initial assignment; no generated IDs are embedded.
insert into private.organization_super_admins(organization_id, user_id)
select m.organization_id, m.user_id from public.organization_members m
join public.profiles p on p.user_id = m.user_id
join public.organizations o on o.id = m.organization_id
where lower(p.email) = 'minho@hoods.kr' and m.role = 'owner'
  and m.status = 'active' and o.is_primary_operator;

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
      and m.status = 'active' and (p_roles is null or m.role = any(p_roles))
      and u.deleted_at is null
      and not (u.invited_at is not null and coalesce(u.encrypted_password, '') = '')
  );
$$;

create or replace function private.activate_invited_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and coalesce(new.encrypted_password, '') <> '' then
    update public.organization_members set status = 'active', joined_at = coalesce(joined_at, now())
    where user_id = new.id and status = 'invited';
  end if;
  return new;
end $$;
drop trigger activate_membership_after_invite_acceptance on auth.users;
create trigger activate_membership_after_invite_acceptance
  after update of email_confirmed_at, encrypted_password on auth.users
  for each row execute function private.activate_invited_membership();
update public.organization_members m set status = 'invited'
from auth.users u where u.id = m.user_id and m.status = 'active'
  and u.invited_at is not null and coalesce(u.encrypted_password, '') = '';

create or replace function private.get_my_account_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  member_row public.organization_members%rowtype;
  needs_password boolean;
  super_id uuid;
begin
  if actor_id is null then raise exception '로그인이 필요합니다.'; end if;
  select * into member_row from public.organization_members
    where user_id = actor_id and status in ('active', 'invited') order by created_at limit 1;
  select user_id into super_id from private.organization_super_admins
    where organization_id = member_row.organization_id;
  select exists(select 1 from auth.users u where u.id = actor_id
    and u.invited_at is not null and coalesce(u.encrypted_password, '') = ''
    and member_row.user_id is not null) into needs_password;
  return jsonb_build_object('needs_initial_password', needs_password,
    'super_admin_user_id', super_id, 'organization_id', member_row.organization_id,
    'access_removed', member_row.user_id is null and exists (
      select 1 from public.organization_members where user_id = actor_id and status = 'removed'));
end $$;

create or replace function private.admin_remove_member(
  p_organization_id uuid, p_user_id uuid, p_expected_updated_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  target public.organization_members%rowtype;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  if not private.has_org_role(p_organization_id, array['owner']) then
    raise exception '관리자만 다른 관리자를 삭제할 수 있습니다.'; end if;
  if actor_id = p_user_id then raise exception '본인 계정은 삭제할 수 없습니다.'; end if;
  select * into target from public.organization_members
    where organization_id = p_organization_id and user_id = p_user_id for update;
  if not found or target.role <> 'owner' or target.status = 'removed' then
    raise exception '삭제할 관리자를 찾을 수 없습니다.'; end if;
  if p_expected_updated_at is null or target.updated_at <> p_expected_updated_at then
    raise exception '계정 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  update public.organization_members set status = 'removed'
    where organization_id = p_organization_id and user_id = p_user_id;
  insert into public.audit_events(organization_id, actor_user_id, action, entity_type, entity_id)
    values(p_organization_id, actor_id, 'organization.member_removed', 'organization_member', p_user_id::text);
end $$;

create or replace function private.transfer_super_admin(
  p_organization_id uuid, p_target_user_id uuid,
  p_expected_super_admin_user_id uuid, p_expected_target_updated_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  current_super uuid;
  target public.organization_members%rowtype;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  select user_id into current_super from private.organization_super_admins
    where organization_id = p_organization_id for update;
  if current_super is distinct from actor_id or actor_id is null
    or not private.has_org_role(p_organization_id, array['owner']) then
    raise exception '현재 최고 관리자만 권한을 양도할 수 있습니다.'; end if;
  if p_expected_super_admin_user_id is distinct from current_super then
    raise exception '최고 관리자가 변경되었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  if actor_id = p_target_user_id then raise exception '본인에게 양도할 수 없습니다.'; end if;
  select * into target from public.organization_members
    where organization_id = p_organization_id and user_id = p_target_user_id for update;
  if not found or target.role <> 'owner' or target.status <> 'active' then
    raise exception '초대를 수락하고 비밀번호 설정을 마친 사용 중인 관리자에게만 양도할 수 있습니다.'; end if;
  if p_expected_target_updated_at is null or target.updated_at <> p_expected_target_updated_at then
    raise exception '대상 계정이 변경되었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  update private.organization_super_admins set user_id = p_target_user_id, updated_at = now()
    where organization_id = p_organization_id;
  insert into public.audit_events(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    values(p_organization_id, actor_id, 'organization.super_admin_transferred', 'organization_member',
      p_target_user_id::text, jsonb_build_object('previous_super_admin_user_id', actor_id));
end $$;

create or replace function public.get_my_account_state()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.get_my_account_state();
$$;
create or replace function public.admin_remove_member(
  p_organization_id uuid, p_user_id uuid, p_expected_updated_at timestamptz
)
returns void language sql security invoker set search_path = '' as $$
  select private.admin_remove_member(p_organization_id, p_user_id, p_expected_updated_at);
$$;
create or replace function public.transfer_super_admin(
  p_organization_id uuid, p_target_user_id uuid,
  p_expected_super_admin_user_id uuid, p_expected_target_updated_at timestamptz
)
returns void language sql security invoker set search_path = '' as $$
  select private.transfer_super_admin(p_organization_id, p_target_user_id,
    p_expected_super_admin_user_id, p_expected_target_updated_at);
$$;
revoke all on function private.get_my_account_state() from public, anon;
revoke all on function public.get_my_account_state() from public, anon;
revoke all on function private.admin_remove_member(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.admin_remove_member(uuid, uuid, timestamptz) from public, anon;
revoke all on function private.transfer_super_admin(uuid, uuid, uuid, timestamptz) from public, anon;
revoke all on function public.transfer_super_admin(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function private.get_my_account_state() to authenticated;
grant execute on function public.get_my_account_state() to authenticated;
grant execute on function private.admin_remove_member(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.admin_remove_member(uuid, uuid, timestamptz) to authenticated;
grant execute on function private.transfer_super_admin(uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.transfer_super_admin(uuid, uuid, uuid, timestamptz) to authenticated;

comment on table private.organization_super_admins is
  '조직별 유일한 최고 관리자. 삭제/중지/강등은 차단하며 본인의 명시적 원자적 양도만 허용.';
notify pgrst, 'reload schema';
