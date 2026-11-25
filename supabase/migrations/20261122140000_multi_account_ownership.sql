alter table public.profiles
  add column if not exists national_id text,
  add column if not exists signature_path text;

alter table public.profiles
  drop constraint if exists profiles_national_id_check,
  add constraint profiles_national_id_check
    check (national_id is null or national_id ~ '^[0-9]{16}$');
alter table public.profiles
  drop constraint if exists profiles_signature_path_check,
  add constraint profiles_signature_path_check
    check (
      signature_path is null
      or signature_path like id::text || '/profile/%'
    );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (
      signature_path is null
      or signature_path like (select auth.uid()::text) || '/profile/%'
    )
  );

grant update (display_name, national_id, signature_path) on public.profiles to authenticated;

create or replace function public.is_profile_complete()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = (select auth.uid())
       and nullif(trim(profile.display_name), '') is not null
       and profile.national_id ~ '^[0-9]{16}$'
       and nullif(trim(profile.signature_path), '') is not null
  );
$$;

create or replace function public.owns_ip_record(p_ip_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ip_records as ip
     where ip.id = p_ip_record_id
       and ip.created_by = (select auth.uid())
  );
$$;

create or replace function public.owns_ir_record(p_ir_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ir_records as ir
     where ir.id = p_ir_record_id
       and ir.created_by = (select auth.uid())
  );
$$;

create or replace function public.can_access_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_admin()) or exists (
    select 1
      from public.expenses as expense
      left join public.ip_records as ip
        on ip.id = expense.ip_record_id
      left join public.ir_transactions as transaction
        on transaction.id = expense.ir_transaction_id
      left join public.ir_records as ir
        on ir.id = transaction.ir_record_id
     where expense.id = p_expense_id
       and (
         ip.created_by = (select auth.uid())
         or ir.created_by = (select auth.uid())
         or exists (
           select 1
             from public.transaction_allocations as allocation
             join public.ip_records as allocated_ip
               on allocated_ip.id = allocation.ip_record_id
            where allocation.expense_id = expense.id
              and allocation.status = 'active'
              and allocated_ip.created_by = (select auth.uid())
         )
       )
  );
$$;

create or replace function public.can_manage_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_admin()) or exists (
    select 1
      from public.expenses as expense
      left join public.ip_records as ip
        on ip.id = expense.ip_record_id
      left join public.ir_transactions as transaction
        on transaction.id = expense.ir_transaction_id
      left join public.ir_records as ir
        on ir.id = transaction.ir_record_id
     where expense.id = p_expense_id
       and (
         ip.created_by = (select auth.uid())
         or ir.created_by = (select auth.uid())
       )
  );
$$;

create or replace function public.can_access_evidence(p_evidence_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_admin()) or exists (
    select 1
      from public.evidence_files as evidence
     where evidence.id = p_evidence_file_id
       and (
         (evidence.expense_id is not null
           and public.can_access_expense(evidence.expense_id))
         or (evidence.ip_record_id is not null
           and public.owns_ip_record(evidence.ip_record_id))
         or (evidence.settlement_id is not null and exists (
           select 1 from public.settlements as settlement
           join public.ip_records as ip on ip.id = settlement.ip_record_id
           where settlement.id = evidence.settlement_id
             and ip.created_by = (select auth.uid())
         ))
         or (evidence.reimbursement_payment_id is not null and exists (
           select 1 from public.reimbursement_payments as payment
           join public.ir_records as ir on ir.id = payment.ir_record_id
           where payment.id = evidence.reimbursement_payment_id
             and ir.created_by = (select auth.uid())
         ))
         or (evidence.ir_record_id is not null
           and public.owns_ir_record(evidence.ir_record_id))
         or (evidence.uploaded_by = (select auth.uid())
           and evidence.expense_id is null
           and evidence.ip_record_id is null
           and evidence.settlement_id is null
           and evidence.reimbursement_payment_id is null
           and evidence.ir_record_id is null)
       )
  );
$$;

revoke all on function public.is_profile_complete() from public, anon;
revoke all on function public.owns_ip_record(uuid) from public, anon;
revoke all on function public.owns_ir_record(uuid) from public, anon;
revoke all on function public.can_access_expense(uuid) from public, anon;
revoke all on function public.can_manage_expense(uuid) from public, anon;
revoke all on function public.can_access_evidence(uuid) from public, anon;
grant execute on function public.is_profile_complete() to authenticated;
grant execute on function public.owns_ip_record(uuid) to authenticated;
grant execute on function public.owns_ir_record(uuid) to authenticated;
grant execute on function public.can_access_expense(uuid) to authenticated;
grant execute on function public.can_manage_expense(uuid) to authenticated;
grant execute on function public.can_access_evidence(uuid) to authenticated;

create or replace function public.available_ip_sources_for_ir()
returns table (
  id uuid,
  reference_code text,
  title text,
  unsettled_balance numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select ip.id, ip.reference_code, ip.title, ip.unsettled_balance
    from public.ip_monitoring as ip
   where auth.uid() is not null
     and ip.status in ('disbursed', 'settlement_in_progress')
     and ip.unsettled_balance > 0
   order by ip.disbursement_date desc nulls last;
$$;

revoke all on function public.available_ip_sources_for_ir() from public, anon;
grant execute on function public.available_ip_sources_for_ir() to authenticated;

create or replace function public.create_ip_application(
  p_title text,
  p_purpose text,
  p_requested_on date,
  p_department_area text,
  p_pic_name text,
  p_notes text,
  p_budget_items jsonb,
  p_project_start_date date,
  p_project_end_date date,
  p_project_location text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_id uuid := gen_random_uuid();
  v_item jsonb;
  v_quantity numeric;
  v_unit_cost numeric;
  v_total numeric(18, 2) := 0;
  v_reference text;
  v_applicant_name text;
begin
  if auth.uid() is null or not public.is_profile_complete() then
    raise exception 'Complete your profile before submitting a request'
      using errcode = '42501';
  end if;
  select display_name into v_applicant_name
    from public.profiles where id = auth.uid();
  if nullif(trim(p_title), '') is null
     or nullif(trim(p_purpose), '') is null
     or p_requested_on is null
     or (p_project_start_date is not null and p_project_end_date is not null
         and p_project_end_date < p_project_start_date)
     or coalesce(jsonb_typeof(p_budget_items), '') <> 'array'
     or coalesce(jsonb_array_length(p_budget_items), 0) = 0 then
    raise exception 'Required IP details, valid project dates, and at least one budget item are required'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_budget_items)
  loop
    v_quantity := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1);
    v_unit_cost := coalesce(
      nullif(v_item ->> 'unit_cost', '')::numeric,
      nullif(v_item ->> 'requested_amount', '')::numeric
    );
    if nullif(trim(v_item ->> 'description'), '') is null
       or v_quantity <= 0
       or v_unit_cost is null
       or v_unit_cost <= 0
       or v_quantity <> round(v_quantity, 2)
       or v_unit_cost <> round(v_unit_cost, 2)
       or not exists (
         select 1 from public.categories
          where id = (v_item ->> 'category_id')::uuid and is_active
       ) then
      raise exception 'Every budget item needs an active category, description, and positive quantity and unit cost with at most two decimals'
        using errcode = '23514';
    end if;
    v_total := v_total + round(v_quantity * v_unit_cost, 2);
  end loop;

  v_reference := 'IP-' || to_char(p_requested_on, 'YYYY') || '-' ||
    lpad(nextval('public.ip_reference_seq')::text, 6, '0');
  insert into public.ip_records (
    id, reference_code, title, purpose, requested_on, requested_amount,
    status, department_area, pic_name, notes, created_by,
    project_start_date, project_end_date, project_location
  ) values (
    v_ip_id, v_reference, trim(p_title), trim(p_purpose), p_requested_on,
    v_total, 'draft', nullif(trim(p_department_area), ''),
    v_applicant_name, nullif(trim(p_notes), ''), auth.uid(),
    p_project_start_date, p_project_end_date, nullif(trim(p_project_location), '')
  );

  for v_item in select value from jsonb_array_elements(p_budget_items)
  loop
    v_quantity := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1);
    v_unit_cost := coalesce(
      nullif(v_item ->> 'unit_cost', '')::numeric,
      nullif(v_item ->> 'requested_amount', '')::numeric
    );
    insert into public.ip_budget_items (
      ip_record_id, category_id, description, quantity, unit_cost,
      requested_amount, notes
    ) values (
      v_ip_id, (v_item ->> 'category_id')::uuid,
      trim(v_item ->> 'description'), v_quantity, v_unit_cost,
      round(v_quantity * v_unit_cost, 2), nullif(trim(v_item ->> 'notes'), '')
    );
  end loop;

  update public.ip_records set status = 'submitted' where id = v_ip_id;
  return v_ip_id;
end;
$$;

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
  v_applicant_name text;
begin
  if auth.uid() is null or not public.is_profile_complete() then
    raise exception 'Complete your profile before submitting a request'
      using errcode = '42501';
  end if;
  select display_name into v_applicant_name
    from public.profiles where id = auth.uid();
  if p_ir_type not in ('operasional', 'facility')
     or p_submitted_on is null
     or nullif(trim(p_purpose), '') is null
     or nullif(trim(p_title), '') is null
     or (p_period_start is not null and p_period_end is not null
         and p_period_end < p_period_start) then
    raise exception 'IR type, date, purpose, description, and valid period are required'
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
    trim(p_purpose), v_applicant_name, p_period_start, p_period_end,
    nullif(trim(p_notes), ''), 'draft', 'not_submitted', 'unpaid', auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.record_ip_expense(
  p_ip_record_id uuid,
  p_expense_date date,
  p_budget_item_id uuid,
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_payment_method text,
  p_is_consistent boolean,
  p_mismatch_reason text,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip public.ip_records%rowtype;
  v_item public.ip_budget_items%rowtype;
  v_expense_id uuid := gen_random_uuid();
  v_evidence jsonb;
begin
  if auth.uid() is null or not public.is_profile_complete()
     or (not public.is_admin() and not public.owns_ip_record(p_ip_record_id)) then
    raise exception 'You cannot add realizations to this IP'
      using errcode = '42501';
  end if;
  select * into v_ip from public.ip_records
   where id = p_ip_record_id for update;
  if not found or v_ip.status not in ('disbursed', 'settlement_in_progress') then
    raise exception 'Only an active, disbursed IP can have realizations'
      using errcode = '23514';
  end if;
  select * into v_item from public.ip_budget_items
   where id = p_budget_item_id
     and ip_record_id = p_ip_record_id
     and status = 'active';
  if not found then
    raise exception 'Select an active budget item from this IP'
      using errcode = '23514';
  end if;
  if p_expense_date is null or nullif(trim(p_description), '') is null
     or p_amount is null or p_amount <= 0
     or p_payment_method is null
     or p_payment_method not in ('cash', 'transfer', 'card', 'other')
     or p_is_consistent is null
     or coalesce(jsonb_typeof(p_evidence), '') <> 'array'
     or coalesce(jsonb_array_length(p_evidence), 0) = 0 then
    raise exception 'Date, description, positive amount, payment method, and receipt evidence are required'
      using errcode = '22023';
  end if;
  if not p_is_consistent and nullif(trim(p_mismatch_reason), '') is null then
    raise exception 'A reason is required for a realization that does not match the request'
      using errcode = '22023';
  end if;

  insert into public.expenses (
    id, ip_record_id, ip_budget_item_id, category_id, expense_date,
    description, vendor, amount, payment_method, ip_usage_status,
    ip_mismatch_reason, created_by
  ) values (
    v_expense_id, p_ip_record_id, p_budget_item_id, v_item.category_id,
    p_expense_date, trim(p_description), nullif(trim(p_vendor), ''),
    p_amount, p_payment_method,
    case when p_is_consistent then 'verified' else 'pending_review' end,
    case when p_is_consistent then null else trim(p_mismatch_reason) end,
    auth.uid()
  );
  insert into public.transaction_allocations (
    expense_id, source_type, ip_record_id, amount, notes
  ) values (
    v_expense_id, 'ip', p_ip_record_id, p_amount,
    case when p_is_consistent then null else 'Belum diverifikasi: penggunaan berbeda dari pengajuan' end
  );
  for v_evidence in select value from jsonb_array_elements(p_evidence)
  loop
    if split_part(coalesce(v_evidence ->> 'object_path', ''), '/', 1) <> auth.uid()::text
       or split_part(coalesce(v_evidence ->> 'object_path', ''), '/', 2) = 'profile' then
      raise exception 'Evidence must use a storage path owned by the current user'
        using errcode = '42501';
    end if;
    insert into public.evidence_files (
      expense_id, object_path, original_file_name, system_file_name,
      document_type, mime_type, file_size_bytes, uploaded_by
    ) values (
      v_expense_id, v_evidence ->> 'object_path',
      v_evidence ->> 'original_file_name', v_evidence ->> 'system_file_name',
      v_evidence ->> 'document_type', v_evidence ->> 'mime_type',
      (v_evidence ->> 'file_size_bytes')::bigint, auth.uid()
    );
  end loop;
  return v_expense_id;
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
  v_source record;
  v_available numeric(18, 2);
  v_source_status text;
begin
  if auth.uid() is null or not public.is_profile_complete()
     or (not public.is_admin() and not public.owns_ir_record(p_ir_record_id)) then
    raise exception 'You cannot add transactions to this IR'
      using errcode = '42501';
  end if;
  select * into v_ir from public.ir_records
   where id = p_ir_record_id for update;
  if not found or v_ir.status in ('completed', 'void')
     or v_ir.ptjb_status in ('submitted', 'approved') then
    raise exception 'Transactions can only be added to an open IR before PTJB submission'
      using errcode = '23514';
  end if;
  select scope into v_category_scope
    from public.categories where id = p_category_id and is_active;
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

  for v_source in
    select (entry.value ->> 'ip_record_id')::uuid as ip_id,
           sum((entry.value ->> 'amount')::numeric) as requested_amount
      from jsonb_array_elements(p_allocations) as entry(value)
     where entry.value ->> 'source_type' = 'ip'
     group by (entry.value ->> 'ip_record_id')::uuid
     order by (entry.value ->> 'ip_record_id')::uuid
  loop
    perform 1 from public.ip_records where id = v_source.ip_id for update;
    select unsettled_balance, status into v_available, v_source_status
      from public.ip_monitoring where id = v_source.ip_id;
    if v_source_status not in ('disbursed', 'settlement_in_progress')
       or v_available is null
       or v_available < v_source.requested_amount then
      raise exception 'IP source % does not have enough available balance',
        v_source.ip_id using errcode = '23514';
    end if;
  end loop;

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
    if split_part(coalesce(v_file ->> 'object_path', ''), '/', 1) <> auth.uid()::text
       or split_part(coalesce(v_file ->> 'object_path', ''), '/', 2) = 'profile' then
      raise exception 'Evidence must use a storage path owned by the current user'
        using errcode = '42501';
    end if;
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
  update public.ir_records set ptjb_status = 'in_progress' where id = p_ir_record_id;
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
  if auth.uid() is null
     or (not public.is_admin() and not public.owns_ir_record(p_ir_record_id)) then
    raise exception 'You cannot change PTJB status for this IR'
      using errcode = '42501';
  end if;
  if p_next_status = 'approved' and (
    not public.is_admin()
    or exists (
      select 1 from public.ir_records
       where id = p_ir_record_id and created_by = auth.uid()
    )
  ) then
    raise exception 'Only an administrator other than the applicant can approve PTJB'
      using errcode = '42501';
  end if;
  select * into v_ir from public.ir_records
   where id = p_ir_record_id for update;
  if not found or p_next_status not in ('submitted', 'approved') then
    raise exception 'Invalid IR or PTJB status' using errcode = '22023';
  end if;
  if p_next_status = 'submitted' then
    if not public.is_profile_complete()
       or v_ir.status in ('completed', 'void')
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

drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy categories_authenticated_read on public.categories
  for select to authenticated using (true);

drop policy if exists holidays_admin_all on public.holidays;
create policy holidays_admin_all on public.holidays
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy holidays_authenticated_read on public.holidays
  for select to authenticated using (true);

drop policy if exists system_settings_ip_template_read on public.system_settings;
create policy system_settings_ip_template_read on public.system_settings
  for select to authenticated
  using (key = 'ip_application_form');

drop policy if exists ip_records_admin_all on public.ip_records;
create policy ip_records_admin_all on public.ip_records
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy ip_records_owner_read on public.ip_records
  for select to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists ip_budget_items_admin_all on public.ip_budget_items;
create policy ip_budget_items_admin_all on public.ip_budget_items
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy ip_budget_items_owner_read on public.ip_budget_items
  for select to authenticated
  using (public.owns_ip_record(ip_record_id));

drop policy if exists ir_records_admin_all on public.ir_records;
create policy ir_records_admin_all on public.ir_records
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy ir_records_owner_read on public.ir_records
  for select to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists ir_transactions_admin_all on public.ir_transactions;
create policy ir_transactions_admin_all on public.ir_transactions
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy ir_transactions_owner_read on public.ir_transactions
  for select to authenticated
  using (public.owns_ir_record(ir_record_id));

drop policy if exists expenses_admin_all on public.expenses;
create policy expenses_admin_all on public.expenses
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy expenses_owner_read on public.expenses
  for select to authenticated
  using (public.can_access_expense(id));

drop policy if exists transaction_allocations_admin_all on public.transaction_allocations;
create policy transaction_allocations_admin_all on public.transaction_allocations
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy transaction_allocations_owner_read on public.transaction_allocations
  for select to authenticated
  using (public.can_access_expense(expense_id));

drop policy if exists settlements_admin_all on public.settlements;
create policy settlements_admin_all on public.settlements
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy settlements_owner_read on public.settlements
  for select to authenticated
  using (public.owns_ip_record(ip_record_id));

drop policy if exists reimbursement_payments_admin_all on public.reimbursement_payments;
create policy reimbursement_payments_admin_all on public.reimbursement_payments
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy reimbursement_payments_owner_read on public.reimbursement_payments
  for select to authenticated
  using (public.owns_ir_record(ir_record_id));

drop policy if exists evidence_files_admin_all on public.evidence_files;
create policy evidence_files_admin_all on public.evidence_files
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy evidence_files_owner_read on public.evidence_files
  for select to authenticated
  using (public.can_access_evidence(id));
create policy evidence_files_owner_insert on public.evidence_files
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (storage.foldername(object_path))[1] = (select auth.uid()::text)
    and (storage.foldername(object_path))[2] <> 'profile'
    and (
      (expense_id is not null and public.can_manage_expense(expense_id))
      or (ip_record_id is not null and public.owns_ip_record(ip_record_id))
      or (settlement_id is not null and exists (
        select 1 from public.settlements as settlement
        where settlement.id = settlement_id
          and public.owns_ip_record(settlement.ip_record_id)
      ))
      or (reimbursement_payment_id is not null and exists (
        select 1 from public.reimbursement_payments as payment
        where payment.id = reimbursement_payment_id
          and public.owns_ir_record(payment.ir_record_id)
      ))
      or (ir_record_id is not null and public.owns_ir_record(ir_record_id))
      or num_nonnulls(expense_id, ip_record_id, settlement_id,
        reimbursement_payment_id, ir_record_id) = 0
    )
  );

drop policy if exists fund_movements_admin_all on public.fund_movements;
create policy fund_movements_admin_all on public.fund_movements
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy fund_movements_owner_read on public.fund_movements
  for select to authenticated
  using (
    (ip_record_id is not null and public.owns_ip_record(ip_record_id))
    or (allocation_id is not null and exists (
      select 1 from public.transaction_allocations as allocation
      where allocation.id = allocation_id
        and public.can_access_expense(allocation.expense_id)
    ))
  );

drop policy if exists monthly_closings_admin_all on public.monthly_closings;
create policy monthly_closings_admin_all on public.monthly_closings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists faams_evidence_admin_read on storage.objects;
drop policy if exists faams_evidence_admin_upload on storage.objects;
create policy faams_evidence_authenticated_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'faams-evidence'
    and (
      (select public.is_admin())
      or (storage.foldername(name))[1] = (select auth.uid()::text)
      or exists (
        select 1
          from public.evidence_files as evidence
         where evidence.storage_bucket = bucket_id
           and evidence.object_path = name
           and public.can_access_evidence(evidence.id)
      )
      or exists (
        select 1
          from public.system_settings as setting
         where setting.key = 'ip_application_form'
           and name in (
             setting.value ->> 'logo_path',
             setting.value ->> 'approver_signature_path'
           )
      )
    )
  );
create policy faams_evidence_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'faams-evidence'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
create policy faams_evidence_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'faams-evidence'
    and (
      (select public.is_admin())
      or (
        (storage.foldername(name))[1] = (select auth.uid()::text)
        and not exists (
          select 1 from public.profiles as profile
           where profile.id = (select auth.uid())
             and profile.signature_path = name
        )
        and not exists (
          select 1 from public.evidence_files as evidence
           where evidence.storage_bucket = bucket_id
             and evidence.object_path = name
        )
      )
    )
  );
