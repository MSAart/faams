create or replace view public.transaction_ledger
with (security_invoker = true)
as
select
  movement.id as transaction_id,
  movement.movement_date as transaction_date,
  coalesce(
    movement.reference_code,
    ip.reference_code,
    settlement.reference_code,
    ir.reference_code,
    movement.id::text
  ) as reference,
  movement.description,
  case when movement.direction = 'inflow'
    then movement.amount else 0 end::numeric(18, 2) as debit,
  case when movement.direction = 'outflow'
    then movement.amount else 0 end::numeric(18, 2) as credit,
  case
    when movement.source_type = 'ip'
      then 'IP · ' || coalesce(ip.reference_code, movement.ip_record_id::text)
    else 'Personal'
  end as funding_source,
  movement.source_type,
  movement.movement_type,
  coalesce(movement.ip_record_id, expense.ip_record_id, allocation.ip_record_id)
    as related_ip_id,
  related_ip.reference_code as related_ip_reference,
  coalesce(transaction.ir_record_id, movement.related_ir_record_id)
    as related_ir_id,
  coalesce(ir.reference_code, related_ir.reference_code) as related_ir_reference,
  evidence.evidence_reference,
  evidence.evidence_count,
  movement.correction_reason,
  movement.is_void,
  concat_ws(
    ' ', movement.id::text, movement.reference_code, movement.description,
    ip.reference_code, related_ip.reference_code,
    ir.reference_code, related_ir.reference_code,
    evidence.evidence_reference
  ) as search_text,
  expense.id as related_expense_id,
  expense.category_id,
  category.name as category_name,
  coalesce(ir.ir_type, related_ir.ir_type)::text as ir_type,
  coalesce(ir.status, related_ir.status, related_ip.status, ip.status)::text
    as record_status
from public.fund_movements as movement
left join public.ip_records as ip
  on ip.id = movement.ip_record_id
left join public.transaction_allocations as allocation
  on allocation.id = movement.allocation_id
left join public.expenses as expense
  on expense.id = allocation.expense_id
left join public.categories as category
  on category.id = expense.category_id
left join public.ir_transactions as transaction
  on transaction.id = expense.ir_transaction_id
left join public.ir_records as ir
  on ir.id = transaction.ir_record_id
left join public.settlements as settlement
  on settlement.id = movement.settlement_id
left join public.ip_records as related_ip
  on related_ip.id = coalesce(movement.ip_record_id, expense.ip_record_id, allocation.ip_record_id)
left join public.ir_records as related_ir
  on related_ir.id = movement.related_ir_record_id
left join lateral (
  select
    string_agg(distinct file.original_file_name, ', ' order by file.original_file_name)
      as evidence_reference,
    count(distinct file.id)::integer as evidence_count
  from public.evidence_files as file
  where file.status = 'active'
    and (
      file.expense_id = expense.id
      or file.settlement_id = movement.settlement_id
      or (
        movement.movement_type = 'disbursement'
        and file.ip_record_id = movement.ip_record_id
      )
      or (
        movement.movement_type = 'adjustment'
        and (
          file.ip_record_id = movement.ip_record_id
          or file.ir_record_id = movement.related_ir_record_id
        )
      )
    )
) as evidence on true
where not movement.is_void

union all

select
  payment.id as transaction_id,
  payment.payment_date as transaction_date,
  coalesce(payment.reference_code, ir.reference_code, payment.id::text) as reference,
  'Reimbursement diterima untuk ' || ir.title as description,
  payment.amount::numeric(18, 2) as debit,
  0::numeric(18, 2) as credit,
  'Personal'::text as funding_source,
  'personal'::text as source_type,
  'reimbursement_received'::text as movement_type,
  null::uuid as related_ip_id,
  null::text as related_ip_reference,
  ir.id as related_ir_id,
  ir.reference_code as related_ir_reference,
  evidence.evidence_reference,
  evidence.evidence_count,
  null::text as correction_reason,
  false as is_void,
  concat_ws(
    ' ', payment.id::text, payment.reference_code, ir.reference_code,
    ir.title, evidence.evidence_reference
  ) as search_text,
  null::uuid as related_expense_id,
  null::uuid as category_id,
  null::text as category_name,
  ir.ir_type::text as ir_type,
  ir.status::text as record_status
from public.reimbursement_payments as payment
join public.ir_records as ir on ir.id = payment.ir_record_id
left join lateral (
  select
    string_agg(distinct file.original_file_name, ', ' order by file.original_file_name)
      as evidence_reference,
    count(distinct file.id)::integer as evidence_count
  from public.evidence_files as file
  where file.reimbursement_payment_id = payment.id
    and file.status = 'active'
) as evidence on true
where payment.status = 'paid';

revoke all on public.transaction_ledger from public, anon, authenticated;
grant select on public.transaction_ledger to authenticated;
