begin;

do $$
declare
  v_admin_id uuid;
  v_operational_category uuid;
  v_ip_id uuid;
  v_budget_item_id uuid;
  v_ir_id uuid;
  v_expense_id uuid;
  v_ip_balance public.reconciliation_balances%rowtype;
  v_ir_balance public.reconciliation_balances%rowtype;
  v_summary_before public.reconciliation_summary%rowtype;
  v_summary_after public.reconciliation_summary%rowtype;
  v_period record;
  v_period_record record;
  v_evidence jsonb;
  v_receipt jsonb;
  v_movement_count integer;
  v_ip_debit numeric(18, 2);
  v_ip_credit numeric(18, 2);
  v_personal_debit numeric(18, 2);
  v_personal_credit numeric(18, 2);
  v_adjustment_id uuid;
  v_dashboard_count integer;
  v_dashboard_amount numeric(18, 2);
  v_ip_only_ir_id uuid;
  v_ip_only_evidence jsonb;
begin
  select id into v_admin_id
    from public.profiles
   where is_admin
   order by created_at
   limit 1;
  if v_admin_id is null then
    raise exception 'Promote an administrator before running finance_ledger_reconciliation.sql';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select id into v_operational_category
    from public.categories
   where code = 'operasional-atk' and is_active;
  if v_operational_category is null then
    raise exception 'Seed category operasional-atk is missing';
  end if;

  select * into v_summary_before from public.reconciliation_summary;
  v_evidence := jsonb_build_object(
    'object_path', v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'ledger-test.pdf',
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

  v_ip_id := public.create_ip_application(
    'Ledger reconciliation acceptance',
    'Verify movements and reconciliation balances agree',
    date '2024-06-03',
    'Finance', 'Ledger Test PIC', null,
    jsonb_build_array(jsonb_build_object(
      'category_id', v_operational_category,
      'description', 'Acceptance test budget',
      'requested_amount', 1000
    ))
  );
  select id into v_budget_item_id from public.ip_budget_items
   where ip_record_id = v_ip_id;
  perform public.record_ip_disbursement(
    v_ip_id, date '2024-06-03', 1000, 'LEDGER-TEST-DISBURSEMENT',
    'Acceptance test', null, v_evidence
  );
  perform public.record_ip_expense(
    v_ip_id, date '2024-06-04', v_budget_item_id,
    'Direct IP realization', 'Test vendor', 300, 'transfer',
    true, null, v_receipt
  );
  perform public.record_ip_return(
    v_ip_id, date '2024-06-05', 200, 'transfer', 'LEDGER-RETURN-1',
    null, jsonb_set(v_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  perform public.record_ip_return(
    v_ip_id, date '2024-06-06', 100, 'cash', 'LEDGER-RETURN-2',
    null, jsonb_set(v_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );

  v_ir_id := public.create_ir_record(
    'operasional', date '2024-06-07', 'Ledger Test PIC',
    'Mixed source ledger acceptance',
    'Ledger reconciliation IR', date '2024-06-01', date '2024-06-30',
    'Acceptance fixture'
  );
  v_expense_id := public.record_ir_transaction(
    v_ir_id, date '2024-06-07', v_operational_category,
    'Mixed-funded IR transaction', 'Test vendor', 500, 'transfer',
    jsonb_build_array(
      jsonb_build_object('source_type', 'personal', 'amount', 300),
      jsonb_build_object('source_type', 'ip', 'ip_record_id', v_ip_id, 'amount', 200)
    ),
    v_receipt
  );
  select count(*)::integer, coalesce(sum(credit), 0)::numeric(18, 2)
    into v_dashboard_count, v_dashboard_amount
    from public.transaction_ledger
   where related_expense_id = (
     select id from public.expenses where ir_transaction_id = v_expense_id
   );
  if v_dashboard_count <> 2 or v_dashboard_amount <> 500
     or exists (
       select 1 from public.transaction_ledger
        where related_expense_id = (
          select id from public.expenses where ir_transaction_id = v_expense_id
        )
          and (
            category_id is distinct from v_operational_category
            or ir_type is distinct from 'operasional'
          )
     ) then
    raise exception 'Dashboard ledger dimensions must preserve both mixed allocations and the full expense amount';
  end if;
  if not exists (
    select 1 from public.transaction_ledger
     where related_expense_id = (
       select id from public.expenses where ir_transaction_id = v_expense_id
     )
       and source_type = 'ip'
       and related_ip_id = v_ip_id
       and credit = 200
  ) then
    raise exception 'The IP-funded share of an IR transaction must be recorded against its source IP';
  end if;
  perform public.set_ir_ptjb_status(v_ir_id, 'submitted');
  perform public.set_ir_ptjb_status(v_ir_id, 'approved');
  perform public.record_ir_reimbursement_payment(
    v_ir_id, date '2024-06-08', 100, 'LEDGER-PAYMENT-1', 'Partial payment', v_evidence
  );
  if exists (
    select 1 from public.fund_movements
     where related_ir_record_id = v_ir_id and ir_replenishment and not is_void
  ) then
    raise exception 'IP funds must not be returned before the full reimbursement is paid';
  end if;
  perform public.record_ir_reimbursement_payment(
    v_ir_id, date '2024-06-09', 200, 'LEDGER-PAYMENT-2', 'Final payment',
    jsonb_set(v_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );

  select * into v_ip_balance from public.reconciliation_balances
   where entity_type = 'ip' and entity_id = v_ip_id;
  select * into v_ir_balance from public.reconciliation_balances
   where entity_type = 'ir' and entity_id = v_ir_id;
  if v_ip_balance.principal_amount <> 1000
     or v_ip_balance.realized_amount <> 500
     or v_ip_balance.returned_amount <> 300
     or v_ip_balance.balance_amount <> 400
     or v_ip_balance.outstanding_amount <> 400
     or v_ip_balance.reconciled_amount <> 800 then
    raise exception 'IP reconciliation mismatch; expected 1000 - 500 - 300 + 200 = 400: %',
      row_to_json(v_ip_balance);
  end if;
  if (
    select coalesce(sum(amount), 0)
      from public.fund_movements
     where related_ir_record_id = v_ir_id
       and ir_replenishment
       and not is_void
  ) <> 200 then
    raise exception 'Fully paid IR must return the entire IP allocation to the source IP';
  end if;
  if v_ir_balance.principal_amount <> 500
     or v_ir_balance.realized_amount <> 500
     or v_ir_balance.personal_funded_amount <> 300
     or v_ir_balance.reimbursement_paid_amount <> 300
     or v_ir_balance.balance_amount <> 0
     or v_ir_balance.reconciliation_status <> 'Balance' then
    raise exception 'Mixed IR receivable mismatch; expected personal 300 - paid 300 = 0: %',
      row_to_json(v_ir_balance);
  end if;

  select count(*)::integer,
         coalesce(sum(debit) filter (where source_type = 'ip'), 0),
         coalesce(sum(credit) filter (where source_type = 'ip'), 0),
         coalesce(sum(debit) filter (where source_type = 'personal'), 0),
         coalesce(sum(credit) filter (where source_type = 'personal'), 0)
    into v_movement_count, v_ip_debit, v_ip_credit, v_personal_debit, v_personal_credit
    from public.transaction_ledger
   where related_ip_id = v_ip_id or related_ir_id = v_ir_id;
  if v_movement_count <> 9
     or v_ip_debit <> 1200
     or v_ip_credit <> 800
     or v_personal_debit <> 300
     or v_personal_credit <> 300 then
    raise exception 'Ledger double-counted or omitted a movement: count %, IP %/%, Personal %/%',
      v_movement_count, v_ip_debit, v_ip_credit, v_personal_debit, v_personal_credit;
  end if;

  select * into v_period
    from public.reconciliation_period_summary(date '2024-06-03', date '2024-06-09');
  if v_period.ip_debit < 1200 or v_period.ip_credit < 800
     or v_period.personal_debit < 300 or v_period.personal_credit < 300
     or v_period.transaction_count < 9 then
    raise exception 'Period ledger totals do not include the expected fixture: %',
      row_to_json(v_period);
  end if;
  select * into v_period_record
    from public.reconciliation_period_balances(date '2024-06-03', date '2024-06-09')
   where entity_type = 'ip' and entity_id = v_ip_id;
  if v_period_record.ip_debit <> 1200
     or v_period_record.ip_credit <> 800
     or v_period_record.movement_count <> 6 then
    raise exception 'Period IP movements are incorrect: %', row_to_json(v_period_record);
  end if;
  select * into v_period_record
    from public.reconciliation_period_balances(date '2024-06-03', date '2024-06-09')
   where entity_type = 'ir' and entity_id = v_ir_id;
  if v_period_record.ip_debit <> 200
     or v_period_record.ip_credit <> 200
     or v_period_record.personal_debit <> 300
     or v_period_record.personal_credit <> 300
     or v_period_record.movement_count <> 5 then
    raise exception 'Period IR movements are incorrect: %', row_to_json(v_period_record);
  end if;

  select * into v_summary_after from public.reconciliation_summary;
  if v_summary_after.ip_outstanding - v_summary_before.ip_outstanding <> 400
     or v_summary_after.ir_outstanding - v_summary_before.ir_outstanding <> 0
     or v_summary_after.total_unreconciled - v_summary_before.total_unreconciled <> 400
     or v_summary_after.total_reconciled - v_summary_before.total_reconciled <> 1100 then
    raise exception 'Reconciliation summary does not match manual totals: %',
      row_to_json(v_summary_after);
  end if;

  v_adjustment_id := public.record_fund_adjustment(
    'ip', v_ip_id, v_ir_id, 'inflow', date '2024-06-10', 10,
    'LEDGER-CORRECTION', 'Documented correction', 'Corrected source statement'
  );
  select * into v_ip_balance from public.reconciliation_balances
   where entity_type = 'ip' and entity_id = v_ip_id;
  if v_ip_balance.balance_amount <> 210 then
    raise exception 'A recorded IP correction must affect its reconciliation balance';
  end if;
  if not exists (
    select 1 from public.transaction_ledger
     where transaction_id = v_adjustment_id
       and correction_reason = 'Corrected source statement'
       and related_ir_id = v_ir_id
       and debit = 10
       and credit = 0
  ) then
    raise exception 'The correction ledger entry or its reason/IR link is missing';
  end if;
  if not exists (
    select 1 from public.audit_logs
     where entity_table = 'fund_movements'
       and entity_id = v_adjustment_id
       and action = 'INSERT'
  ) then
    raise exception 'The correction was not written to the audit trail';
  end if;

  v_ip_only_ir_id := public.create_ir_record(
    'operasional', date '2024-06-11', 'Ledger Test PIC',
    'IP-only reimbursement acceptance',
    'IP-only ledger reconciliation IR', date '2024-06-01', date '2024-06-30',
    'Acceptance fixture'
  );
  perform public.record_ir_transaction(
    v_ip_only_ir_id, date '2024-06-11', v_operational_category,
    'IP-only funded transaction', 'Test vendor', 50, 'transfer',
    jsonb_build_array(
      jsonb_build_object('source_type', 'ip', 'ip_record_id', v_ip_id, 'amount', 50)
    ),
    v_receipt
  );
  perform public.set_ir_ptjb_status(v_ip_only_ir_id, 'submitted');
  perform public.set_ir_ptjb_status(v_ip_only_ir_id, 'approved');
  if exists (
    select 1 from public.fund_movements
     where related_ir_record_id = v_ip_only_ir_id and ir_replenishment and not is_void
  ) then
    raise exception 'An IP-only IR requires explicit admin confirmation before replenishment';
  end if;
  perform public.record_ip_return(
    v_ip_id, date '2024-06-12', 360, 'transfer', 'IP-RETURN-BEFORE-IR-REPLENISHMENT',
    null, jsonb_set(v_evidence, '{object_path}',
      to_jsonb(v_admin_id::text || '/test/' || gen_random_uuid()::text || '.pdf'))
  );
  begin
    update public.ip_records set status = 'settled' where id = v_ip_id;
    raise exception 'Expected settlement to be blocked while IP funds remain in an IR';
  exception
    when check_violation then
      if sqlerrm not like 'IP cannot be settled until all IP-funded IR allocations are returned%' then
        raise;
      end if;
  end;
  v_ip_only_evidence := jsonb_build_object(
    'object_path', v_admin_id::text || '/ir/' || v_ip_only_ir_id::text ||
      '/replenishments/' || gen_random_uuid()::text || '.pdf',
    'original_file_name', 'ip-replenishment-test.pdf',
    'system_file_name', gen_random_uuid()::text || '.pdf',
    'document_type', 'bank_transfer',
    'mime_type', 'application/pdf',
    'file_size_bytes', 128
  );
  perform public.record_ir_ip_replenishment(
    v_ip_only_ir_id, date '2024-06-12', 'IP-ONLY-RETURN-1',
    'Dana pengganti diterima', v_ip_only_evidence
  );
  if not exists (
    select 1 from public.transaction_ledger
     where related_ir_id = v_ip_only_ir_id
       and ir_replenishment
       and debit = 50
       and credit = 0
  ) or not exists (
    select 1 from public.evidence_files
     where ir_record_id = v_ip_only_ir_id
       and object_path = v_ip_only_evidence ->> 'object_path'
       and status = 'active'
  ) then
    raise exception 'Admin-confirmed IP-only reimbursement needs a linked ledger entry and evidence';
  end if;
end;
$$;

rollback;
