alter table public.fund_movements
  add column if not exists ir_replenishment boolean not null default false,
  add column if not exists ir_replenishment_manual boolean not null default false;

alter table public.fund_movements
  drop constraint if exists fund_movements_ir_replenishment_check;
alter table public.fund_movements
  add constraint fund_movements_ir_replenishment_check
  check (
    (not ir_replenishment_manual or ir_replenishment)
    and (
      not ir_replenishment
      or (
        movement_type = 'adjustment'
        and direction = 'inflow'
        and source_type = 'ip'
        and ip_record_id is not null
        and related_ir_record_id is not null
        and allocation_id is null
        and settlement_id is null
      )
    )
  );

create unique index if not exists fund_movements_ir_replenishment_idx
  on public.fund_movements (related_ir_record_id, ip_record_id)
  where ir_replenishment;

create or replace function public.sync_ir_ip_replenishments(
  p_ir_record_id uuid,
  p_force_manual boolean default false,
  p_replenishment_date date default null,
  p_reference text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir public.ir_records%rowtype;
  v_personal_amount numeric(18, 2);
  v_should_replenish boolean;
  v_date date;
  v_reason text;
  v_allocation record;
begin
  select * into v_ir
    from public.ir_records
   where id = p_ir_record_id
   for update;
  if not found then
    return;
  end if;

  select coalesce(sum(allocation.amount) filter (
    where allocation.source_type = 'personal'
  ), 0)::numeric(18, 2)
    into v_personal_amount
    from public.ir_transactions as transaction
    join public.expenses as expense
      on expense.ir_transaction_id = transaction.id
     and expense.status = 'posted'
    join public.transaction_allocations as allocation
      on allocation.expense_id = expense.id
     and allocation.status = 'active'
   where transaction.ir_record_id = p_ir_record_id
     and transaction.status = 'active';

  if p_force_manual then
    if p_replenishment_date is null
       or nullif(trim(coalesce(p_notes, '')), '') is null
       or v_personal_amount > 0 then
      raise exception 'Manual IP replenishment requires an IP-only IR, date, and confirmation note'
        using errcode = '23514';
    end if;
  end if;

  v_should_replenish :=
    v_ir.ptjb_status = 'approved'
    and v_ir.status <> 'void'
    and (
      p_force_manual
      or (v_personal_amount > 0 and v_ir.payment_status = 'paid')
    );

  if not v_should_replenish then
    update public.fund_movements
       set is_void = true,
           void_reason = 'IR is no longer eligible for IP replenishment',
           updated_at = now()
     where related_ir_record_id = p_ir_record_id
       and ir_replenishment
       and not ir_replenishment_manual
       and not is_void;
    if v_ir.status = 'void' then
      update public.fund_movements
         set is_void = true,
             void_reason = 'Related IR was voided',
             updated_at = now()
       where related_ir_record_id = p_ir_record_id
         and ir_replenishment
         and not is_void;
    end if;
    return;
  end if;

  if p_force_manual then
    v_date := p_replenishment_date;
    v_reason := trim(p_notes);
  else
    select max(payment.payment_date)
      into v_date
      from public.reimbursement_payments as payment
     where payment.ir_record_id = p_ir_record_id
       and payment.status = 'paid';
    v_reason := 'Reimbursement IR lunas; alokasi dana IP dikembalikan ke sumber IP';
  end if;

  if v_date is null then
    raise exception 'IR reimbursement date is required for IP replenishment'
      using errcode = '23514';
  end if;

  for v_allocation in
    select allocation.ip_record_id, sum(allocation.amount)::numeric(18, 2) as amount
      from public.ir_transactions as transaction
      join public.expenses as expense
        on expense.ir_transaction_id = transaction.id
       and expense.status = 'posted'
      join public.transaction_allocations as allocation
        on allocation.expense_id = expense.id
       and allocation.status = 'active'
       and allocation.source_type = 'ip'
     where transaction.ir_record_id = p_ir_record_id
       and transaction.status = 'active'
     group by allocation.ip_record_id
  loop
    insert into public.fund_movements as existing (
      movement_type, direction, source_type, ip_record_id,
      related_ir_record_id, movement_date, amount, description,
      reference_code, correction_reason, ir_replenishment,
      ir_replenishment_manual
    ) values (
      'adjustment', 'inflow', 'ip', v_allocation.ip_record_id,
      p_ir_record_id, v_date, v_allocation.amount,
      'Pengembalian dana IP dari IR ' || coalesce(v_ir.reference_code, p_ir_record_id::text),
      nullif(trim(coalesce(p_reference, '')), ''),
      v_reason, true, p_force_manual
    )
    on conflict (related_ir_record_id, ip_record_id) where ir_replenishment
    do update set
      movement_date = excluded.movement_date,
      amount = excluded.amount,
      description = excluded.description,
      reference_code = coalesce(excluded.reference_code, existing.reference_code),
      correction_reason = excluded.correction_reason,
      ir_replenishment_manual =
        existing.ir_replenishment_manual or excluded.ir_replenishment_manual,
      is_void = false,
      void_reason = null,
      updated_at = now();
  end loop;

  update public.fund_movements as movement
     set is_void = true,
         void_reason = 'IP allocation is no longer active in this IR',
         updated_at = now()
   where movement.related_ir_record_id = p_ir_record_id
     and movement.ir_replenishment
     and not movement.is_void
     and not exists (
       select 1
         from public.ir_transactions as transaction
         join public.expenses as expense
           on expense.ir_transaction_id = transaction.id
          and expense.status = 'posted'
         join public.transaction_allocations as allocation
           on allocation.expense_id = expense.id
          and allocation.status = 'active'
          and allocation.source_type = 'ip'
        where transaction.ir_record_id = p_ir_record_id
          and transaction.status = 'active'
          and allocation.ip_record_id = movement.ip_record_id
     );
end;
$$;

create or replace function public.refresh_ir_payment_status(p_ir_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reimbursable numeric(18, 2);
  v_paid numeric(18, 2);
  v_status text;
begin
  perform 1
    from public.ir_records
   where id = p_ir_record_id
   for update;
  if not found then
    return;
  end if;

  select coalesce(sum(allocation.amount), 0)
    into v_reimbursable
    from public.ir_transactions as transaction
    join public.expenses as expense
      on expense.ir_transaction_id = transaction.id
     and expense.status = 'posted'
    join public.transaction_allocations as allocation
      on allocation.expense_id = expense.id
     and allocation.status = 'active'
     and allocation.source_type = 'personal'
   where transaction.ir_record_id = p_ir_record_id
     and transaction.status = 'active';

  select coalesce(sum(amount), 0)
    into v_paid
    from public.reimbursement_payments
   where ir_record_id = p_ir_record_id
     and status = 'paid';

  if v_paid > v_reimbursable then
    raise exception 'Paid reimbursement (%) exceeds personal-funded expenses (%)',
      v_paid, v_reimbursable
      using errcode = '23514';
  end if;

  v_status := case
    when v_paid = 0 then 'unpaid'
    when v_paid >= v_reimbursable and v_reimbursable > 0 then 'paid'
    else 'partially_paid'
  end;

  update public.ir_records
     set payment_status = v_status,
         updated_at = now()
   where id = p_ir_record_id
     and payment_status is distinct from v_status;

  perform public.sync_ir_ip_replenishments(p_ir_record_id);
end;
$$;

create or replace function public.sync_ir_ip_replenishment_on_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_ir_ip_replenishments(new.id);
  return null;
end;
$$;

drop trigger if exists ir_records_sync_ip_replenishment on public.ir_records;
create trigger ir_records_sync_ip_replenishment
  after update of ptjb_status, status on public.ir_records
  for each row execute procedure public.sync_ir_ip_replenishment_on_record_change();

create or replace function public.validate_evidence_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_type text;
begin
  v_parent_type := case
    when new.ip_record_id is not null then 'ip'
    when new.ir_record_id is not null then 'ir'
    when new.expense_id is not null then 'expense'
    when new.settlement_id is not null then 'settlement'
    when new.reimbursement_payment_id is not null then 'reimbursement_payment'
    else 'unlinked'
  end;
  if v_parent_type = 'unlinked' then
    return new;
  end if;

  if (new.document_type in ('ip_application', 'ip_disbursement')
      and v_parent_type <> 'ip')
     or (new.document_type in (
       'purchase_receipt', 'expense_documentation', 'receipt', 'invoice'
     ) and v_parent_type <> 'expense')
     or (new.document_type = 'ptjb_document' and v_parent_type <> 'ir')
     or (new.document_type = 'reimbursement_payment'
       and v_parent_type <> 'reimbursement_payment')
     or (new.document_type in ('fund_return', 'settlement')
       and v_parent_type <> 'settlement')
     or (new.document_type = 'approval'
       and v_parent_type not in ('ip', 'ir', 'expense'))
     or (new.document_type = 'bank_transfer'
       and v_parent_type not in ('ip', 'ir', 'expense', 'reimbursement_payment'))
  then
    raise exception 'Evidence category % is not valid for parent type %',
      new.document_type, v_parent_type using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.record_ir_ip_replenishment(
  p_ir_record_id uuid,
  p_replenishment_date date,
  p_reference text,
  p_notes text,
  p_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir public.ir_records%rowtype;
  v_personal_amount numeric(18, 2);
  v_ip_amount numeric(18, 2);
  v_path text;
  v_mime_type text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ir
    from public.ir_records
   where id = p_ir_record_id
   for update;
  if not found or v_ir.ptjb_status <> 'approved' or v_ir.status = 'void' then
    raise exception 'Only an approved, non-void IR can return IP funds'
      using errcode = '23514';
  end if;
  if p_replenishment_date is null
     or nullif(trim(coalesce(p_notes, '')), '') is null
     or coalesce(jsonb_typeof(p_evidence), '') <> 'object' then
    raise exception 'Date, confirmation note, and transfer evidence are required'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(allocation.amount) filter (
      where allocation.source_type = 'personal'
    ), 0)::numeric(18, 2),
    coalesce(sum(allocation.amount) filter (
      where allocation.source_type = 'ip'
    ), 0)::numeric(18, 2)
    into v_personal_amount, v_ip_amount
    from public.ir_transactions as transaction
    join public.expenses as expense
      on expense.ir_transaction_id = transaction.id
     and expense.status = 'posted'
    join public.transaction_allocations as allocation
      on allocation.expense_id = expense.id
     and allocation.status = 'active'
   where transaction.ir_record_id = p_ir_record_id
     and transaction.status = 'active';
  if v_personal_amount > 0 or v_ip_amount <= 0 then
    raise exception 'Manual confirmation is only for IRs funded entirely by IP'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.fund_movements
     where related_ir_record_id = p_ir_record_id
       and ir_replenishment
       and not is_void
  ) then
    raise exception 'IP funds for this IR have already been returned'
      using errcode = '23514';
  end if;

  v_path := coalesce(p_evidence ->> 'object_path', '');
  v_mime_type := coalesce(p_evidence ->> 'mime_type', '');
  if split_part(v_path, '/', 1) <> auth.uid()::text
     or split_part(v_path, '/', 2) <> 'ir'
     or split_part(v_path, '/', 3) <> p_ir_record_id::text
     or split_part(v_path, '/', 4) <> 'replenishments'
     or coalesce(p_evidence ->> 'document_type', '') <> 'bank_transfer'
     or v_mime_type not in ('image/jpeg', 'image/png', 'application/pdf')
     or nullif(trim(coalesce(p_evidence ->> 'original_file_name', '')), '') is null
     or nullif(trim(coalesce(p_evidence ->> 'system_file_name', '')), '') is null
     or coalesce((p_evidence ->> 'file_size_bytes')::bigint, 0) <= 0 then
    raise exception 'IP replenishment evidence metadata is invalid'
      using errcode = '22023';
  end if;

  insert into public.evidence_files (
    ir_record_id, object_path, original_file_name, system_file_name,
    document_type, mime_type, file_size_bytes, uploaded_by
  ) values (
    p_ir_record_id, v_path, p_evidence ->> 'original_file_name',
    p_evidence ->> 'system_file_name', 'bank_transfer', v_mime_type,
    (p_evidence ->> 'file_size_bytes')::bigint, auth.uid()
  );

  perform public.sync_ir_ip_replenishments(
    p_ir_record_id, true, p_replenishment_date, p_reference, p_notes
  );
end;
$$;

revoke all on function public.sync_ir_ip_replenishments(uuid, boolean, date, text, text)
  from public, anon, authenticated;
revoke all on function public.sync_ir_ip_replenishment_on_record_change()
  from public, anon, authenticated;
revoke all on function public.record_ir_ip_replenishment(uuid, date, text, text, jsonb)
  from public, anon;
grant execute on function public.record_ir_ip_replenishment(uuid, date, text, text, jsonb)
  to authenticated;

create or replace view public.ip_monitoring
with (security_invoker = true)
as
select
  ip.id,
  ip.reference_code,
  ip.title,
  ip.purpose,
  ip.requested_on,
  ip.requested_amount,
  ip.disbursed_amount,
  ip.disbursement_date,
  ip.status,
  ip.department_area,
  ip.pic_name,
  ip.disbursement_reference,
  ip.recipient_details,
  ip.notes,
  case when ip.disbursement_date is null then null
    else public.calculate_deadline(ip.disbursement_date, 10) end as target_settlement_date,
  case when ip.disbursement_date is null then null
    else public.calculate_deadline(ip.disbursement_date, 14) end as administrative_deadline,
  coalesce(m.valid_realization, 0)::numeric(18, 2) as valid_realization,
  coalesce(m.returned_amount, 0)::numeric(18, 2) as returned_amount,
  (ip.disbursed_amount - coalesce(m.valid_realization, 0) -
    coalesce(m.returned_amount, 0) + coalesce(m.ir_replenished_amount, 0))::numeric(18, 2)
    as unsettled_balance,
  coalesce(d.discrepancy_count, 0)::integer as discrepancy_count,
  ip.project_start_date,
  ip.project_end_date,
  ip.project_location,
  coalesce(m.ir_replenished_amount, 0)::numeric(18, 2) as ir_replenished_amount
from public.ip_records as ip
left join lateral (
  select
    sum(amount) filter (where movement_type = 'expense') as valid_realization,
    sum(amount) filter (where movement_type = 'return') as returned_amount,
    sum(amount) filter (where ir_replenishment and direction = 'inflow')
      as ir_replenished_amount
  from public.fund_movements
  where ip_record_id = ip.id and not is_void
) as m on true
left join lateral (
  select count(*) as discrepancy_count
  from public.expenses
  where ip_record_id = ip.id and status = 'posted'
    and ip_usage_status = 'pending_review'
) as d on true;

revoke all on public.ip_monitoring from public, anon, authenticated;
grant select on public.ip_monitoring to authenticated;

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
    as record_status,
  movement.ir_replenishment
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
  ir.status::text as record_status,
  false as ir_replenishment
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

notify pgrst, 'reload schema';
