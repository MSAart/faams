create sequence if not exists public.ir_operasional_reference_seq;
create sequence if not exists public.ir_facility_reference_seq;

alter table public.ir_records
  add column if not exists purpose text not null default '',
  add column if not exists pic_name text,
  add column if not exists period_start date,
  add column if not exists period_end date;

alter table public.ir_records
  drop constraint if exists ir_records_period_check;
alter table public.ir_records
  add constraint ir_records_period_check
    check (
      period_start is null or period_end is null or period_end >= period_start
    );

alter table public.evidence_files
  add column if not exists reimbursement_payment_id uuid
    references public.reimbursement_payments (id) on delete restrict;

alter table public.evidence_files
  drop constraint if exists evidence_files_parent_check;
alter table public.evidence_files
  add constraint evidence_files_parent_check
  check (
    num_nonnulls(
      expense_id, ip_record_id, settlement_id, reimbursement_payment_id
    ) = 1
  );

alter table public.evidence_files
  drop constraint if exists evidence_files_document_type_check;
alter table public.evidence_files
  add constraint evidence_files_document_type_check
  check (document_type in (
    'receipt', 'invoice', 'approval', 'settlement', 'bank_transfer',
    'fund_return', 'other'
  ));

create index if not exists ir_records_type_status_submitted_idx
  on public.ir_records (ir_type, status, submitted_on desc);
create index if not exists ir_transactions_ir_date_status_idx
  on public.ir_transactions (ir_record_id, transaction_date desc, status);
create index if not exists reimbursement_payments_ir_status_date_idx
  on public.reimbursement_payments (ir_record_id, status, payment_date desc);
create index if not exists evidence_payment_status_idx
  on public.evidence_files (reimbursement_payment_id, status)
  where reimbursement_payment_id is not null;

create or replace function public.validate_transaction_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_allocated numeric(18, 2);
  v_ip_status text;
  v_ip_balance numeric(18, 2);
  v_existing_movement numeric(18, 2);
begin
  select * into v_expense
    from public.expenses
   where id = new.expense_id
   for update;
  if not found then
    raise exception 'Expense % does not exist', new.expense_id
      using errcode = '23503';
  end if;
  if v_expense.status <> 'posted' and new.status = 'active' then
    raise exception 'Allocations can only be active for posted expenses'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.source_type is distinct from old.source_type
    or new.ip_record_id is distinct from old.ip_record_id
    or new.personal_profile_id is distinct from old.personal_profile_id
  ) then
    raise exception 'A funding allocation cannot be moved to another source'
      using errcode = '23514';
  end if;

  if new.source_type = 'ip' then
    select status
      into v_ip_status
      from public.ip_records
     where id = new.ip_record_id
       and disbursement_date is not null
       and disbursed_amount > 0
     for update;
    if not found or v_ip_status not in ('disbursed', 'settlement_in_progress') then
      raise exception 'IP allocation must reference a disbursed, active IP'
        using errcode = '23514';
    end if;
    if v_expense.ip_record_id is not null
       and v_expense.ip_record_id <> new.ip_record_id then
      raise exception 'IP allocation must match the expense IP record'
        using errcode = '23514';
    end if;
    if new.status = 'active' then
      select coalesce(sum(
        case when direction = 'inflow' then amount else -amount end
      ), 0)
        into v_ip_balance
        from public.fund_movements
       where ip_record_id = new.ip_record_id
         and not is_void;
      select coalesce(amount, 0)
        into v_existing_movement
        from public.fund_movements
       where allocation_id = new.id
         and ip_record_id = new.ip_record_id
         and not is_void;
      if not found then
        v_existing_movement := 0;
      end if;
      if new.amount > v_ip_balance + v_existing_movement then
        raise exception 'IP allocation (%) exceeds available IP balance (%)',
          new.amount, v_ip_balance + v_existing_movement
          using errcode = '23514';
      end if;
    end if;
  else
    if not exists (
      select 1
        from public.profiles as p
       where p.id = new.personal_profile_id
         and p.is_admin
    ) then
      raise exception 'Personal allocation must reference the administrator profile'
        using errcode = '23514';
    end if;
    if v_expense.ip_record_id is not null then
      raise exception 'Direct IP expenses must be allocated to their IP source'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'active' then
    select coalesce(sum(a.amount), 0)
      into v_allocated
      from public.transaction_allocations as a
     where a.expense_id = new.expense_id
       and a.status = 'active'
       and a.id is distinct from new.id;
    if v_allocated + new.amount > v_expense.amount then
      raise exception 'Active allocations (%) would exceed expense amount (%)',
        v_allocated + new.amount, v_expense.amount
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.validate_ir_allocation_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expense_id uuid;
  v_amount numeric(18, 2);
  v_status text;
  v_allocated numeric(18, 2);
begin
  if tg_table_name = 'expenses' then
    v_expense_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_expense_id := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
  end if;
  select amount, status into v_amount, v_status
    from public.expenses where id = v_expense_id;
  if not found or v_status <> 'posted' then
    return null;
  end if;
  select coalesce(sum(amount), 0) into v_allocated
    from public.transaction_allocations
   where expense_id = v_expense_id and status = 'active';
  if v_allocated <> v_amount then
    raise exception 'Active allocations (%) must equal the transaction amount (%)',
      v_allocated, v_amount using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists expenses_ir_allocation_total on public.expenses;
create constraint trigger expenses_ir_allocation_total
  after insert or update or delete on public.expenses
  deferrable initially deferred
  for each row execute procedure public.validate_ir_allocation_total();
drop trigger if exists allocations_ir_total on public.transaction_allocations;
create constraint trigger allocations_ir_total
  after insert or update or delete on public.transaction_allocations
  deferrable initially deferred
  for each row execute procedure public.validate_ir_allocation_total();

create or replace function public.create_ir_record(
  p_ir_type text,
  p_submitted_on date,
  p_pic_name text,
  p_purpose text,
  p_title text,
  p_period_start date,
  p_period_end date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_reference text;
  v_number bigint;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if p_ir_type not in ('operasional', 'facility')
     or p_submitted_on is null
     or nullif(trim(p_pic_name), '') is null
     or nullif(trim(p_purpose), '') is null
     or nullif(trim(p_title), '') is null
     or (p_period_start is not null and p_period_end is not null
         and p_period_end < p_period_start) then
    raise exception 'IR type, date, PIC, purpose, description, and valid period are required'
      using errcode = '22023';
  end if;

  if p_ir_type = 'operasional' then
    v_number := nextval('public.ir_operasional_reference_seq');
  else
    v_number := nextval('public.ir_facility_reference_seq');
  end if;
  v_reference := 'IR-' ||
    case when p_ir_type = 'operasional' then 'OPS' else 'FAC' end ||
    '-' || to_char(p_submitted_on, 'YYYY') || '-' ||
    lpad(v_number::text, 6, '0');

  insert into public.ir_records (
    id, reference_code, ir_type, title, submitted_on, purpose, pic_name,
    period_start, period_end, notes, status, ptjb_status, payment_status, created_by
  ) values (
    v_id, v_reference, p_ir_type, trim(p_title), p_submitted_on,
    trim(p_purpose), trim(p_pic_name), p_period_start, p_period_end,
    nullif(trim(p_notes), ''), 'draft', 'not_submitted', 'unpaid', auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.record_ir_transaction(
  p_ir_record_id uuid,
  p_transaction_date date,
  p_category_id uuid,
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_payment_method text,
  p_allocations jsonb,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir public.ir_records%rowtype;
  v_transaction_id uuid := gen_random_uuid();
  v_expense_id uuid := gen_random_uuid();
  v_allocation jsonb;
  v_file jsonb;
  v_allocation_total numeric(18, 2) := 0;
  v_category_scope text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ir from public.ir_records
   where id = p_ir_record_id for update;
  if not found or v_ir.status in ('completed', 'void')
     or v_ir.ptjb_status in ('submitted', 'approved') then
    raise exception 'Transactions can only be added to an open IR before PTJB submission'
      using errcode = '23514';
  end if;
  select scope into v_category_scope
    from public.categories
   where id = p_category_id and is_active;
  if not found or v_category_scope <> v_ir.ir_type then
    raise exception 'Choose an active category matching this IR type'
      using errcode = '23514';
  end if;
  if p_transaction_date is null or nullif(trim(p_description), '') is null
     or p_amount is null or p_amount <= 0
     or p_payment_method is null
     or p_payment_method not in ('cash', 'transfer', 'card', 'other')
     or coalesce(jsonb_typeof(p_allocations), '') <> 'array'
     or coalesce(jsonb_array_length(p_allocations), 0) = 0
     or coalesce(jsonb_typeof(p_evidence), '') <> 'array' then
    raise exception 'Transaction requires date, description, amount, payment method, funding, and an evidence list'
      using errcode = '22023';
  end if;

  for v_allocation in select value from jsonb_array_elements(p_allocations)
  loop
    if coalesce(v_allocation ->> 'source_type', '') not in ('ip', 'personal')
       or coalesce((v_allocation ->> 'amount')::numeric, 0) <= 0
       or (v_allocation ->> 'source_type' = 'ip'
           and nullif(v_allocation ->> 'ip_record_id', '') is null)
       or (v_allocation ->> 'source_type' = 'personal'
           and nullif(v_allocation ->> 'ip_record_id', '') is not null) then
      raise exception 'Every funding allocation needs a valid source and positive amount'
        using errcode = '23514';
    end if;
    v_allocation_total := v_allocation_total + (v_allocation ->> 'amount')::numeric;
  end loop;
  if v_allocation_total <> p_amount then
    raise exception 'Funding allocations (%) must equal transaction amount (%)',
      v_allocation_total, p_amount using errcode = '23514';
  end if;

  insert into public.ir_transactions (
    id, ir_record_id, transaction_date, description, status
  ) values (
    v_transaction_id, p_ir_record_id, p_transaction_date, trim(p_description), 'active'
  );
  insert into public.expenses (
    id, ir_transaction_id, category_id, expense_date, description,
    vendor, amount, payment_method, status, created_by
  ) values (
    v_expense_id, v_transaction_id, p_category_id, p_transaction_date,
    trim(p_description), nullif(trim(p_vendor), ''), p_amount,
    p_payment_method, 'posted', auth.uid()
  );
  for v_allocation in select value from jsonb_array_elements(p_allocations)
  loop
    insert into public.transaction_allocations (
      expense_id, source_type, ip_record_id, personal_profile_id, amount, status
    ) values (
      v_expense_id,
      v_allocation ->> 'source_type',
      case when v_allocation ->> 'source_type' = 'ip'
        then (v_allocation ->> 'ip_record_id')::uuid else null end,
      case when v_allocation ->> 'source_type' = 'personal'
        then auth.uid() else null end,
      (v_allocation ->> 'amount')::numeric,
      'active'
    );
  end loop;
  for v_file in select value from jsonb_array_elements(p_evidence)
  loop
    if v_file ->> 'document_type' not in ('receipt', 'invoice', 'bank_transfer', 'other') then
      raise exception 'Unsupported transaction evidence type'
        using errcode = '23514';
    end if;
    insert into public.evidence_files (
      expense_id, object_path, original_file_name, system_file_name,
      document_type, mime_type, file_size_bytes, uploaded_by
    ) values (
      v_expense_id, v_file ->> 'object_path', v_file ->> 'original_file_name',
      v_file ->> 'system_file_name', v_file ->> 'document_type',
      v_file ->> 'mime_type', (v_file ->> 'file_size_bytes')::bigint, auth.uid()
    );
  end loop;
  update public.ir_records
     set ptjb_status = 'in_progress'
   where id = p_ir_record_id;
  return v_transaction_id;
end;
$$;

create or replace function public.set_ir_ptjb_status(
  p_ir_record_id uuid,
  p_next_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir public.ir_records%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ir from public.ir_records
   where id = p_ir_record_id for update;
  if not found or p_next_status not in ('submitted', 'approved') then
    raise exception 'Invalid IR or PTJB status' using errcode = '22023';
  end if;
  if p_next_status = 'submitted' then
    if v_ir.status in ('completed', 'void')
       or v_ir.ptjb_status in ('submitted', 'approved') then
      raise exception 'This IR cannot be submitted for PTJB'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.ir_transactions as transaction
        join public.expenses as expense
          on expense.ir_transaction_id = transaction.id
         and expense.status = 'posted'
       where transaction.ir_record_id = p_ir_record_id
         and transaction.status = 'active'
    ) or exists (
      select 1
        from public.ir_transactions as transaction
       where transaction.ir_record_id = p_ir_record_id
         and transaction.status = 'active'
         and not exists (
           select 1 from public.expenses as expense
            where expense.ir_transaction_id = transaction.id
              and expense.status = 'posted'
         )
    ) or exists (
      select 1
        from public.ir_transactions as transaction
        join public.expenses as expense
          on expense.ir_transaction_id = transaction.id
         and expense.status = 'posted'
       where transaction.ir_record_id = p_ir_record_id
         and transaction.status = 'active'
         and (
           not exists (
             select 1 from public.evidence_files as evidence
              where evidence.expense_id = expense.id and evidence.status = 'active'
           )
           or (select coalesce(sum(allocation.amount), 0)
                 from public.transaction_allocations as allocation
                where allocation.expense_id = expense.id
                  and allocation.status = 'active') <> expense.amount
         )
    ) then
      raise exception 'Every IR transaction must have complete funding and active evidence before PTJB'
        using errcode = '23514';
    end if;
    update public.ir_records
       set ptjb_status = 'submitted', status = 'submitted'
     where id = p_ir_record_id;
  else
    if v_ir.ptjb_status <> 'submitted' or v_ir.status = 'void' then
      raise exception 'Only a submitted PTJB can be marked approved'
        using errcode = '23514';
    end if;
    update public.ir_records
       set ptjb_status = 'approved', status = 'approved'
     where id = p_ir_record_id;
  end if;
end;
$$;

create or replace function public.record_ir_reimbursement_payment(
  p_ir_record_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_reference text,
  p_notes text,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir public.ir_records%rowtype;
  v_payment_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ir from public.ir_records
   where id = p_ir_record_id for update;
  if not found or v_ir.ptjb_status <> 'approved'
     or v_ir.status in ('completed', 'void') then
    raise exception 'Reimbursement can only be recorded for an approved, open PTJB'
      using errcode = '23514';
  end if;
  if p_payment_date is null or p_amount is null or p_amount <= 0
     or coalesce(jsonb_typeof(p_evidence), '') <> 'object' then
    raise exception 'Payment date, positive amount, and transfer evidence are required'
      using errcode = '22023';
  end if;

  insert into public.reimbursement_payments (
    id, ir_record_id, payment_date, amount, status, reference_code, notes, created_by
  ) values (
    v_payment_id, p_ir_record_id, p_payment_date, p_amount, 'paid',
    nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid()
  );
  insert into public.evidence_files (
    reimbursement_payment_id, object_path, original_file_name, system_file_name,
    document_type, mime_type, file_size_bytes, uploaded_by
  ) values (
    v_payment_id, p_evidence ->> 'object_path',
    p_evidence ->> 'original_file_name', p_evidence ->> 'system_file_name',
    'bank_transfer', p_evidence ->> 'mime_type',
    (p_evidence ->> 'file_size_bytes')::bigint, auth.uid()
  );
  return v_payment_id;
end;
$$;

create or replace function public.close_ir_record(p_ir_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir public.ir_records%rowtype;
  v_receivable numeric(18, 2);
  v_paid numeric(18, 2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ir from public.ir_records
   where id = p_ir_record_id for update;
  if not found or v_ir.ptjb_status <> 'approved'
     or v_ir.status in ('completed', 'void') then
    raise exception 'Only an approved, open PTJB can be closed'
      using errcode = '23514';
  end if;
  select coalesce(sum(allocation.amount), 0)
    into v_receivable
    from public.ir_transactions as transaction
    join public.expenses as expense
      on expense.ir_transaction_id = transaction.id and expense.status = 'posted'
    join public.transaction_allocations as allocation
      on allocation.expense_id = expense.id
       and allocation.status = 'active'
       and allocation.source_type = 'personal'
   where transaction.ir_record_id = p_ir_record_id
     and transaction.status = 'active';
  select coalesce(sum(amount), 0)
    into v_paid
    from public.reimbursement_payments
   where ir_record_id = p_ir_record_id and status = 'paid';
  if v_paid <> v_receivable then
    raise exception 'Outstanding personal reimbursement (%) must be zero before closing',
      v_receivable - v_paid using errcode = '23514';
  end if;
  update public.ir_records set status = 'completed' where id = p_ir_record_id;
end;
$$;

create or replace view public.ir_monitoring
with (security_invoker = true)
as
select
  ir.id,
  ir.reference_code,
  ir.ir_type,
  ir.title,
  ir.purpose,
  ir.pic_name,
  ir.submitted_on,
  ir.period_start,
  ir.period_end,
  ir.status,
  ir.ptjb_status,
  ir.payment_status,
  ir.notes,
  coalesce(fin.transaction_count, 0)::integer as transaction_count,
  coalesce(fin.total_amount, 0)::numeric(18, 2) as total_amount,
  coalesce(fin.personal_amount, 0)::numeric(18, 2) as personal_amount,
  coalesce(fin.ip_amount, 0)::numeric(18, 2) as ip_amount,
  coalesce(pay.paid_amount, 0)::numeric(18, 2) as paid_amount,
  greatest(coalesce(fin.personal_amount, 0) - coalesce(pay.paid_amount, 0), 0)::numeric(18, 2)
    as outstanding_amount,
  coalesce(fin.missing_evidence_count, 0)::integer as missing_evidence_count,
  case
    when ir.status = 'void' then 'Void'
    when ir.status = 'completed' then 'Closed'
    when coalesce(fin.personal_amount, 0) > 0
      and coalesce(pay.paid_amount, 0) >= coalesce(fin.personal_amount, 0)
      and ir.ptjb_status in ('submitted', 'approved') then 'Reimbursed'
    when coalesce(pay.paid_amount, 0) > 0 then 'Partially Reimbursed'
    when ir.ptjb_status in ('submitted', 'approved')
      and coalesce(fin.personal_amount, 0) > 0 then 'Reimbursement Outstanding'
    when ir.ptjb_status in ('submitted', 'approved') then 'PTJB Submitted'
    when coalesce(fin.transaction_count, 0) = 0 then 'Draft'
    when coalesce(fin.missing_evidence_count, 0) > 0 then 'Evidence Incomplete'
    when ir.ptjb_status = 'in_progress' then 'Ready for PTJB'
    else 'Recorded'
  end as workflow_status
from public.ir_records as ir
left join lateral (
  select
    count(distinct transaction.id) as transaction_count,
    sum(expense.amount) as total_amount,
    sum((
      select coalesce(sum(allocation.amount), 0)
        from public.transaction_allocations as allocation
       where allocation.expense_id = expense.id
         and allocation.status = 'active'
         and allocation.source_type = 'personal'
    )) as personal_amount,
    sum((
      select coalesce(sum(allocation.amount), 0)
        from public.transaction_allocations as allocation
       where allocation.expense_id = expense.id
         and allocation.status = 'active'
         and allocation.source_type = 'ip'
    )) as ip_amount,
    count(*) filter (
      where not exists (
        select 1 from public.evidence_files as evidence
         where evidence.expense_id = expense.id and evidence.status = 'active'
      )
    ) as missing_evidence_count
  from public.ir_transactions as transaction
  join public.expenses as expense
    on expense.ir_transaction_id = transaction.id and expense.status = 'posted'
  where transaction.ir_record_id = ir.id and transaction.status = 'active'
) as fin on true
left join lateral (
  select sum(amount) as paid_amount
    from public.reimbursement_payments
   where ir_record_id = ir.id and status = 'paid'
) as pay on true;

create or replace view public.ir_reporting_summary
with (security_invoker = true)
as
select
  coalesce(sum(total_amount) filter (where ir_type = 'operasional' and status <> 'void'), 0)::numeric(18, 2)
    as operational_total,
  coalesce(sum(total_amount) filter (where ir_type = 'facility' and status <> 'void'), 0)::numeric(18, 2)
    as facility_total,
  coalesce(sum(personal_amount) filter (where status <> 'void'), 0)::numeric(18, 2)
    as personal_funded_total,
  coalesce(sum(ip_amount) filter (where status <> 'void'), 0)::numeric(18, 2)
    as ip_funded_total,
  coalesce(sum(personal_amount) filter (where status <> 'void'), 0)::numeric(18, 2)
    as reimbursement_receivable_total,
  coalesce(sum(paid_amount) filter (where status <> 'void'), 0)::numeric(18, 2)
    as reimbursement_paid_total,
  coalesce(sum(outstanding_amount) filter (where status <> 'void'), 0)::numeric(18, 2)
    as reimbursement_outstanding_total
from public.ir_monitoring;

revoke all on public.ir_monitoring, public.ir_reporting_summary
  from public, anon, authenticated;
grant select on public.ir_monitoring, public.ir_reporting_summary to authenticated;

revoke all on function public.create_ir_record(text, date, text, text, text, date, date, text)
  from public, anon;
revoke all on function public.record_ir_transaction(uuid, date, uuid, text, text, numeric, text, jsonb, jsonb)
  from public, anon;
revoke all on function public.set_ir_ptjb_status(uuid, text)
  from public, anon;
revoke all on function public.record_ir_reimbursement_payment(uuid, date, numeric, text, text, jsonb)
  from public, anon;
revoke all on function public.close_ir_record(uuid)
  from public, anon;
grant execute on function public.create_ir_record(text, date, text, text, text, date, date, text)
  to authenticated;
grant execute on function public.record_ir_transaction(uuid, date, uuid, text, text, numeric, text, jsonb, jsonb)
  to authenticated;
grant execute on function public.set_ir_ptjb_status(uuid, text)
  to authenticated;
grant execute on function public.record_ir_reimbursement_payment(uuid, date, numeric, text, text, jsonb)
  to authenticated;
grant execute on function public.close_ir_record(uuid)
  to authenticated;
