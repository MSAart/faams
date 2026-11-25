begin;

do $$
declare
  v_admin_id uuid;
  v_ip_id uuid := gen_random_uuid();
  v_ir_id uuid := gen_random_uuid();
  v_ir_transaction_id uuid := gen_random_uuid();
  v_expense_id uuid := gen_random_uuid();
  v_category_id uuid;
  v_settlement_id uuid := gen_random_uuid();
  v_holiday_id uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_bad_allocation_id uuid := gen_random_uuid();
  v_bad_payment_id uuid := gen_random_uuid();
  v_table_count integer;
  v_movement_count integer;
  v_ip_balance numeric(18, 2);
begin
  select id
    into v_admin_id
    from public.profiles
   where is_admin
   order by created_at
   limit 1;
  if v_admin_id is null then
    raise exception 'Create and promote an administrator before running finance_database.sql';
  end if;

  select count(*)
    into v_table_count
    from information_schema.tables
   where table_schema = 'public'
     and table_type = 'BASE TABLE'
     and table_name = any (array[
       'ip_records', 'ip_budget_items', 'ir_records', 'ir_transactions',
       'expenses', 'transaction_allocations', 'fund_movements', 'evidence_files',
       'settlements', 'reimbursement_payments', 'holidays', 'categories',
       'monthly_closings', 'audit_logs'
     ]);
  if v_table_count <> 14 then
    raise exception 'Expected 14 finance tables, found %', v_table_count;
  end if;

  select count(*)
    into v_table_count
    from pg_class
   where relnamespace = 'public'::regnamespace
     and relname = any (array[
       'ip_records', 'ip_budget_items', 'ir_records', 'ir_transactions',
       'expenses', 'transaction_allocations', 'fund_movements', 'evidence_files',
       'settlements', 'reimbursement_payments', 'holidays', 'categories',
       'monthly_closings', 'audit_logs'
     ])
     and relrowsecurity;
  if v_table_count <> 14 then
    raise exception 'RLS is not enabled on all finance tables (% of 14)', v_table_count;
  end if;

  insert into public.holidays (
    id, holiday_date, name, holiday_type, created_by
  ) values (
    v_holiday_id, date '2024-01-08', 'FAAMS test holiday', 'company', v_admin_id
  );
  if public.calculate_working_days(date '2024-01-05', date '2024-01-09') <> 2 then
    raise exception 'Working-day count must exclude weekends and registered holidays';
  end if;
  if public.calculate_deadline(date '2024-01-05', 10) <> date '2024-01-22' then
    raise exception '10-day deadline must start on the day after disbursement';
  end if;
  if public.calculate_deadline(date '2024-01-05', 14) <> date '2024-01-26' then
    raise exception '14-day deadline must account for weekends and registered holidays';
  end if;
  if public.calculate_deadline(date '2024-01-05', 0) <> date '2024-01-05' then
    raise exception 'Zero working days must return the disbursement date';
  end if;

  select id into v_category_id
    from public.categories
   where code = 'operasional-atk';
  if v_category_id is null then
    raise exception 'Seed category operasional-atk is missing';
  end if;

  insert into public.ip_records (
    id, reference_code, title, purpose, requested_amount, disbursed_amount,
    disbursement_date, status, created_by
  ) values (
    v_ip_id, 'TEST-IP-' || v_ip_id::text, 'Finance database test IP',
    'Transactional migration verification', 1200, 1200,
    date '2024-01-05', 'disbursed', v_admin_id
  );
  insert into public.ip_budget_items (
    ip_record_id, category_id, description, requested_amount
  ) values (
    v_ip_id, v_category_id, 'Test budget line', 1200
  );
  insert into public.ir_records (
    id, reference_code, ir_type, title, created_by
  ) values (
    v_ir_id, 'TEST-IR-' || v_ir_id::text, 'operasional',
    'Finance database test IR', v_admin_id
  );
  insert into public.ir_transactions (
    id, ir_record_id, transaction_date, description
  ) values (
    v_ir_transaction_id, v_ir_id, date '2024-01-09', 'Mixed-funding transaction'
  );
  insert into public.expenses (
    id, ir_transaction_id, category_id, expense_date, description, amount, created_by
  ) values (
    v_expense_id, v_ir_transaction_id, v_category_id, date '2024-01-09',
    'Mixed-funding expense', 1000, v_admin_id
  );
  insert into public.transaction_allocations (
    expense_id, source_type, ip_record_id, amount
  ) values (v_expense_id, 'ip', v_ip_id, 700);
  insert into public.transaction_allocations (
    expense_id, source_type, personal_profile_id, amount
  ) values (v_expense_id, 'personal', v_admin_id, 300);

  begin
    insert into public.transaction_allocations (
      id, expense_id, source_type, personal_profile_id, amount
    ) values (
      v_bad_allocation_id, v_expense_id, 'personal', v_admin_id, 0.01
    );
    raise exception 'Allocation-overage constraint did not reject the row';
  exception
    when check_violation then null;
  end;
  begin
    insert into public.transaction_allocations (
      id, expense_id, source_type, ip_record_id, amount
    ) values (
      gen_random_uuid(), v_expense_id, 'personal', v_ip_id, 0.01
    );
    raise exception 'Invalid funding-source reference was not rejected';
  exception
    when check_violation then null;
  end;

  insert into public.reimbursement_payments (
    ir_record_id, payment_date, amount, status, created_by
  ) values (
    v_ir_id, date '2024-01-15', 200, 'paid', v_admin_id
  );
  begin
    insert into public.reimbursement_payments (
      id, ir_record_id, payment_date, amount, status, created_by
    ) values (
      v_bad_payment_id, v_ir_id, date '2024-01-16', 101, 'paid', v_admin_id
    );
    raise exception 'Over-reimbursement constraint did not reject the row';
  exception
    when check_violation then null;
  end;

  insert into public.evidence_files (
    id, expense_id, object_path, original_file_name, system_file_name,
    document_type, mime_type, file_size_bytes, uploaded_by
  ) values (
    v_evidence_id, v_expense_id, v_expense_id::text || '/' || v_evidence_id::text || '.pdf',
    'test receipt.pdf', v_evidence_id::text || '.pdf',
    'receipt', 'application/pdf', 128, v_admin_id
  );
  update public.ir_records
     set status = 'submitted',
         ptjb_status = 'submitted'
   where id = v_ir_id;
  insert into public.settlements (
    id, ip_record_id, settlement_date, amount_spent, amount_returned, created_by
  ) values (
    v_settlement_id, v_ip_id, date '2024-01-22', 700, 50, v_admin_id
  );
  begin
    insert into public.settlements (
      ip_record_id, settlement_date, amount_returned, created_by
    ) values (
      v_ip_id, date '2024-01-23', 1200, v_admin_id
    );
    raise exception 'Settlement return over the disbursed amount was not rejected';
  exception
    when check_violation then null;
  end;
  begin
    update public.ip_records set status = 'settled' where id = v_ip_id;
    raise exception 'An IP with outstanding funds was allowed to settle';
  exception
    when check_violation then null;
  end;

  select count(*)
    into v_movement_count
    from public.fund_movements
   where (ip_record_id = v_ip_id or allocation_id in (
     select id from public.transaction_allocations where expense_id = v_expense_id
   ))
     and not is_void;
  if v_movement_count <> 4 then
    raise exception 'Expected one disbursement, two allocations, and one return; found %',
      v_movement_count;
  end if;

  select sum(signed_amount)
    into v_ip_balance
    from public.fund_movement_ledger
   where ip_record_id = v_ip_id;
  if v_ip_balance <> 450 then
    raise exception 'IP movement balance should be 450.00, found %', v_ip_balance;
  end if;

  if (select payment_status from public.ir_records where id = v_ir_id)
     <> 'partially_paid' then
    raise exception 'Payment status must be tracked separately and partially paid';
  end if;

  if not exists (
    select 1
      from public.audit_logs
     where entity_table = 'transaction_allocations'
       and entity_id in (
         select id from public.transaction_allocations where expense_id = v_expense_id
       )
       and action = 'INSERT'
  ) then
    raise exception 'Audit trigger did not record allocation inserts';
  end if;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'expenses'
       and policyname = 'expenses_admin_all'
       and cmd = 'ALL'
  ) then
    raise exception 'Administrator-only RLS policy is missing';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;
do $$
begin
  if (select count(*) from public.ip_records) <> 0 then
    raise exception 'A non-administrator can read protected finance records';
  end if;
  begin
    insert into public.categories (code, name, scope)
    values ('rls-test-denied', 'RLS test denied', 'operasional');
    raise exception 'A non-administrator can write master data';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where is_admin order by created_at limit 1),
  true
);
set local role authenticated;
do $$
begin
  if (select count(*) from public.categories) < 17 then
    raise exception 'An administrator cannot read seeded categories';
  end if;
  if (select count(*) from public.ip_records) <> 1 then
    raise exception 'An administrator cannot read their finance records';
  end if;

  insert into public.categories (code, name, scope)
  values ('test-category', 'Test category', 'operasional');
  update public.categories set is_active = false where code = 'test-category';
  if (select is_active from public.categories where code = 'test-category') then
    raise exception 'An administrator cannot deactivate a category';
  end if;

  insert into public.reimbursement_payments (
    ir_record_id, payment_date, amount, status
  ) select id, date '2024-01-16', 100, 'paid'
      from public.ir_records
     where reference_code like 'TEST-IR-%';
  if (select payment_status from public.ir_records
       where reference_code like 'TEST-IR-%') <> 'paid' then
    raise exception 'Payment trigger could not update the protected payment status';
  end if;

  begin
    update public.ir_records
       set payment_status = 'unpaid'
     where reference_code like 'TEST-IR-%';
    raise exception 'An administrator can override the calculated payment status';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set constraints all immediate;
rollback;
