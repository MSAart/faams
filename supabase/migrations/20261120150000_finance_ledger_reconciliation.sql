alter table public.fund_movements
  add column if not exists reference_code text,
  add column if not exists related_ir_record_id uuid
    references public.ir_records (id) on delete restrict,
  add column if not exists correction_reason text;

update public.fund_movements
   set correction_reason = description
 where movement_type = 'adjustment'
   and nullif(trim(correction_reason), '') is null;

alter table public.fund_movements
  drop constraint if exists fund_movements_adjustment_reason_check;
alter table public.fund_movements
  add constraint fund_movements_adjustment_reason_check
  check (
    movement_type <> 'adjustment'
    or length(trim(coalesce(correction_reason, ''))) > 0
  );

create index if not exists fund_movements_reference_idx
  on public.fund_movements (reference_code)
  where reference_code is not null;
create index if not exists fund_movements_related_ir_idx
  on public.fund_movements (related_ir_record_id, movement_date desc)
  where related_ir_record_id is not null;
create index if not exists reimbursement_payments_paid_date_idx
  on public.reimbursement_payments (payment_date desc)
  where status = 'paid';

create or replace function public.record_fund_adjustment(
  p_source_type text,
  p_ip_record_id uuid,
  p_related_ir_record_id uuid,
  p_direction text,
  p_movement_date date,
  p_amount numeric,
  p_reference text,
  p_description text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ip public.ip_records%rowtype;
  v_personal_balance numeric(18, 2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if p_source_type is null or p_source_type not in ('ip', 'personal')
     or p_direction is null or p_direction not in ('inflow', 'outflow')
     or p_movement_date is null
     or p_amount is null or p_amount <= 0
     or nullif(trim(p_description), '') is null
     or nullif(trim(p_reason), '') is null
     or (p_source_type = 'ip' and p_ip_record_id is null)
     or (p_source_type = 'personal' and p_ip_record_id is not null) then
    raise exception 'A valid source, direction, date, positive amount, description, and correction reason are required'
      using errcode = '22023';
  end if;
  if p_related_ir_record_id is not null and not exists (
    select 1 from public.ir_records where id = p_related_ir_record_id
  ) then
    raise exception 'The related IR record does not exist' using errcode = '23503';
  end if;

  if p_source_type = 'ip' then
    select * into v_ip
      from public.ip_records
     where id = p_ip_record_id
     for update;
    if not found or v_ip.status = 'void' then
      raise exception 'The selected IP does not exist or is void' using errcode = '23514';
    end if;
  elsif p_direction = 'outflow' then
    select coalesce(sum(
      case when direction = 'inflow' then amount else -amount end
    ), 0)
      into v_personal_balance
      from public.fund_movements
     where source_type = 'personal'
       and personal_profile_id = auth.uid()
       and not is_void;
    select v_personal_balance + coalesce((
      select sum(payment.amount)
        from public.reimbursement_payments as payment
       where payment.status = 'paid'
         and exists (
           select 1
             from public.ir_transactions as transaction
             join public.expenses as expense
               on expense.ir_transaction_id = transaction.id
              and expense.status = 'posted'
             join public.transaction_allocations as allocation
               on allocation.expense_id = expense.id
              and allocation.status = 'active'
              and allocation.source_type = 'personal'
              and allocation.personal_profile_id = auth.uid()
            where transaction.ir_record_id = payment.ir_record_id
              and transaction.status = 'active'
         )
    ), 0)
      into v_personal_balance;
    if p_amount > v_personal_balance then
      raise exception 'Personal adjustment exceeds available recorded funds (%)',
        v_personal_balance using errcode = '23514';
    end if;
  end if;

  insert into public.fund_movements (
    id, movement_type, direction, source_type, ip_record_id,
    personal_profile_id, related_ir_record_id, movement_date, amount,
    reference_code, description, correction_reason
  ) values (
    v_id, 'adjustment', p_direction, p_source_type, p_ip_record_id,
    case when p_source_type = 'personal' then auth.uid() else null end,
    p_related_ir_record_id, p_movement_date, p_amount,
    nullif(trim(p_reference), ''), trim(p_description), trim(p_reason)
  );
  return v_id;
end;
$$;

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
  ) as search_text
from public.fund_movements as movement
left join public.ip_records as ip
  on ip.id = movement.ip_record_id
left join public.transaction_allocations as allocation
  on allocation.id = movement.allocation_id
left join public.expenses as expense
  on expense.id = allocation.expense_id
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
  ) as search_text
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

create or replace view public.reconciliation_balances
with (security_invoker = true)
as
select
  'ip'::text as entity_type,
  ip.id as entity_id,
  ip.reference_code,
  ip.title as description,
  ip.disbursement_date as activity_date,
  ip.disbursed_amount::numeric(18, 2) as principal_amount,
  ip.valid_realization::numeric(18, 2) as realized_amount,
  ip.returned_amount::numeric(18, 2) as returned_amount,
  0::numeric(18, 2) as personal_funded_amount,
  0::numeric(18, 2) as reimbursement_paid_amount,
  coalesce(movement.balance_amount, ip.unsettled_balance)::numeric(18, 2)
    as balance_amount,
  greatest(coalesce(movement.balance_amount, ip.unsettled_balance), 0)::numeric(18, 2)
    as outstanding_amount,
  (ip.valid_realization + ip.returned_amount)::numeric(18, 2) as reconciled_amount,
  ip.status as record_status,
  ip.discrepancy_count,
  case
    when coalesce(movement.balance_amount, ip.unsettled_balance) < 0 then 'Discrepancy'
    when ip.discrepancy_count > 0 then 'Unverified'
    when ip.valid_realization > ip.requested_amount then 'Over Budget'
    when ip.status = 'closed'
      and coalesce(movement.balance_amount, ip.unsettled_balance) = 0 then 'Closed'
    when ip.disbursement_date is null then 'Unverified'
    when coalesce(movement.balance_amount, ip.unsettled_balance) > 0 then 'Outstanding'
    else 'Balance'
  end as reconciliation_status,
  case
    when coalesce(movement.balance_amount, ip.unsettled_balance) < 0 then
      'Pengeluaran dan pengembalian melampaui dana cair sebesar Rp ' ||
      to_char(abs(coalesce(movement.balance_amount, ip.unsettled_balance)), 'FM999,999,999,999,990.00')
    when ip.discrepancy_count > 0 then discrepancy.detail
    when ip.valid_realization > ip.requested_amount then
      'Realisasi valid melebihi anggaran sebesar Rp ' ||
      to_char(ip.valid_realization - ip.requested_amount, 'FM999,999,999,999,990.00')
    when ip.disbursement_date is null then 'Pencairan IP belum dicatat'
    when coalesce(movement.balance_amount, ip.unsettled_balance) > 0 then
      'Saldo IP belum dipertanggungjawabkan sebesar Rp ' ||
      to_char(coalesce(movement.balance_amount, ip.unsettled_balance), 'FM999,999,999,999,990.00')
    else null
  end as discrepancy_detail,
  null::text as entity_subtype,
  concat_ws(
    ' ', 'IP', ip.reference_code, ip.title, discrepancy.detail, ip.id::text
  ) as search_text
from public.ip_monitoring as ip
left join lateral (
  select sum(
    case when ledger.direction = 'inflow' then ledger.amount else -ledger.amount end
  )::numeric(18, 2) as balance_amount
  from public.fund_movements as ledger
  where ledger.ip_record_id = ip.id
    and not ledger.is_void
) as movement on true
left join lateral (
  select string_agg(
    coalesce(expense.ip_mismatch_reason, 'Alasan ketidaksesuaian belum tersedia'),
    '; ' order by expense.expense_date, expense.id
  ) as detail
  from public.expenses as expense
  where expense.ip_record_id = ip.id
    and expense.status = 'posted'
    and expense.ip_usage_status = 'pending_review'
) as discrepancy on true
where ip.status <> 'void'

union all

select
  'ir'::text as entity_type,
  ir.id as entity_id,
  ir.reference_code,
  ir.title as description,
  ir.submitted_on as activity_date,
  ir.total_amount::numeric(18, 2) as principal_amount,
  (ir.personal_amount + ir.ip_amount)::numeric(18, 2) as realized_amount,
  0::numeric(18, 2) as returned_amount,
  ir.personal_amount::numeric(18, 2) as personal_funded_amount,
  ir.paid_amount::numeric(18, 2) as reimbursement_paid_amount,
  (ir.personal_amount - ir.paid_amount)::numeric(18, 2) as balance_amount,
  greatest(ir.personal_amount - ir.paid_amount, 0)::numeric(18, 2) as outstanding_amount,
  least(ir.personal_amount, ir.paid_amount)::numeric(18, 2) as reconciled_amount,
  ir.status as record_status,
  ir.missing_evidence_count as discrepancy_count,
  case
    when ir.paid_amount > ir.personal_amount then 'Discrepancy'
    when ir.status = 'completed' and ir.outstanding_amount = 0 then 'Closed'
    when ir.missing_evidence_count > 0
      or ir.ptjb_status <> 'approved' then 'Unverified'
    when ir.outstanding_amount > 0 then 'Outstanding'
    else 'Balance'
  end as reconciliation_status,
  case
    when ir.paid_amount > ir.personal_amount then
      'Pembayaran reimbursement melebihi piutang personal'
    when ir.missing_evidence_count > 0 then
      ir.missing_evidence_count::text || ' transaksi belum memiliki evidence aktif'
    when ir.ptjb_status <> 'approved' then
      'PTJB belum disetujui; saldo belum dapat dianggap final'
    when ir.outstanding_amount > 0 then
      'Piutang reimbursement personal tersisa Rp ' ||
      to_char(ir.outstanding_amount, 'FM999,999,999,999,990.00')
    else null
  end as discrepancy_detail,
  ir.ir_type::text as entity_subtype,
  concat_ws(
    ' ', 'IR', ir.reference_code, ir.title, ir.purpose, ir.id::text
  ) as search_text
from public.ir_monitoring as ir
where ir.status <> 'void';

create or replace view public.reconciliation_summary
with (security_invoker = true)
as
select
  coalesce(sum(outstanding_amount) filter (
    where entity_type = 'ip' and record_status not in ('closed', 'void')
  ), 0)::numeric(18, 2) as ip_outstanding,
  coalesce(sum(outstanding_amount) filter (
    where entity_type = 'ir' and record_status not in ('completed', 'void')
  ), 0)::numeric(18, 2) as ir_outstanding,
  coalesce(sum(outstanding_amount) filter (
    where entity_type = 'ir' and record_status not in ('completed', 'void')
  ), 0)::numeric(18, 2) as personal_receivable,
  coalesce(sum(outstanding_amount) filter (
    where record_status not in ('closed', 'completed', 'void')
  ), 0)::numeric(18, 2) as total_unreconciled,
  coalesce(sum(reconciled_amount), 0)::numeric(18, 2) as total_reconciled,
  count(*) filter (where reconciliation_status = 'Discrepancy')::integer
    as discrepancy_count,
  count(*) filter (where reconciliation_status = 'Unverified')::integer
    as unverified_count,
  count(*) filter (where reconciliation_status = 'Over Budget')::integer
    as over_budget_count
from public.reconciliation_balances;

create or replace function public.reconciliation_period_summary(
  p_from_date date,
  p_to_date date
)
returns table (
  ip_debit numeric(18, 2),
  ip_credit numeric(18, 2),
  personal_debit numeric(18, 2),
  personal_credit numeric(18, 2),
  transaction_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(ledger.debit) filter (where ledger.source_type = 'ip'), 0)::numeric(18, 2),
    coalesce(sum(ledger.credit) filter (where ledger.source_type = 'ip'), 0)::numeric(18, 2),
    coalesce(sum(ledger.debit) filter (where ledger.source_type = 'personal'), 0)::numeric(18, 2),
    coalesce(sum(ledger.credit) filter (where ledger.source_type = 'personal'), 0)::numeric(18, 2),
    count(*)::bigint
  from public.transaction_ledger as ledger
  where (p_from_date is null or ledger.transaction_date >= p_from_date)
    and (p_to_date is null or ledger.transaction_date <= p_to_date);
$$;

create or replace function public.reconciliation_period_balances(
  p_from_date date,
  p_to_date date
)
returns table (
  entity_type text,
  entity_subtype text,
  entity_id uuid,
  reference_code text,
  description text,
  ip_debit numeric(18, 2),
  ip_credit numeric(18, 2),
  personal_debit numeric(18, 2),
  personal_credit numeric(18, 2),
  movement_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with period_ledger as (
    select *
      from public.transaction_ledger as ledger
     where (p_from_date is null or ledger.transaction_date >= p_from_date)
       and (p_to_date is null or ledger.transaction_date <= p_to_date)
  ),
  ip_rows as (
    select
      'ip'::text as entity_type,
      null::text as entity_subtype,
      ip.id as entity_id,
      ip.reference_code,
      ip.title as description,
      coalesce(sum(ledger.debit), 0)::numeric(18, 2) as ip_debit,
      coalesce(sum(ledger.credit), 0)::numeric(18, 2) as ip_credit,
      0::numeric(18, 2) as personal_debit,
      0::numeric(18, 2) as personal_credit,
      count(*)::bigint as movement_count
    from period_ledger as ledger
    join public.ip_records as ip on ip.id = ledger.related_ip_id
    where ledger.source_type = 'ip'
      and not ledger.is_void
      and ip.status <> 'void'
    group by ip.id
  ),
  ir_rows as (
    select
      'ir'::text as entity_type,
      ir.ir_type::text as entity_subtype,
      ir.id as entity_id,
      ir.reference_code,
      ir.title as description,
      coalesce(sum(ledger.debit) filter (
        where ledger.source_type = 'ip'
      ), 0)::numeric(18, 2) as ip_debit,
      coalesce(sum(ledger.credit) filter (
        where ledger.source_type = 'ip'
      ), 0)::numeric(18, 2) as ip_credit,
      coalesce(sum(ledger.debit) filter (
        where ledger.source_type = 'personal'
      ), 0)::numeric(18, 2) as personal_debit,
      coalesce(sum(ledger.credit) filter (
        where ledger.source_type = 'personal'
      ), 0)::numeric(18, 2) as personal_credit,
      count(*)::bigint as movement_count
    from period_ledger as ledger
    join public.ir_records as ir on ir.id = ledger.related_ir_id
    where not ledger.is_void
      and ir.status <> 'void'
    group by ir.id
  )
  select * from ip_rows
  union all
  select * from ir_rows
  order by reference_code, entity_type;
$$;

revoke all on public.transaction_ledger, public.reconciliation_balances,
  public.reconciliation_summary from public, anon, authenticated;
grant select on public.transaction_ledger, public.reconciliation_balances,
  public.reconciliation_summary to authenticated;
revoke all on function public.reconciliation_period_summary(date, date)
  from public, anon;
grant execute on function public.reconciliation_period_summary(date, date)
  to authenticated;
revoke all on function public.reconciliation_period_balances(date, date)
  from public, anon;
grant execute on function public.reconciliation_period_balances(date, date)
  to authenticated;

revoke all on function public.record_fund_adjustment(
  text, uuid, uuid, text, date, numeric, text, text, text
) from public, anon;
grant execute on function public.record_fund_adjustment(
  text, uuid, uuid, text, date, numeric, text, text, text
) to authenticated;
