-- Invitation link generation and delivery can populate invited_at differently.
-- A trusted invited membership itself is sufficient to require password setup.
insert into private.invited_password_setups(user_id)
select distinct user_id from public.organization_members where status = 'invited'
on conflict do nothing;

create or replace function private.require_password_for_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'invited' then
    insert into private.invited_password_setups(user_id) values(new.user_id) on conflict do nothing;
  end if;
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
    if old.encrypted_password is distinct from new.encrypted_password
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
notify pgrst, 'reload schema';
