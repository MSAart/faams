begin;

do $$
declare
  v_admin_id uuid;
  v_operational_category uuid;
  v_facility_category uuid;
  v_ip_id uuid;
  v_ip_budget_id uuid;
  v_ir_id uuid;
  v_ir_facility_id uuid;
  v_expense_id uuid;
  v_reference text;
  v_row public.ir_monitoring%rowtype;
  v_ip_row public.ip_monitoring%rowtype;
  v_payment_evidence jsonb;
  v_receipt jsonb;
  v_edit_evidence jsonb;
  v_disbursement_evidence jsonb;
  v_summary_before public.ir_reporting_summary%rowtype;
  v_summary_after public.ir_reporting_summary%rowtype;
begin
  select id into v_admin_id
    from public.profiles
   where is_admin
   order by created_at
   limit 1;
  if v_admin_id is null then
    raise exception 'Promote an administrator before running internal_reimbursement.sql';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select id into v_operational_category
    from public.categories
   where code = 'operasional-atk' and is_active;
  select id into v_facility_category
    from public.categories
   where code = 'facility-listrik' and is_active;
  if v_operational_category is null or v_facility_category is null then
    raise exception 'Expected operational and facility seed categories are missing';
  end if;

  select * into v_summary_before from public.ir_reporting_summary;
  v_disbursement_evidence := jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'ip-transfer-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  );
  v_receipt := jsonb_build_array(jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'receipt-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'document_type', 'receipt',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  ));
  v_payment_evidence := jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'payment-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  );

  v_ip_id := public.create_ip_application(
    'IR funding source acceptance test',
    'Verify an IR allocation consumes the IP balance once',
    date '2024-01-02',
    'Finance', 'IR Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_operational_category,
      'description', 'Budget for mixed IR funding',
      'requested_amount', 1000
    ))
  );
  select id into v_ip_budget_id from public.ip_budget_items
   where ip_record_id = v_ip_id;
  perform public.record_ip_disbursement(
    v_ip_id, date '2024-01-05', 1000, 'IP-TEST-TRANSFER',
    'Acceptance test', null, v_disbursement_evidence
  );

  v_ir_id := public.create_ir_record(
    'operasional', date '2024-01-10', 'IR Test PIC',
    'Test mixed funding and partial reimbursement',
    'Mixed funding acceptance IR', date '2024-01-01', date '2024-01-31',
    'Acceptance test'
  );
  if (select reference_code from public.ir_records where id = v_ir_id) is not null then
    raise exception 'An official IR number must not be generated during submission';
  end if;
  perform public.set_ir_reference_code(v_ir_id, 'EXT-IR-OPS-2024-001');
  select reference_code into v_reference from public.ir_records where id = v_ir_id;
  if v_reference <> 'EXT-IR-OPS-2024-001' then
    raise exception 'Manually entered operational IR reference was not saved: %', v_reference;
  end if;

  v_expense_id := public.record_ir_transaction(
    v_ir_id, date '2024-01-10', v_operational_category,
    'Mixed-funded office purchase', 'Test vendor', 1000, 'transfer',
    jsonb_build_array(
      jsonb_build_object('source_type', 'personal', 'amount', 600),
      jsonb_build_object(
        'source_type', 'ip', 'ip_record_id', v_ip_id, 'amount', 400
      )
    ),
    '[]'::jsonb
  );
  v_edit_evidence := jsonb_build_array(jsonb_build_object(
    'object_path', v_admin_id::text || '/ir/' || v_ir_id::text ||
      '/transactions/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'additional-receipt.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'document_type', 'receipt',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  ));
  select * into v_row from public.ir_monitoring where id = v_ir_id;
  if v_row.total_amount <> 1000
     or v_row.personal_amount <> 600
     or v_row.ip_amount <> 400
     or v_row.workflow_status <> 'Evidence Incomplete'
     or v_row.missing_evidence_count <> 1 then
    raise exception 'Mixed funding or missing-evidence monitoring is incorrect: %', row_to_json(v_row);
  end if;
  perform public.edit_ir_transaction_expense(
    v_expense_id, date '2024-01-12', v_operational_category,
    'Corrected mixed-funded office purchase', 'Test vendor', 900, 'transfer',
    jsonb_build_array(
      jsonb_build_object('source_type', 'personal', 'amount', 600),
      jsonb_build_object(
        'source_type', 'ip', 'ip_record_id', v_ip_id, 'amount', 300
      )
    ),
    v_edit_evidence
  );
  select * into v_row from public.ir_monitoring where id = v_ir_id;
  select * into v_ip_row from public.ip_monitoring where id = v_ip_id;
  if v_row.total_amount <> 900
     or v_row.personal_amount <> 600
     or v_row.ip_amount <> 300
     or v_row.missing_evidence_count <> 0
     or v_ip_row.unsettled_balance <> 700
     or not exists (
       select 1 from public.expenses
        where id = v_expense_id
          and expense_date = date '2024-01-12'
          and description = 'Corrected mixed-funded office purchase'
          and amount = 900
     )
     or not exists (
       select 1 from public.evidence_files
        where expense_id = v_expense_id
          and object_path = v_edit_evidence -> 0 ->> 'object_path'
          and status = 'active'
     )
     or not exists (
       select 1 from public.audit_logs
        where entity_table = 'expenses'
          and entity_id = v_expense_id
          and action = 'UPDATE'
     ) then
    raise exception 'IR edit must update transaction, source allocation, evidence, and audit history';
  end if;

  begin
    perform public.record_ir_transaction(
      v_ir_id, date '2024-01-11', v_operational_category,
      'Invalid allocation total', null, 100, 'cash',
      jsonb_build_array(jsonb_build_object(
        'source_type', 'personal', 'amount', 99
      )),
      '[]'::jsonb
    );
    raise exception 'Funding allocations that do not equal transaction amount were accepted';
  exception
    when check_violation then null;
  end;
  begin
    perform public.record_ir_transaction(
      v_ir_id, date '2024-01-11', v_operational_category,
      'Over-allocated IP', null, 701, 'cash',
      jsonb_build_array(jsonb_build_object(
        'source_type', 'ip', 'ip_record_id', v_ip_id, 'amount', 701
      )),
      '[]'::jsonb
    );
    raise exception 'An IP allocation greater than its available balance was accepted';
  exception
    when check_violation then null;
  end;

  perform public.record_ir_transaction(
    v_ir_id, date '2024-01-11', v_operational_category,
    'Second IR transaction', 'Another test vendor', 100, 'cash',
    jsonb_build_array(jsonb_build_object(
      'source_type', 'personal', 'amount', 100
    )),
    v_receipt
  );
  select * into v_row from public.ir_monitoring where id = v_ir_id;
  if v_row.transaction_count <> 2
     or v_row.total_amount <> 1000
     or v_row.personal_amount <> 700
     or v_row.ip_amount <> 300
     or v_row.missing_evidence_count <> 0 then
    raise exception 'Multiple IR transactions or allocation reporting is incorrect';
  end if;

  select * into v_summary_after from public.ir_reporting_summary;
  if v_summary_after.operational_total - v_summary_before.operational_total <> 1000
     or v_summary_after.personal_funded_total - v_summary_before.personal_funded_total <> 700
     or v_summary_after.ip_funded_total - v_summary_before.ip_funded_total <> 300
     or v_summary_after.reimbursement_receivable_total -
        v_summary_before.reimbursement_receivable_total <> 700 then
    raise exception 'IR reporting double-counted transaction totals or funding sources';
  end if;

  perform public.set_ir_ptjb_status(v_ir_id, 'submitted');
  if (select ptjb_status from public.ir_records where id = v_ir_id) <> 'submitted' then
    raise exception 'PTJB submission status was not updated';
  end if;
  perform public.set_ir_ptjb_status(v_ir_id, 'approved');
  begin
    perform public.close_ir_record(v_ir_id);
    raise exception 'An IR with outstanding reimbursement was allowed to close';
  exception
    when check_violation then null;
  end;
  perform public.record_ir_reimbursement_payment(
    v_ir_id, date '2024-01-15', 200, 'PAY-1', 'First partial payment',
    v_payment_evidence
  );
  select * into v_row from public.ir_monitoring where id = v_ir_id;
  if v_row.paid_amount <> 200
     or v_row.outstanding_amount <> 500
     or v_row.workflow_status <> 'Partially Reimbursed' then
    raise exception 'First partial reimbursement status is incorrect';
  end if;
  begin
    perform public.record_ir_reimbursement_payment(
      v_ir_id, date '2024-01-16', 501, 'PAY-OVER', null,
      jsonb_set(v_payment_evidence, '{object_path}',
        to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
    );
    raise exception 'Payment greater than personal receivable was accepted';
  exception
    when check_violation then null;
  end;
  perform public.record_ir_reimbursement_payment(
    v_ir_id, date '2024-01-17', 500, 'PAY-2', 'Final partial payment',
    jsonb_set(v_payment_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  select * into v_row from public.ir_monitoring where id = v_ir_id;
  if v_row.paid_amount <> 700
     or v_row.outstanding_amount <> 0
     or v_row.workflow_status <> 'Reimbursed' then
    raise exception 'Final reimbursement status is incorrect';
  end if;
  perform public.close_ir_record(v_ir_id);

  v_ir_facility_id := public.create_ir_record(
    'facility', date '2024-02-01', 'Facility Test PIC',
    'Verify IP-only IR does not create personal reimbursement',
    'Facility IP-only acceptance IR', date '2024-02-01', date '2024-02-29',
    null
  );
  if (select reference_code from public.ir_records where id = v_ir_facility_id) is not null then
    raise exception 'An official facility IR number must not be generated during submission';
  end if;
  perform public.set_ir_reference_code(v_ir_facility_id, 'EXT-IR-FAC-2024-002');
  select reference_code into v_reference from public.ir_records where id = v_ir_facility_id;
  if v_reference <> 'EXT-IR-FAC-2024-002' then
    raise exception 'Manually entered facility IR reference was not saved: %', v_reference;
  end if;
  perform public.record_ir_transaction(
    v_ir_facility_id, date '2024-02-02', v_facility_category,
    'Facility expense paid from IP', 'Facility vendor', 100, 'transfer',
    jsonb_build_array(jsonb_build_object(
      'source_type', 'ip', 'ip_record_id', v_ip_id, 'amount', 100
    )),
    jsonb_set(v_receipt, '{0,object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  select * into v_row from public.ir_monitoring where id = v_ir_facility_id;
  if v_row.total_amount <> 100
     or v_row.personal_amount <> 0
     or v_row.ip_amount <> 100
     or v_row.outstanding_amount <> 0 then
    raise exception 'IP-only IR incorrectly created reimbursement receivable';
  end if;
  perform public.set_ir_ptjb_status(v_ir_facility_id, 'submitted');
  perform public.set_ir_ptjb_status(v_ir_facility_id, 'approved');
  perform public.close_ir_record(v_ir_facility_id);
end;
$$;

rollback;
