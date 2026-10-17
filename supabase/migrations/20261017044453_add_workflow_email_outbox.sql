-- Transactional business mail only; Auth SMTP and all business permissions stay unchanged.
-- Disabled until a send-only provider credential and the dispatcher are verified.
create table private.workflow_email_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.workflow_email_settings default values;
create table private.workflow_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  report_id uuid references public.reports(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  recipient_role text not null check(recipient_role in ('owner','expert','client')),
  event_id uuid not null,
  kind text not null check(kind in ('inspection_received','expert_assigned','report_published')),
  expected_expert_id uuid,
  inspection_code text not null,
  state text not null default 'queued' check(state in ('queued','processing','accepted','failed','unknown','cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  email_fingerprint text,
  provider_id text,
  reason text,
  unique(event_id,recipient_id)
);
create index workflow_emails_org_idx on private.workflow_emails(organization_id);
create index workflow_emails_inspection_idx on private.workflow_emails(inspection_id);
create index workflow_emails_report_idx on private.workflow_emails(report_id);
create index workflow_emails_recipient_idx on private.workflow_emails(recipient_id);
create index workflow_emails_pending_idx on private.workflow_emails(available_at,created_at) where state='queued';
create index workflow_emails_processing_idx on private.workflow_emails(claimed_at) where state='processing';
alter table private.workflow_email_settings enable row level security;
alter table private.workflow_emails enable row level security;
revoke all on private.workflow_email_settings,private.workflow_emails from public,anon,authenticated,service_role;

-- Explicit target-user variant of the existing service_member/service_ready gates.
-- Never switches auth.uid(), grants membership, or trusts profile/user_metadata email.
create function private.workflow_email_recipient(p_org uuid,p_user uuid,p_role text,p_plant uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.plants p where p.id=p_plant and p.organization_id=p_org) and exists(select 1 from public.organization_members m join auth.users u on u.id=m.user_id
  where m.organization_id=p_org and m.user_id=p_user and m.role=p_role and m.status='active'
  and u.deleted_at is null and u.email_confirmed_at is not null and u.email is not null
  and not exists(select 1 from private.invited_password_setups s where s.user_id=u.id and s.required)
  and (p_role<>'client' or exists(select 1 from private.account_details d where d.organization_id=p_org and d.user_id=p_user))
  and (not exists(select 1 from private.service_settings s where s.organization_id=p_org and s.active_version_id is not null)
   or (exists(select 1 from private.account_details d where d.organization_id=p_org and d.user_id=p_user)
    and exists(select 1 from private.service_consents c join private.service_settings s on s.organization_id=c.organization_id
     and s.active_version_id=c.policy_version_id where c.organization_id=p_org and c.user_id=p_user)))
  and (p_role<>'client' or exists(select 1 from public.plant_requesters r where r.plant_id=p_plant and r.requester_user_id=p_user)
   or exists(select 1 from private.customer_plants cp join private.customer_contacts cc
    on cc.organization_id=cp.organization_id and cc.customer_id=cp.customer_id
    where cp.organization_id=p_org and cp.plant_id=p_plant and cc.user_id=p_user and cc.active)));
$$;

create function private.enqueue_workflow_email() returns trigger language plpgsql security definer set search_path='' as $$
declare i public.inspections; event uuid:=gen_random_uuid(); event_kind text; report uuid;
begin
 if not (select enabled from private.workflow_email_settings where singleton) then return new; end if;
 if tg_table_name='reports' then
  if new.status<>'published' or (tg_op='UPDATE' and old.status='published') then return new; end if;
  select * into i from public.inspections where id=new.inspection_id and organization_id=new.organization_id;
  event_kind:='report_published'; report:=new.id;
 else
  i:=new;
  if tg_op='INSERT' then event_kind:='inspection_received';
  elsif new.assigned_expert_user_id is distinct from old.assigned_expert_user_id and new.assigned_expert_user_id is not null then
   event_kind:='expert_assigned';
  else return new; end if;
 end if;
 insert into private.workflow_emails(organization_id,inspection_id,report_id,recipient_id,recipient_role,event_id,kind,expected_expert_id,inspection_code)
 select i.organization_id,i.id,report,m.user_id,m.role,event,event_kind,
  case when event_kind='expert_assigned' then i.assigned_expert_user_id end,i.inspection_code
 from public.organization_members m where m.organization_id=i.organization_id
  and private.workflow_email_recipient(i.organization_id,m.user_id,m.role,i.plant_id)
  and (m.role='client' or (event_kind='inspection_received' and m.role='owner')
   or (event_kind='expert_assigned' and m.role='expert' and m.user_id=i.assigned_expert_user_id))
 on conflict(event_id,recipient_id) do nothing;
 -- An administrator may create an already-assigned inspection in one transaction.
 if tg_table_name='inspections' and tg_op='INSERT' and i.assigned_expert_user_id is not null then
  insert into private.workflow_emails(organization_id,inspection_id,recipient_id,recipient_role,event_id,kind,expected_expert_id,inspection_code)
  select i.organization_id,i.id,m.user_id,m.role,gen_random_uuid(),'expert_assigned',i.assigned_expert_user_id,i.inspection_code
  from public.organization_members m where m.organization_id=i.organization_id and m.user_id=i.assigned_expert_user_id and m.role='expert'
   and private.workflow_email_recipient(i.organization_id,m.user_id,m.role,i.plant_id);
 end if;
 return new;
end $$;
create trigger workflow_email_inspection after insert or update of assigned_expert_user_id on public.inspections
 for each row execute function private.enqueue_workflow_email();
create trigger workflow_email_report after insert or update of status on public.reports
 for each row execute function private.enqueue_workflow_email();

-- No reclaim/resend of unknown outcomes. A crashed worker is recorded as unknown.
create function public.claim_workflow_emails(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.workflow_emails; i public.inspections; address text; fingerprint text; result jsonb:='[]';
begin
 if not (select enabled from private.workflow_email_settings where singleton) then return result; end if;
 for q in update private.workflow_emails set state='unknown',reason='worker_timeout',claim_token=null
  where state='processing' and claimed_at<now()-interval '5 minutes' returning * loop
  insert into public.audit_events(organization_id,action,entity_type,entity_id,metadata)
   values(q.organization_id,'email.unknown','inspection',q.inspection_id::text,jsonb_build_object('kind',q.kind,'reason','worker_timeout'));
 end loop;
 for q in select * from private.workflow_emails where state='queued' and available_at<=now()
  order by available_at,created_at,id limit 50 for update skip locked loop
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

create function public.finish_workflow_email(p_id uuid,p_claim_token uuid,p_result text,p_provider_id text default null,p_retry_seconds integer default 300)
returns boolean language plpgsql security definer set search_path='' as $$
declare q private.workflow_emails; final_state text;
begin
 if p_result not in ('accepted','failed','unknown','rate_limited') then raise exception 'Invalid mail result'; end if;
 select * into q from private.workflow_emails where id=p_id and state='processing' and claim_token=p_claim_token for update;
 if not found then return false; end if;
 final_state:=case when p_result='rate_limited' then
  case when q.attempts<3 and q.created_at>now()-interval '22 hours' then 'queued' else 'failed' end else p_result end;
 update private.workflow_emails set state=final_state,claim_token=null,
  provider_id=case when p_result='accepted' then left(p_provider_id,100) end,
  reason=case when p_result='accepted' then null else p_result end,
  available_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_retry_seconds,300),3600))) where id=q.id;
 if final_state<>'queued' then
  insert into public.audit_events(organization_id,action,entity_type,entity_id,metadata)
   values(q.organization_id,'email.'||final_state,case when q.report_id is null then 'inspection' else 'report' end,
    coalesce(q.report_id,q.inspection_id)::text,jsonb_build_object('kind',q.kind));
 end if;
 return true;
end $$;
revoke all on function private.workflow_email_recipient(uuid,uuid,text,uuid),private.enqueue_workflow_email(),
 public.claim_workflow_emails(integer),public.finish_workflow_email(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_workflow_emails(integer),public.finish_workflow_email(uuid,uuid,text,text,integer) to service_role;
