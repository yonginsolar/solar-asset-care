create or replace function public.claim_workflow_emails(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scan integer; q private.workflow_emails; i public.inspections; address text; fingerprint text; result jsonb:='[]';
begin
 if not (select enabled from private.workflow_email_settings where singleton) then return result; end if;
 for q in update private.workflow_emails set state='unknown',reason='worker_timeout',claim_token=null
  where state='processing' and claimed_at<now()-interval '5 minutes' returning * loop
  insert into public.audit_events(organization_id,action,entity_type,entity_id,metadata)
   values(q.organization_id,'email.unknown','inspection',q.inspection_id::text,jsonb_build_object('kind',q.kind,'reason','worker_timeout'));
 end loop;
 for scan in 1..50 loop
  select * into q from private.workflow_emails where state='queued' and available_at<=now()
   order by available_at,created_at,id limit 1 for update skip locked;
  exit when not found;
  select * into i from public.inspections where id=q.inspection_id and organization_id=q.organization_id;
  select lower(trim(email)) into address from auth.users where id=q.recipient_id;
  fingerprint:=encode(extensions.digest(coalesce(address,''),'sha256'),'hex');
  if q.created_at<now()-interval '23 hours' or i.id is null or i.status='cancelled'
   or not private.workflow_email_recipient(q.organization_id,q.recipient_id,q.recipient_role,i.plant_id)
   or (q.kind='expert_assigned' and i.assigned_expert_user_id is distinct from q.expected_expert_id)
   or (q.kind='report_published' and not exists(select 1 from public.reports r where r.id=q.report_id and r.organization_id=q.organization_id and r.status='published'))
   or (q.email_fingerprint is not null and q.email_fingerprint<>fingerprint)
   or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or split_part(address,'@',2) ~ '(^|\.)(invalid|test|localhost|example\.(com|org|net))$' then
   update private.workflow_emails set state='cancelled',reason='recipient_or_event_no_longer_eligible' where id=q.id;
   continue;
  end if;
  update private.workflow_emails set state='processing',attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid(),email_fingerprint=fingerprint
   where id=q.id returning * into q;
  result:=result||jsonb_build_array(jsonb_build_object('id',q.id,'claimToken',q.claim_token,'kind',q.kind,'role',q.recipient_role,
   'email',address,'inspectionCode',q.inspection_code,'inspectionId',q.inspection_id,'reportId',q.report_id));
  exit when jsonb_array_length(result)>=greatest(1,least(coalesce(p_limit,5),10));
 end loop;
 return result;
end $$;
