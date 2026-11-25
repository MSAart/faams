create sequence if not exists public.ip_reference_seq;

alter table public.ip_records
  add column if not exists department_area text,
  add column if not exists pic_name text,
  add column if not exists disbursement_reference text,
  add column if not exists recipient_details text,
  add column if not exists disbursement_notes text;

alter table public.expenses
  add column if not exists ip_budget_item_id uuid
    references public.ip_budget_items (id) on delete restrict,
  add column if not exists vendor text,
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('cash', 'transfer', 'card', 'other')),
  add column if not exists ip_usage_status text not null default 'verified'
    check (ip_usage_status in ('verified', 'pending_review', 'linked_ir')),
  add column if not exists ip_mismatch_reason text,
  add column if not exists ip_resolution_note text,
  add column if not exists related_ir_record_id uuid
    references public.ir_records (id) on delete restrict;

alter table public.settlements
  add column if not exists return_method text
    check (return_method is null or return_method in ('cash', 'transfer', 'other')),
  add column if not exists reference_code text;

alter table public.evidence_files
  alter column expense_id drop not null;

alter table public.evidence_files
  add column if not exists ip_record_id uuid
    references public.ip_records (id) on delete restrict,
  add column if not exists settlement_id uuid
    references public.settlements (id) on delete restrict;

alter table public.evidence_files
  drop constraint if exists evidence_files_document_type_check;
alter table public.evidence_files
  add constraint evidence_files_document_type_check
  check (document_type in (
    'receipt', 'invoice', 'approval', 'settlement', 'bank_transfer',
    'fund_return', 'other'
  ));
alter table public.evidence_files
  drop constraint if exists evidence_files_parent_check;
alter table public.evidence_files
  add constraint evidence_files_parent_check
  check (num_nonnulls(expense_id, ip_record_id, settlement_id) = 1);

create index if not exists expenses_ip_usage_status_idx
  on public.expenses (ip_record_id, ip_usage_status, expense_date desc)
  where ip_record_id is not null;
create index if not exists evidence_ip_status_idx
  on public.evidence_files (ip_record_id, status)
  where ip_record_id is not null;

create or replace function public.validate_ip_expense_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scope text;
begin
  if new.ip_record_id is null then
    if new.ip_budget_item_id is not null
       or new.ip_usage_status <> 'verified'
       or new.related_ir_record_id is not null then
      raise exception 'IP usage fields require a direct IP expense'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.ip_budget_item_id is null or not exists (
    select 1 from public.ip_budget_items
     where id = new.ip_budget_item_id
       and ip_record_id = new.ip_record_id
       and category_id = new.category_id
  ) then
    raise exception 'Select a budget item in this IP with the matching category'
      using errcode = '23514';
  end if;
  if new.ip_usage_status = 'pending_review'
     and nullif(trim(new.ip_mismatch_reason), '') is null then
    raise exception 'Unverified IP usage requires a discrepancy reason'
      using errcode = '23514';
  end if;
  if new.ip_usage_status = 'linked_ir'
     and new.related_ir_record_id is null then
    raise exception 'An IR follow-up must be linked before the discrepancy is resolved'
      using errcode = '23514';
  end if;
  if new.ip_usage_status = 'verified' and tg_op = 'UPDATE'
     and old.ip_usage_status = 'pending_review'
     and nullif(trim(new.ip_resolution_note), '') is null then
    raise exception 'Verifying a discrepancy requires a resolution note'
      using errcode = '23514';
  end if;
  if new.ip_usage_status = 'linked_ir' and new.related_ir_record_id is not null then
    select scope into v_scope from public.categories where id = new.category_id;
    if not exists (
      select 1 from public.ir_records
       where id = new.related_ir_record_id
         and ir_type = v_scope
         and status <> 'void'
    ) then
      raise exception 'The linked IR must be active and match the expense category'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_validate_ip_usage on public.expenses;
create trigger expenses_validate_ip_usage
  before insert or update of ip_record_id, ip_budget_item_id, category_id,
    ip_usage_status, ip_mismatch_reason, ip_resolution_note, related_ir_record_id
  on public.expenses
  for each row execute procedure public.validate_ip_expense_usage();

create or replace function public.validate_ip_disbursement_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.disbursement_date is not null
     and (
       new.disbursement_date is distinct from old.disbursement_date
       or new.disbursed_amount is distinct from old.disbursed_amount
       or new.disbursement_reference is distinct from old.disbursement_reference
     ) then
    raise exception 'An IP disbursement cannot be changed or repeated'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ip_records_disbursement_once on public.ip_records;
create trigger ip_records_disbursement_once
  before update on public.ip_records
  for each row execute procedure public.validate_ip_disbursement_once();

create or replace function public.create_ip_application(
  p_title text,
  p_purpose text,
  p_requested_on date,
  p_department_area text,
  p_pic_name text,
  p_notes text,
  p_budget_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_id uuid := gen_random_uuid();
  v_item jsonb;
  v_total numeric(18, 2) := 0;
  v_reference text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if nullif(trim(p_title), '') is null
     or nullif(trim(p_purpose), '') is null
     or p_requested_on is null
     or coalesce(jsonb_typeof(p_budget_items), '') <> 'array'
     or coalesce(jsonb_array_length(p_budget_items), 0) = 0 then
    raise exception 'Required IP details and at least one budget item are required'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_budget_items)
  loop
    if nullif(trim(v_item ->> 'description'), '') is null
       or coalesce((v_item ->> 'requested_amount')::numeric, 0) <= 0
       or not exists (
         select 1 from public.categories
          where id = (v_item ->> 'category_id')::uuid and is_active
       ) then
      raise exception 'Every budget item needs an active category, description, and positive amount'
        using errcode = '23514';
    end if;
    v_total := v_total + (v_item ->> 'requested_amount')::numeric;
  end loop;

  v_reference := 'IP-' || to_char(p_requested_on, 'YYYY') || '-' ||
    lpad(nextval('public.ip_reference_seq')::text, 6, '0');
  insert into public.ip_records (
    id, reference_code, title, purpose, requested_on, requested_amount,
    status, department_area, pic_name, notes, created_by
  ) values (
    v_ip_id, v_reference, trim(p_title), trim(p_purpose), p_requested_on,
    v_total, 'draft', nullif(trim(p_department_area), ''),
    nullif(trim(p_pic_name), ''), nullif(trim(p_notes), ''), auth.uid()
  );

  for v_item in select value from jsonb_array_elements(p_budget_items)
  loop
    insert into public.ip_budget_items (
      ip_record_id, category_id, description, requested_amount, notes
    ) values (
      v_ip_id, (v_item ->> 'category_id')::uuid,
      trim(v_item ->> 'description'), (v_item ->> 'requested_amount')::numeric,
      nullif(trim(v_item ->> 'notes'), '')
    );
  end loop;

  update public.ip_records set status = 'submitted' where id = v_ip_id;
  return v_ip_id;
end;
$$;

create or replace function public.record_ip_disbursement(
  p_ip_record_id uuid,
  p_disbursement_date date,
  p_amount numeric,
  p_reference text,
  p_recipient_details text,
  p_notes text,
  p_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip public.ip_records%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ip from public.ip_records
   where id = p_ip_record_id for update;
  if not found or v_ip.status not in ('submitted', 'approved') then
    raise exception 'Only a submitted or approved IP can be disbursed'
      using errcode = '23514';
  end if;
  if v_ip.disbursement_date is not null or v_ip.disbursed_amount <> 0 then
    raise exception 'An IP can only have one disbursement'
      using errcode = '23514';
  end if;
  if p_disbursement_date is null or p_amount is null or p_amount <= 0
     or p_evidence is null or coalesce(jsonb_typeof(p_evidence), '') <> 'object' then
    raise exception 'Disbursement date, positive amount, and transfer evidence are required'
      using errcode = '22023';
  end if;

  update public.ip_records
     set disbursement_date = p_disbursement_date,
         disbursed_amount = p_amount,
         disbursement_reference = nullif(trim(p_reference), ''),
         recipient_details = nullif(trim(p_recipient_details), ''),
         disbursement_notes = nullif(trim(p_notes), ''),
         status = 'disbursed'
   where id = p_ip_record_id;

  insert into public.evidence_files (
    ip_record_id, object_path, original_file_name, system_file_name,
    document_type, mime_type, file_size_bytes, uploaded_by
  ) values (
    p_ip_record_id, p_evidence ->> 'object_path',
    p_evidence ->> 'original_file_name', p_evidence ->> 'system_file_name',
    'bank_transfer', p_evidence ->> 'mime_type',
    (p_evidence ->> 'file_size_bytes')::bigint, auth.uid()
  );
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
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
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

create or replace function public.resolve_ip_discrepancy(
  p_expense_id uuid,
  p_action text,
  p_resolution_note text,
  p_ir_record_id uuid default null,
  p_ir_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_ip public.ip_records%rowtype;
  v_ir_id uuid := p_ir_record_id;
  v_category_scope text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if nullif(trim(p_resolution_note), '') is null
     or p_action not in ('verify', 'link_ir', 'create_ir') then
    raise exception 'Choose a follow-up action and provide its reason'
      using errcode = '22023';
  end if;

  select * into v_expense from public.expenses
   where id = p_expense_id for update;
  if not found or v_expense.ip_record_id is null
     or v_expense.ip_usage_status <> 'pending_review' then
    raise exception 'Only an unresolved IP discrepancy can be followed up'
      using errcode = '23514';
  end if;
  select * into v_ip from public.ip_records
   where id = v_expense.ip_record_id for update;

  if p_action = 'verify' then
    update public.expenses
       set ip_usage_status = 'verified',
           ip_resolution_note = trim(p_resolution_note)
     where id = p_expense_id;
    return null;
  end if;

  select scope into v_category_scope
    from public.categories where id = v_expense.category_id;
  if p_action = 'create_ir' then
    if p_ir_type not in ('operasional', 'facility')
       or p_ir_type <> v_category_scope then
      raise exception 'The new IR type must match the expense category'
        using errcode = '23514';
    end if;
    insert into public.ir_records (
      reference_code, ir_type, title, notes, created_by
    ) values (
      'IR-' || to_char(current_date, 'YYYY') || '-' ||
        upper(substr(gen_random_uuid()::text, 1, 8)),
      p_ir_type, left(v_expense.description, 200),
      'Dibuat dari tindak lanjut selisih ' || v_ip.reference_code ||
        ': ' || trim(p_resolution_note),
      auth.uid()
    ) returning id into v_ir_id;
  else
    perform 1 from public.ir_records
     where id = v_ir_id and ir_type = v_category_scope and status <> 'void';
    if not found then
      raise exception 'Select an active IR matching the expense category'
        using errcode = '23514';
    end if;
  end if;

  update public.expenses
     set ip_usage_status = 'linked_ir',
         ip_resolution_note = trim(p_resolution_note),
         related_ir_record_id = v_ir_id
   where id = p_expense_id;
  return v_ir_id;
end;
$$;

create or replace function public.record_ip_return(
  p_ip_record_id uuid,
  p_return_date date,
  p_amount numeric,
  p_return_method text,
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
  v_ip public.ip_records%rowtype;
  v_settlement_id uuid := gen_random_uuid();
  v_balance numeric(18, 2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ip from public.ip_records
   where id = p_ip_record_id for update;
  if not found or v_ip.status not in ('disbursed', 'settlement_in_progress') then
    raise exception 'Returns can only be recorded for an active, disbursed IP'
      using errcode = '23514';
  end if;
  if p_return_date is null or p_amount is null or p_amount <= 0
     or p_return_method is null
     or p_return_method not in ('cash', 'transfer', 'other')
     or p_evidence is null
     or coalesce(jsonb_typeof(p_evidence), '') <> 'object' then
    raise exception 'Return date, positive amount, method, and evidence are required'
      using errcode = '22023';
  end if;
  select coalesce(sum(
    case when direction = 'inflow' then amount else -amount end
  ), 0)
    into v_balance
    from public.fund_movements
   where ip_record_id = p_ip_record_id and not is_void;
  if p_amount > v_balance then
    raise exception 'Return amount (%) exceeds the available IP balance (%)',
      p_amount, v_balance using errcode = '23514';
  end if;

  insert into public.settlements (
    id, ip_record_id, settlement_date, amount_returned, status,
    return_method, reference_code, notes, created_by
  ) values (
    v_settlement_id, p_ip_record_id, p_return_date, p_amount, 'reviewed',
    p_return_method, nullif(trim(p_reference), ''),
    nullif(trim(p_notes), ''), auth.uid()
  );
  insert into public.evidence_files (
    settlement_id, object_path, original_file_name, system_file_name,
    document_type, mime_type, file_size_bytes, uploaded_by
  ) values (
    v_settlement_id, p_evidence ->> 'object_path',
    p_evidence ->> 'original_file_name', p_evidence ->> 'system_file_name',
    'fund_return', p_evidence ->> 'mime_type',
    (p_evidence ->> 'file_size_bytes')::bigint, auth.uid()
  );
  update public.ip_records set status = 'settlement_in_progress'
   where id = p_ip_record_id and status = 'disbursed';
  return v_settlement_id;
end;
$$;

create or replace function public.close_ip_settlement(
  p_ip_record_id uuid,
  p_settlement_date date,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip public.ip_records%rowtype;
  v_balance numeric(18, 2);
  v_spent numeric(18, 2);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_ip from public.ip_records
   where id = p_ip_record_id for update;
  if not found or v_ip.status not in ('disbursed', 'settlement_in_progress') then
    raise exception 'Only an active, disbursed IP can be settled'
      using errcode = '23514';
  end if;
  if p_settlement_date is null then
    raise exception 'Settlement date is required' using errcode = '22004';
  end if;
  if not exists (
    select 1 from public.evidence_files
     where ip_record_id = p_ip_record_id
       and document_type = 'bank_transfer'
       and status = 'active'
  ) then
    raise exception 'Active disbursement evidence is required before settlement'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.expenses
     where ip_record_id = p_ip_record_id and status = 'posted'
       and ip_usage_status = 'pending_review'
  ) then
    raise exception 'Resolve every IP discrepancy before settlement'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.expenses as expense
     where expense.ip_record_id = p_ip_record_id and expense.status = 'posted'
       and not exists (
         select 1 from public.evidence_files as evidence
          where evidence.expense_id = expense.id and evidence.status = 'active'
       )
  ) then
    raise exception 'Every posted IP expense needs active evidence'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.evidence_files as evidence
     join public.settlements as settlement on settlement.id = evidence.settlement_id
     where settlement.ip_record_id = p_ip_record_id
       and settlement.amount_returned > 0
       and settlement.status <> 'void'
       and evidence.status <> 'active'
  ) or exists (
    select 1 from public.settlements as settlement
     where settlement.ip_record_id = p_ip_record_id
       and settlement.amount_returned > 0
       and settlement.status <> 'void'
       and not exists (
         select 1 from public.evidence_files as evidence
          where evidence.settlement_id = settlement.id and evidence.status = 'active'
       )
  ) then
    raise exception 'Every fund return needs active evidence'
      using errcode = '23514';
  end if;

  select coalesce(sum(
    case when direction = 'inflow' then amount else -amount end
  ), 0)
    into v_balance
    from public.fund_movements
   where ip_record_id = p_ip_record_id and not is_void;
  if v_balance <> 0 then
    raise exception 'IP balance must be zero before settlement; current balance is %',
      v_balance using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into v_spent
    from public.fund_movements
   where ip_record_id = p_ip_record_id
     and movement_type = 'expense' and not is_void;

  insert into public.settlements (
    ip_record_id, settlement_date, amount_spent, status, notes, created_by
  ) values (
    p_ip_record_id, p_settlement_date, v_spent, 'reviewed',
    nullif(trim(p_notes), ''), auth.uid()
  );
  update public.ip_records set status = 'settled' where id = p_ip_record_id;
  update public.ip_records set status = 'closed' where id = p_ip_record_id;
end;
$$;

create or replace function public.sync_allocation_fund_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_personal_profile_id uuid;
begin
  select * into v_expense from public.expenses where id = new.expense_id;

  if new.source_type = 'ip' and new.status = 'active'
     and v_expense.status = 'posted'
     and v_expense.ip_usage_status = 'verified' then
    insert into public.fund_movements (
      movement_type, direction, source_type, ip_record_id, allocation_id,
      movement_date, amount, description
    ) values (
      'expense', 'outflow', 'ip', new.ip_record_id, new.id,
      v_expense.expense_date, new.amount, v_expense.description
    )
    on conflict (allocation_id) do update
      set direction = excluded.direction,
          ip_record_id = excluded.ip_record_id,
          personal_profile_id = null,
          movement_date = excluded.movement_date,
          amount = excluded.amount,
          description = excluded.description,
          is_void = false,
          void_reason = null,
          updated_at = now();
  elsif new.source_type = 'personal' and new.status = 'active'
        and v_expense.status = 'posted' then
    select id into v_personal_profile_id
      from public.profiles where id = new.personal_profile_id;
    insert into public.fund_movements (
      movement_type, direction, source_type, personal_profile_id, allocation_id,
      movement_date, amount, description
    ) values (
      'expense', 'outflow', 'personal', v_personal_profile_id, new.id,
      v_expense.expense_date, new.amount, v_expense.description
    )
    on conflict (allocation_id) do update
      set source_type = excluded.source_type,
          direction = excluded.direction,
          ip_record_id = null,
          personal_profile_id = excluded.personal_profile_id,
          movement_date = excluded.movement_date,
          amount = excluded.amount,
          description = excluded.description,
          is_void = false,
          void_reason = null,
          updated_at = now();
  else
    update public.fund_movements
       set is_void = true,
           void_reason = coalesce(
             new.void_reason, v_expense.void_reason, 'Allocation is not valid for the ledger'
           ),
           updated_at = now()
     where allocation_id = new.id and not is_void;
  end if;

  if tg_op = 'UPDATE' and old.source_type = 'ip'
     and (new.source_type <> 'ip' or new.ip_record_id is distinct from old.ip_record_id) then
    update public.fund_movements
       set is_void = true,
           void_reason = coalesce(new.void_reason, 'Allocation source changed'),
           updated_at = now()
     where allocation_id = new.id
       and ip_record_id = old.ip_record_id
       and new.source_type <> 'ip';
  end if;
  return null;
end;
$$;

create or replace function public.sync_expense_fund_movements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'void'
     or (new.ip_record_id is not null and new.ip_usage_status <> 'verified') then
    update public.fund_movements as movement
       set is_void = true,
           void_reason = coalesce(new.void_reason, 'IP usage has not been verified'),
           updated_at = now()
      from public.transaction_allocations as allocation
     where allocation.id = movement.allocation_id
       and allocation.expense_id = new.id
       and not movement.is_void;
  else
    if new.ip_record_id is not null and new.ip_usage_status = 'verified' then
      update public.transaction_allocations
         set amount = amount
       where expense_id = new.id
         and status = 'active'
         and source_type = 'ip';
    end if;
    update public.fund_movements as movement
       set is_void = false,
           void_reason = null,
           movement_date = new.expense_date,
           description = new.description,
           updated_at = now()
      from public.transaction_allocations as allocation
     where allocation.id = movement.allocation_id
       and allocation.expense_id = new.id
       and allocation.status = 'active';
  end if;
  return null;
end;
$$;

drop trigger if exists expenses_sync_fund_movements on public.expenses;
create trigger expenses_sync_fund_movements
  after update of status, amount, expense_date, description, ip_usage_status
  on public.expenses
  for each row execute procedure public.sync_expense_fund_movements();

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
    coalesce(m.returned_amount, 0))::numeric(18, 2) as unsettled_balance,
  coalesce(d.discrepancy_count, 0)::integer as discrepancy_count
from public.ip_records as ip
left join lateral (
  select
    sum(amount) filter (where movement_type = 'expense') as valid_realization,
    sum(amount) filter (where movement_type = 'return') as returned_amount
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

revoke all on function public.create_ip_application(text, text, date, text, text, text, jsonb)
  from public, anon;
revoke all on function public.record_ip_disbursement(uuid, date, numeric, text, text, text, jsonb)
  from public, anon;
revoke all on function public.record_ip_expense(uuid, date, uuid, text, text, numeric, text, boolean, text, jsonb)
  from public, anon;
revoke all on function public.resolve_ip_discrepancy(uuid, text, text, uuid, text)
  from public, anon;
revoke all on function public.record_ip_return(uuid, date, numeric, text, text, text, jsonb)
  from public, anon;
revoke all on function public.close_ip_settlement(uuid, date, text)
  from public, anon;
grant execute on function public.create_ip_application(text, text, date, text, text, text, jsonb)
  to authenticated;
grant execute on function public.record_ip_disbursement(uuid, date, numeric, text, text, text, jsonb)
  to authenticated;
grant execute on function public.record_ip_expense(uuid, date, uuid, text, text, numeric, text, boolean, text, jsonb)
  to authenticated;
grant execute on function public.resolve_ip_discrepancy(uuid, text, text, uuid, text)
  to authenticated;
grant execute on function public.record_ip_return(uuid, date, numeric, text, text, text, jsonb)
  to authenticated;
grant execute on function public.close_ip_settlement(uuid, date, text)
  to authenticated;
