begin;

do $$
declare
  v_admin_id uuid;
  v_ir_id uuid;
  v_evidence_id uuid;
  v_path text;
  v_parent_type text;
  v_parent_id uuid;
  v_category text;
  v_max_size bigint;
begin
  select id into v_admin_id
    from public.profiles
   where is_admin
   order by created_at
   limit 1;
  if v_admin_id is null then
    raise exception 'Promote an administrator before running evidence_management.sql';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select (value #>> '{}')::bigint into v_max_size
    from public.system_settings
   where key = 'evidence_max_file_size_bytes';
  if v_max_size < 1048576 or v_max_size > 52428800 then
    raise exception 'Evidence size setting is outside the configured range';
  end if;

  v_ir_id := public.create_ir_record(
    'operasional', date '2024-03-01', 'Evidence Test PIC',
    'Test PTJB evidence linking', 'Evidence management acceptance IR',
    date '2024-03-01', date '2024-03-31', null
  );
  v_path := v_admin_id::text || '/evidence-test/' || gen_random_uuid()::text || '.pdf';
  insert into public.evidence_files (
    object_path, original_file_name, system_file_name, document_type,
    mime_type, file_size_bytes, uploaded_by
  ) values (
    v_path, 'ptjb-test.pdf', gen_random_uuid()::text || '.pdf',
    'ptjb_document', 'application/pdf', 128, v_admin_id
  ) returning id into v_evidence_id;

  select parent_type into v_parent_type
    from public.evidence_center where id = v_evidence_id;
  if v_parent_type <> 'unlinked' then
    raise exception 'New evidence without a selected parent should remain unlinked';
  end if;

  perform public.link_evidence_file(v_evidence_id, 'ir', v_ir_id);
  select parent_type, parent_id, evidence_category
    into v_parent_type, v_parent_id, v_category
    from public.evidence_center where id = v_evidence_id;
  if v_parent_type <> 'ir' or v_parent_id <> v_ir_id
     or v_category <> 'ptjb_document' then
    raise exception 'Evidence was not linked to its IR in the Evidence Center view';
  end if;

  begin
    perform public.link_evidence_file(v_evidence_id, 'ir', v_ir_id);
    raise exception 'Already linked evidence was allowed to be linked a second time';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.evidence_files (
      ir_record_id, object_path, original_file_name, system_file_name,
      document_type, mime_type, file_size_bytes, uploaded_by
    ) values (
      v_ir_id,
      v_admin_id::text || '/evidence-test/' || gen_random_uuid()::text || '.pdf',
      'wrong-category.pdf', gen_random_uuid()::text || '.pdf',
      'purchase_receipt', 'application/pdf', 128, v_admin_id
    );
    raise exception 'A purchase receipt was attached directly to an IR instead of an expense';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.evidence_files (
      object_path, original_file_name, system_file_name, document_type,
      mime_type, file_size_bytes, uploaded_by
    ) values (
      v_path, 'duplicate.pdf', gen_random_uuid()::text || '.pdf',
      'other_supporting_document', 'application/pdf', 128, v_admin_id
    );
    raise exception 'Duplicate storage object path was accepted';
  exception
    when unique_violation then null;
  end;

  delete from public.evidence_files where id = v_evidence_id;
  if not exists (
    select 1
      from public.audit_logs
     where entity_table = 'evidence_files'
       and entity_id = v_evidence_id
       and action = 'DELETE'
       and old_data ->> 'object_path' = v_path
  ) then
    raise exception 'Permanently deleting evidence must retain its old metadata in the audit log';
  end if;

  if not exists (
    select 1 from storage.buckets
     where id = 'faams-evidence' and "public" = false
  ) then
    raise exception 'Evidence bucket must exist and remain private';
  end if;
end;
$$;

rollback;
