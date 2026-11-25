begin;

do $$
declare
  v_admin_id uuid;
  v_category_id uuid;
  v_ip_form_export uuid;
  v_ip_full uuid;
  v_ip_return uuid;
  v_ip_mismatch uuid;
  v_ip_overdrawn uuid;
  v_expense_id uuid;
  v_budget_item_id uuid;
  v_ir_id uuid;
  v_monitoring public.ip_monitoring%rowtype;
  v_deadline date;
  v_disbursement_evidence jsonb;
  v_receipt_evidence jsonb;
  v_return_evidence jsonb;
  v_edit_evidence jsonb;
begin
  select id into v_admin_id
    from public.profiles
   where is_admin
   order by created_at
   limit 1;
  if v_admin_id is null then
    raise exception 'Promote an administrator before running internal_prepayment.sql';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select id into v_category_id
    from public.categories
   where code = 'operasional-atk' and is_active;
  if v_category_id is null then
    raise exception 'Seed category operasional-atk is missing';
  end if;

  v_disbursement_evidence := jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'transfer-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  );
  v_receipt_evidence := jsonb_build_array(jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'receipt-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128,
    'document_type', 'receipt'
  ));
  v_return_evidence := jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'return-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  );

  if public.calculate_working_days(
    date '2024-01-06',
    public.calculate_deadline(date '2024-01-05', 10)
  ) <> 10 then
    raise exception 'The target deadline must include exactly 10 working days';
  end if;
  v_deadline := public.calculate_deadline(date '2024-01-05', 14);
  if public.calculate_working_days(date '2024-01-06', v_deadline) <> 14 then
    raise exception 'The administrative deadline must include exactly 14 working days';
  end if;

  v_ip_form_export := public.create_ip_application(
    'Application form export acceptance test',
    'Verify project metadata and item quantity are stored for export',
    date '2026-11-20',
    'West Kalimantan Operation', 'Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_category_id,
      'description', 'Two and a half service units',
      'quantity', 2.5,
      'unit_cost', 400,
      'requested_amount', 1000
    )),
    date '2026-11-24',
    date '2026-11-26',
    'Pontianak'
  );
  if (select reference_code from public.ip_records where id = v_ip_form_export) is not null
     or (select requested_amount from public.ip_records where id = v_ip_form_export) <> 1000
     or (select project_start_date from public.ip_records where id = v_ip_form_export) <> date '2026-11-24'
     or (select project_end_date from public.ip_records where id = v_ip_form_export) <> date '2026-11-26'
     or (select project_location from public.ip_records where id = v_ip_form_export) <> 'Pontianak'
     or (select quantity from public.ip_budget_items where ip_record_id = v_ip_form_export) <> 2.5
     or (select unit_cost from public.ip_budget_items where ip_record_id = v_ip_form_export) <> 400 then
    raise exception 'IP export form metadata or quantity/unit cost calculation is incorrect';
  end if;

  v_ip_full := public.create_ip_application(
    'Full realization acceptance test',
    'Verify a fully realized IP can be closed',
    date '2024-01-02',
    'Finance', 'Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_category_id,
      'description', 'Full budget item',
      'requested_amount', 1000
    ))
  );
  if (select reference_code from public.ip_records where id = v_ip_full) is not null then
    raise exception 'An official IP number must not be generated during submission';
  end if;
  perform public.set_ip_reference_code(v_ip_full, 'EXT-IP-2024-001');
  if (select reference_code from public.ip_records where id = v_ip_full) <> 'EXT-IP-2024-001' then
    raise exception 'The manually entered official IP number was not saved';
  end if;
  select id into v_budget_item_id from public.ip_budget_items
   where ip_record_id = v_ip_full;
  perform public.record_ip_disbursement(
    v_ip_full, date '2024-01-05', 1000, 'TRX-FULL', 'Test recipient',
    null, v_disbursement_evidence
  );
  begin
    perform public.record_ip_disbursement(
      v_ip_full, date '2024-01-08', 1000, 'TRX-DUP', 'Test recipient',
      null, jsonb_set(v_disbursement_evidence, '{object_path}',
        to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
    );
    raise exception 'A second disbursement was accepted';
  exception
    when check_violation then null;
  end;
  perform public.record_ip_expense(
    v_ip_full, date '2024-01-09', v_budget_item_id, 'Full realization',
    'Test vendor', 900, 'transfer', true, null, v_receipt_evidence
  );
  v_expense_id := (
    select id from public.expenses
     where ip_record_id = v_ip_full
       and description = 'Full realization'
  );
  v_edit_evidence := jsonb_build_array(jsonb_build_object(
    'object_path', v_admin_id::text || '/ip/' || v_ip_full::text ||
      '/expenses/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'additional-receipt.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'document_type', 'receipt',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  ));
  perform public.edit_ip_realization(
    v_ip_full, v_expense_id, date '2024-01-10', v_budget_item_id,
    'Corrected full realization', 'Test vendor', 1000, 'transfer',
    v_edit_evidence
  );
  if not exists (
    select 1 from public.expenses
     where id = v_expense_id
       and expense_date = date '2024-01-10'
       and description = 'Corrected full realization'
       and amount = 1000
  ) or (
    select count(*) from public.transaction_allocations
     where expense_id = v_expense_id and status = 'active'
  ) <> 1 or not exists (
    select 1 from public.transaction_allocations
     where expense_id = v_expense_id
       and status = 'void'
       and void_reason = 'Allocation replaced by an audited IP realization edit'
  ) or not exists (
    select 1 from public.evidence_files
     where expense_id = v_expense_id
       and object_path = v_edit_evidence -> 0 ->> 'object_path'
       and status = 'active'
  ) or not exists (
    select 1 from public.audit_logs
     where entity_table = 'expenses'
       and entity_id = v_expense_id
       and action = 'UPDATE'
  ) then
    raise exception 'IP realization edit must update transaction, evidence, and audit history';
  end if;
  select * into v_monitoring from public.ip_monitoring where id = v_ip_full;
  if v_monitoring.valid_realization <> 1000
     or v_monitoring.unsettled_balance <> 0 then
    raise exception 'Full realization balance calculation is incorrect';
  end if;
  perform public.close_ip_settlement(v_ip_full, date '2024-01-22', 'Fully matched');
  if (select status from public.ip_records where id = v_ip_full) <> 'closed' then
    raise exception 'A fully settled IP was not closed';
  end if;
  if current_date <= v_monitoring.administrative_deadline then
    raise exception 'The 14-working-day fixture should be overdue';
  end if;

  v_ip_return := public.create_ip_application(
    'Partial return acceptance test',
    'Verify staged returns are accounted for',
    date '2024-01-02',
    'Finance', 'Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_category_id,
      'description', 'Partial return budget item',
      'requested_amount', 1000
    ))
  );
  select id into v_budget_item_id from public.ip_budget_items
   where ip_record_id = v_ip_return;
  perform public.record_ip_disbursement(
    v_ip_return, date '2024-01-05', 1000, null, null, null,
    jsonb_set(v_disbursement_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  perform public.record_ip_expense(
    v_ip_return, date '2024-01-09', v_budget_item_id, 'Partial realization',
    null, 600, 'cash', true, null,
    jsonb_set(v_receipt_evidence, '{0,object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  perform public.record_ip_return(
    v_ip_return, date '2024-01-10', 200, 'transfer', 'RETURN-1', null,
    jsonb_set(v_return_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  select * into v_monitoring from public.ip_monitoring where id = v_ip_return;
  if v_monitoring.unsettled_balance <> 200 then
    raise exception 'An IP with remaining funds must show its unsettled balance';
  end if;
  begin
    perform public.close_ip_settlement(v_ip_return, date '2024-01-22', null);
    raise exception 'An IP with remaining funds was allowed to close';
  exception
    when check_violation then null;
  end;
  begin
    perform public.record_ip_return(
      v_ip_return, date '2024-01-10', 201, 'transfer', null, null,
      jsonb_set(v_return_evidence, '{object_path}',
        to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
    );
    raise exception 'A return greater than the available IP balance was accepted';
  exception
    when check_violation then null;
  end;
  perform public.record_ip_return(
    v_ip_return, date '2024-01-11', 200, 'cash', null, null,
    jsonb_set(v_return_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  select * into v_monitoring from public.ip_monitoring where id = v_ip_return;
  if v_monitoring.valid_realization <> 600
     or v_monitoring.returned_amount <> 400
     or v_monitoring.unsettled_balance <> 0 then
    raise exception 'Staged return calculation is incorrect';
  end if;
  perform public.close_ip_settlement(v_ip_return, date '2024-01-22', 'Two staged returns');

  v_ip_mismatch := public.create_ip_application(
    'Mismatched realization acceptance test',
    'Verify unmatched use cannot count before follow-up',
    date '2024-01-02',
    'Finance', 'Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_category_id,
      'description', 'Mismatch budget item',
      'requested_amount', 500
    ))
  );
  select id into v_budget_item_id from public.ip_budget_items
   where ip_record_id = v_ip_mismatch;
  perform public.record_ip_disbursement(
    v_ip_mismatch, date '2024-01-05', 500, null, null, null,
    jsonb_set(v_disbursement_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  v_expense_id := public.record_ip_expense(
    v_ip_mismatch, date '2024-01-09', v_budget_item_id, 'Unmatched purchase',
    null, 100, 'cash', false, 'Acceptance test mismatch',
    jsonb_set(v_receipt_evidence, '{0,object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  select * into v_monitoring from public.ip_monitoring where id = v_ip_mismatch;
  if v_monitoring.valid_realization <> 0
     or v_monitoring.unsettled_balance <> 500
     or v_monitoring.discrepancy_count <> 1 then
    raise exception 'Unverified mismatch was incorrectly counted as valid realization';
  end if;
  begin
    perform public.close_ip_settlement(v_ip_mismatch, date '2024-01-22', null);
    raise exception 'An unresolved mismatch was allowed to close';
  exception
    when check_violation then null;
  end;
  v_ir_id := public.resolve_ip_discrepancy(
    v_expense_id, 'create_ir', 'Create an IR follow-up',
    null, 'operasional'
  );
  if (select ip_usage_status from public.expenses where id = v_expense_id) <> 'linked_ir'
     or v_ir_id is null then
    raise exception 'Mismatch did not create and link an IR follow-up';
  end if;
  perform public.record_ip_return(
    v_ip_mismatch, date '2024-01-11', 500, 'transfer', null, null,
    jsonb_set(v_return_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  perform public.close_ip_settlement(v_ip_mismatch, date '2024-01-22', 'IR follow-up completed');

  v_ip_overdrawn := public.create_ip_application(
    'Over-disbursement acceptance test',
    'Verify expenses above disbursement remain visible',
    date '2024-01-02',
    'Finance', 'Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_category_id,
      'description', 'Overdrawn budget item',
      'requested_amount', 1000
    ))
  );
  select id into v_budget_item_id from public.ip_budget_items
   where ip_record_id = v_ip_overdrawn;
  perform public.record_ip_disbursement(
    v_ip_overdrawn, date '2024-01-05', 1000, null, null, null,
    jsonb_set(v_disbursement_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  perform public.record_ip_expense(
    v_ip_overdrawn, date '2024-01-09', v_budget_item_id, 'Expense above disbursement',
    null, 1200, 'transfer', true, null,
    jsonb_set(v_receipt_evidence, '{0,object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  select * into v_monitoring from public.ip_monitoring where id = v_ip_overdrawn;
  if v_monitoring.valid_realization <> 1200
     or v_monitoring.unsettled_balance <> -200 then
    raise exception 'Expense exceeding disbursement was not transparently reported';
  end if;
  begin
    perform public.close_ip_settlement(v_ip_overdrawn, date '2024-01-22', null);
    raise exception 'An IP with overdrawn funds was allowed to close';
  exception
    when check_violation then null;
  end;

  if current_date <= public.calculate_deadline(date '2024-01-05', 10)
     or current_date <= public.calculate_deadline(date '2024-01-05', 14) then
    raise exception 'Acceptance fixtures must be beyond both deadlines';
  end if;
end;
$$;

rollback;
