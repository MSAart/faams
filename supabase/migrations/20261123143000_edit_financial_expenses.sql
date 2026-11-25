create or replace function public.edit_ir_transaction_expense(
  p_expense_id uuid,
  p_transaction_date date,
  p_category_id uuid,
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_payment_method text,
  p_allocations jsonb,
  p_evidence jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_ir public.ir_records%rowtype;
  v_category_scope text;
  v_allocation jsonb;
  v_file jsonb;
  v_allocation_total numeric(18, 2) := 0;
  v_path text;
  v_mime_type text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select expense.* into v_expense
    from public.expenses as expense
    join public.ir_transactions as transaction
      on transaction.id = expense.ir_transaction_id
   where expense.id = p_expense_id
     and expense.status = 'posted'
     and transaction.status = 'active'
   for update of expense;
  if not found then
    raise exception 'Only an active, posted IR transaction can be edited'
      using errcode = '23514';
  end if;
  select ir.* into v_ir
    from public.ir_records as ir
    join public.ir_transactions as transaction
      on transaction.ir_record_id = ir.id
   where transaction.id = v_expense.ir_transaction_id
   for update of ir;
  if not found or v_ir.status in ('completed', 'void')
     or v_ir.ptjb_status in ('submitted', 'approved') then
    raise exception 'IR transactions can only be edited before PTJB submission'
      using errcode = '23514';
  end if;

  select scope into v_category_scope
    from public.categories
   where id = p_category_id and is_active;
  if not found or v_category_scope <> v_ir.ir_type then
    raise exception 'Choose an active category matching this IR type'
      using errcode = '23514';
  end if;
  if p_transaction_date is null or nullif(trim(coalesce(p_description, '')), '') is null
     or p_amount is null or p_amount <= 0
     or coalesce(p_payment_method, '') not in ('cash', 'transfer', 'card', 'other')
     or coalesce(jsonb_typeof(p_allocations), '') <> 'array'
     or jsonb_array_length(p_allocations) = 0
     or coalesce(jsonb_typeof(p_evidence), '') <> 'array' then
    raise exception 'Date, description, positive amount, payment method, allocations, and evidence list are required'
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

  update public.transaction_allocations
     set status = 'void',
         void_reason = 'Allocation replaced by an audited IR transaction edit'
   where expense_id = p_expense_id
     and status = 'active';

  update public.expenses
     set expense_date = p_transaction_date,
         category_id = p_category_id,
         description = trim(p_description),
         vendor = nullif(trim(coalesce(p_vendor, '')), ''),
         amount = p_amount,
         payment_method = p_payment_method
   where id = p_expense_id;

  for v_allocation in select value from jsonb_array_elements(p_allocations)
  loop
    insert into public.transaction_allocations (
      expense_id, source_type, ip_record_id, personal_profile_id, amount, status
    ) values (
      p_expense_id,
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
    v_path := coalesce(v_file ->> 'object_path', '');
    v_mime_type := coalesce(v_file ->> 'mime_type', '');
    if split_part(v_path, '/', 1) <> auth.uid()::text
       or split_part(v_path, '/', 2) <> 'ir'
       or split_part(v_path, '/', 3) <> v_ir.id::text
       or split_part(v_path, '/', 4) <> 'transactions'
       or coalesce(v_file ->> 'document_type', '') not in ('receipt', 'invoice', 'bank_transfer', 'other')
       or v_mime_type not in ('image/jpeg', 'image/png', 'application/pdf')
       or nullif(trim(coalesce(v_file ->> 'original_file_name', '')), '') is null
       or nullif(trim(coalesce(v_file ->> 'system_file_name', '')), '') is null
       or coalesce((v_file ->> 'file_size_bytes')::bigint, 0) <= 0 then
      raise exception 'IR evidence metadata is invalid'
        using errcode = '22023';
    end if;
    insert into public.evidence_files (
      expense_id, object_path, original_file_name, system_file_name,
      document_type, mime_type, file_size_bytes, uploaded_by
    ) values (
      p_expense_id, v_path, v_file ->> 'original_file_name',
      v_file ->> 'system_file_name', v_file ->> 'document_type',
      v_mime_type, (v_file ->> 'file_size_bytes')::bigint, auth.uid()
    );
  end loop;
end;
$$;

create or replace function public.edit_ip_realization(
  p_ip_record_id uuid,
  p_expense_id uuid,
  p_expense_date date,
  p_budget_item_id uuid,
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_payment_method text,
  p_evidence jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip public.ip_records%rowtype;
  v_expense public.expenses%rowtype;
  v_allocation public.transaction_allocations%rowtype;
  v_category_id uuid;
  v_file jsonb;
  v_path text;
  v_mime_type text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ip
    from public.ip_records
   where id = p_ip_record_id
   for update;
  if not found or v_ip.status not in ('disbursed', 'settlement_in_progress') then
    raise exception 'Only an active, disbursed IP realization can be edited'
      using errcode = '23514';
  end if;
  select * into v_expense
    from public.expenses
   where id = p_expense_id
     and ip_record_id = p_ip_record_id
     and ir_transaction_id is null
     and status = 'posted'
     and related_ir_record_id is null
     and ip_usage_status <> 'linked_ir'
   for update;
  if not found then
    raise exception 'Only a direct, posted IP realization can be edited'
      using errcode = '23514';
  end if;
  if p_expense_date is null or nullif(trim(coalesce(p_description, '')), '') is null
     or p_amount is null or p_amount <= 0
     or coalesce(p_payment_method, '') not in ('cash', 'transfer', 'card', 'other')
     or coalesce(jsonb_typeof(p_evidence), '') <> 'array' then
    raise exception 'Date, description, positive amount, payment method, and evidence list are required'
      using errcode = '22023';
  end if;
  select category_id into v_category_id
    from public.ip_budget_items
   where id = p_budget_item_id
     and ip_record_id = p_ip_record_id
     and status = 'active';
  if not found then
    raise exception 'Select an active budget item from this IP'
      using errcode = '23514';
  end if;
  select * into v_allocation
    from public.transaction_allocations
   where expense_id = p_expense_id
     and source_type = 'ip'
     and ip_record_id = p_ip_record_id
     and status = 'active'
   for update;
  if not found then
    raise exception 'The IP realization has no active allocation to its source IP'
      using errcode = '23514';
  end if;

  update public.transaction_allocations
     set status = 'void',
         void_reason = 'Allocation replaced by an audited IP realization edit'
   where id = v_allocation.id;
  update public.expenses
     set expense_date = p_expense_date,
         ip_budget_item_id = p_budget_item_id,
         category_id = v_category_id,
         description = trim(p_description),
         vendor = nullif(trim(coalesce(p_vendor, '')), ''),
         amount = p_amount,
         payment_method = p_payment_method
   where id = p_expense_id;
  insert into public.transaction_allocations (
    expense_id, source_type, ip_record_id, personal_profile_id, amount, status
  ) values (
    p_expense_id, 'ip', p_ip_record_id, null, p_amount, 'active'
  );

  for v_file in select value from jsonb_array_elements(p_evidence)
  loop
    v_path := coalesce(v_file ->> 'object_path', '');
    v_mime_type := coalesce(v_file ->> 'mime_type', '');
    if split_part(v_path, '/', 1) <> auth.uid()::text
       or split_part(v_path, '/', 2) <> 'ip'
       or split_part(v_path, '/', 3) <> p_ip_record_id::text
       or split_part(v_path, '/', 4) <> 'expenses'
       or coalesce(v_file ->> 'document_type', '') not in ('receipt', 'invoice', 'bank_transfer', 'other', 'transfer_proof', 'other_supporting_document')
       or v_mime_type not in ('image/jpeg', 'image/png', 'application/pdf')
       or nullif(trim(coalesce(v_file ->> 'original_file_name', '')), '') is null
       or nullif(trim(coalesce(v_file ->> 'system_file_name', '')), '') is null
       or coalesce((v_file ->> 'file_size_bytes')::bigint, 0) <= 0 then
      raise exception 'IP evidence metadata is invalid'
        using errcode = '22023';
    end if;
    insert into public.evidence_files (
      expense_id, object_path, original_file_name, system_file_name,
      document_type, mime_type, file_size_bytes, uploaded_by
    ) values (
      p_expense_id, v_path, v_file ->> 'original_file_name',
      v_file ->> 'system_file_name', v_file ->> 'document_type',
      v_mime_type, (v_file ->> 'file_size_bytes')::bigint, auth.uid()
    );
  end loop;
end;
$$;

revoke all on function public.edit_ir_transaction_expense(uuid, date, uuid, text, text, numeric, text, jsonb, jsonb)
  from public, anon;
revoke all on function public.edit_ip_realization(uuid, uuid, date, uuid, text, text, numeric, text, jsonb)
  from public, anon;
grant execute on function public.edit_ir_transaction_expense(uuid, date, uuid, text, text, numeric, text, jsonb, jsonb)
  to authenticated;
grant execute on function public.edit_ip_realization(uuid, uuid, date, uuid, text, text, numeric, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
