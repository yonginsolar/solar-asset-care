-- Preserve the old administrator editor's explicit consent capture when adding
-- (Filename matches the remotely applied migration history version.)
-- revision/atomic-save protection. Never reconstruct consent on an existing row.
do $$declare body text; anchor text; begin
 body:=pg_get_functiondef('public.save_admin_plant(uuid,uuid,timestamptz,jsonb,uuid)'::regprocedure);
 anchor:=' if p_expected_updated_at is null then
  meta:=meta||jsonb_build_object';
 if position(anchor in body)=0 then raise exception 'Unexpected administrator plant function'; end if;
 body:=replace(body,anchor,' if nullif(meta->>''data_use_consent_at'','''') is null then
  if coalesce((p_details->>''data_use_consent'')::boolean,false) is not true then raise exception ''발전소 자료 처리 동의를 확인해 주세요.''; end if;
  meta:=meta||jsonb_build_object(''data_use_consent_at'',clock_timestamp(),''data_use_consent_version'',''operational-registration-v1'');
 end if;
'||anchor);
 execute body;
end $$;
