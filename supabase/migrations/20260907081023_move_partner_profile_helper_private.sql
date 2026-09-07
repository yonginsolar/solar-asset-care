-- Keep the privileged implementation outside the exposed API schema. The
-- public wrapper remains security-invoker and exposes only the reviewed RPC.

alter function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) set schema private;

revoke all on function private.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) from public, anon;
grant execute on function private.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) to authenticated;

create function public.save_partner_profile(
  p_organization_id uuid,
  p_partner_id uuid,
  p_name text,
  p_partner_type text,
  p_service_regions text[],
  p_rating numeric,
  p_status text,
  p_business_registration_number text,
  p_license_registration_number text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_notes text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.save_partner_profile(
    p_organization_id,
    p_partner_id,
    p_name,
    p_partner_type,
    p_service_regions,
    p_rating,
    p_status,
    p_business_registration_number,
    p_license_registration_number,
    p_contact_name,
    p_contact_email,
    p_contact_phone,
    p_notes
  );
$$;

revoke all on function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) to authenticated;

comment on function private.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) is 'Privileged owner-checked implementation for audited partner profile writes.';
comment on function public.save_partner_profile(
  uuid, uuid, text, text, text[], numeric, text,
  text, text, text, text, text, text
) is 'Security-invoker API wrapper for the owner-managed partner profile workflow.';
