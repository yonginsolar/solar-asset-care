-- GoTrue may rotate its internal random password while verifying an invite.
-- Only a password change from an already verified Auth account completes setup.
create or replace function private.activate_invited_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.invited_at is not null then
    insert into private.invited_password_setups(user_id) values(new.id) on conflict do nothing;
  end if;
  if tg_op = 'UPDATE' then
    if old.email_confirmed_at is not null
      and old.encrypted_password is distinct from new.encrypted_password
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
