create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) > 0),
  name text not null check (length(trim(name)) > 0),
  scope text not null check (scope in ('operasional', 'facility')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists categories_scope_name_lower_idx
  on public.categories (scope, lower(name));

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null check (length(trim(name)) > 0),
  holiday_type text not null check (holiday_type in ('national', 'company')),
  source text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (holiday_date, name)
);

create table if not exists public.ip_records (
  id uuid primary key default gen_random_uuid(),
  reference_code text unique,
  title text not null check (length(trim(title)) > 0),
  purpose text not null check (length(trim(purpose)) > 0),
  requested_on date not null default current_date,
  requested_amount numeric(18, 2) not null check (requested_amount > 0),
  disbursed_amount numeric(18, 2) not null default 0 check (disbursed_amount >= 0),
  disbursement_date date,
  status text not null default 'draft'
    check (status in (
      'draft', 'submitted', 'approved', 'disbursed',
      'settlement_in_progress', 'settled', 'closed', 'void'
    )),
  void_reason text,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (disbursed_amount = 0 and disbursement_date is null)
    or (disbursed_amount > 0 and disbursement_date is not null)
  ),
  check (
    disbursed_amount = 0
    or status in (
      'disbursed', 'settlement_in_progress', 'settled', 'closed', 'void'
    )
  ),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.ip_budget_items (
  id uuid primary key default gen_random_uuid(),
  ip_record_id uuid not null references public.ip_records (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  description text not null check (length(trim(description)) > 0),
  requested_amount numeric(18, 2) not null check (requested_amount > 0),
  notes text,
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.ir_records (
  id uuid primary key default gen_random_uuid(),
  reference_code text unique,
  ir_type text not null check (ir_type in ('operasional', 'facility')),
  title text not null check (length(trim(title)) > 0),
  submitted_on date,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'completed', 'void')),
  ptjb_status text not null default 'not_submitted'
    check (ptjb_status in ('not_submitted', 'in_progress', 'submitted', 'approved', 'rejected')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partially_paid', 'paid')),
  void_reason text,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.ir_transactions (
  id uuid primary key default gen_random_uuid(),
  ir_record_id uuid not null references public.ir_records (id) on delete restrict,
  reference_code text,
  transaction_date date not null,
  description text not null check (length(trim(description)) > 0),
  notes text,
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  ip_record_id uuid references public.ip_records (id) on delete restrict,
  ir_transaction_id uuid references public.ir_transactions (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  expense_date date not null,
  description text not null check (length(trim(description)) > 0),
  amount numeric(18, 2) not null check (amount > 0),
  status text not null default 'posted' check (status in ('posted', 'void')),
  void_reason text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ip_record_id is not null) <> (ir_transaction_id is not null)),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  source_type text not null check (source_type in ('ip', 'personal')),
  ip_record_id uuid references public.ip_records (id) on delete restrict,
  personal_profile_id uuid references public.profiles (id) on delete restrict,
  amount numeric(18, 2) not null check (amount > 0),
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_type = 'ip' and ip_record_id is not null and personal_profile_id is null)
    or
    (source_type = 'personal' and ip_record_id is null and personal_profile_id is not null)
  ),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  ip_record_id uuid not null references public.ip_records (id) on delete restrict,
  settlement_date date not null,
  amount_spent numeric(18, 2) not null default 0 check (amount_spent >= 0),
  amount_returned numeric(18, 2) not null default 0 check (amount_returned >= 0),
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewed', 'void')),
  void_reason text,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.reimbursement_payments (
  id uuid primary key default gen_random_uuid(),
  ir_record_id uuid not null references public.ir_records (id) on delete restrict,
  payment_date date,
  amount numeric(18, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  reference_code text,
  void_reason text,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'paid' and payment_date is not null)
    or (status <> 'paid' and payment_date is null)
  ),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete restrict,
  storage_bucket text not null default 'faams-evidence'
    check (storage_bucket = 'faams-evidence'),
  object_path text not null unique check (length(trim(object_path)) > 0),
  original_file_name text not null check (length(trim(original_file_name)) > 0),
  system_file_name text not null check (length(trim(system_file_name)) > 0),
  document_type text not null default 'receipt'
    check (document_type in ('receipt', 'invoice', 'approval', 'settlement', 'other')),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mime_type = 'image/jpeg' and system_file_name ~* '\.(jpg|jpeg)$')
    or (mime_type = 'image/png' and system_file_name ~* '\.png$')
    or (mime_type = 'application/pdf' and system_file_name ~* '\.pdf$')
  ),
  check (status <> 'void' or length(trim(coalesce(void_reason, ''))) > 0)
);

create table if not exists public.monthly_closings (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  status text not null default 'open' check (status in ('open', 'closed', 'reopened')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null default auth.uid(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extract(day from period_start) = 1),
  check (
    (status = 'closed' and closed_at is not null and closed_by is not null)
    or (status <> 'closed')
  )
);

create table if not exists public.fund_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null
    check (movement_type in ('disbursement', 'expense', 'return', 'adjustment')),
  direction text not null check (direction in ('inflow', 'outflow')),
  source_type text not null check (source_type in ('ip', 'personal')),
  ip_record_id uuid references public.ip_records (id) on delete restrict,
  personal_profile_id uuid references public.profiles (id) on delete restrict,
  allocation_id uuid unique references public.transaction_allocations (id) on delete restrict,
  settlement_id uuid unique references public.settlements (id) on delete restrict,
  movement_date date not null,
  amount numeric(18, 2) not null check (amount > 0),
  description text not null check (length(trim(description)) > 0),
  is_void boolean not null default false,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_type = 'ip' and ip_record_id is not null and personal_profile_id is null)
    or
    (source_type = 'personal' and ip_record_id is null and personal_profile_id is not null)
  ),
  check (
    (movement_type = 'disbursement' and source_type = 'ip'
      and direction = 'inflow' and allocation_id is null and settlement_id is null)
    or
    (movement_type = 'expense' and direction = 'outflow'
      and allocation_id is not null and settlement_id is null)
    or
    (movement_type = 'return' and source_type = 'ip'
      and direction = 'outflow' and allocation_id is null and settlement_id is not null)
    or
    (movement_type = 'adjustment' and allocation_id is null and settlement_id is null)
  ),
  check (not is_void or length(trim(coalesce(void_reason, ''))) > 0)
);

create unique index if not exists fund_movements_one_ip_disbursement_idx
  on public.fund_movements (ip_record_id)
  where movement_type = 'disbursement';

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid references auth.users (id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.fund_movement_ledger
with (security_invoker = true)
as
select
  id,
  movement_type,
  direction,
  source_type,
  ip_record_id,
  personal_profile_id,
  allocation_id,
  settlement_id,
  movement_date,
  amount,
  case when direction = 'inflow' then amount else -amount end as signed_amount,
  description,
  is_void,
  void_reason,
  created_at
from public.fund_movements
where not is_void;

create index if not exists ip_records_status_date_idx
  on public.ip_records (status, requested_on desc);
create index if not exists ip_records_disbursement_date_idx
  on public.ip_records (disbursement_date desc) where disbursement_date is not null;
create index if not exists ip_budget_items_ip_idx
  on public.ip_budget_items (ip_record_id);
create index if not exists ir_records_type_status_idx
  on public.ir_records (ir_type, status, created_at desc);
create index if not exists ir_transactions_record_date_idx
  on public.ir_transactions (ir_record_id, transaction_date desc);
create index if not exists expenses_ip_date_idx
  on public.expenses (ip_record_id, expense_date desc) where ip_record_id is not null;
create index if not exists expenses_ir_date_idx
  on public.expenses (ir_transaction_id, expense_date desc) where ir_transaction_id is not null;
create index if not exists expenses_category_date_idx
  on public.expenses (category_id, expense_date desc);
create index if not exists allocations_expense_status_idx
  on public.transaction_allocations (expense_id, status);
create index if not exists allocations_ip_idx
  on public.transaction_allocations (ip_record_id) where ip_record_id is not null;
create index if not exists allocations_personal_idx
  on public.transaction_allocations (personal_profile_id) where personal_profile_id is not null;
create index if not exists settlements_ip_date_idx
  on public.settlements (ip_record_id, settlement_date desc);
create index if not exists reimbursement_payments_ir_date_idx
  on public.reimbursement_payments (ir_record_id, payment_date desc);
create index if not exists evidence_expense_status_idx
  on public.evidence_files (expense_id, status);
create index if not exists holidays_date_active_idx
  on public.holidays (holiday_date) where is_active;
create index if not exists fund_movements_ip_date_idx
  on public.fund_movements (ip_record_id, movement_date desc) where ip_record_id is not null;
create index if not exists fund_movements_personal_date_idx
  on public.fund_movements (personal_profile_id, movement_date desc)
  where personal_profile_id is not null;
create index if not exists audit_logs_entity_created_idx
  on public.audit_logs (entity_table, entity_id, created_at desc);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs (actor_id, created_at desc);

insert into public.categories (code, name, scope) values
  ('facility-atk', 'ATK', 'facility'),
  ('operasional-konsumsi', 'Konsumsi', 'operasional'),
  ('operasional-transportasi', 'Transportasi', 'operasional'),
  ('operasional-perjalanan-dinas', 'Perjalanan Dinas', 'operasional'),
  ('operasional-komunikasi', 'Komunikasi', 'operasional'),
  ('operasional-material', 'Material', 'operasional'),
  ('operasional-lainnya', 'Lainnya', 'operasional'),
  ('facility-bbm-mobil', 'BBM Mobil', 'facility'),
  ('facility-bbm-motor', 'BBM Motor', 'facility'),
  ('facility-servis-kendaraan', 'Servis Kendaraan', 'facility'),
  ('facility-perawatan-kendaraan', 'Perawatan Kendaraan', 'facility'),
  ('facility-perbaikan-gedung', 'Perbaikan Gedung', 'facility'),
  ('facility-listrik', 'Listrik', 'facility'),
  ('facility-ac', 'AC', 'facility'),
  ('facility-peralatan-kantor', 'Peralatan Kantor', 'facility'),
  ('facility-maintenance-asset', 'Maintenance Asset', 'facility'),
  ('facility-lainnya', 'Lainnya', 'facility')
on conflict (code) do nothing;

create or replace function public.calculate_working_days(
  p_start_date date,
  p_end_date date
)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_days integer;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required'
      using errcode = '22004';
  end if;
  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date'
      using errcode = '22007';
  end if;

  select count(*)::integer
    into v_days
    from generate_series(p_start_date, p_end_date, interval '1 day') as calendar_day(day)
   where extract(isodow from calendar_day.day) < 6
     and not exists (
       select 1
         from public.holidays as h
        where h.holiday_date = calendar_day.day::date
          and h.is_active
     );

  return v_days;
end;
$$;

create or replace function public.calculate_deadline(
  p_disbursement_date date,
  p_working_days integer
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_date date;
  v_count integer := 0;
begin
  if p_disbursement_date is null then
    raise exception 'Disbursement date is required'
      using errcode = '22004';
  end if;
  if p_working_days is null or p_working_days < 0 then
    raise exception 'Working days must be zero or greater'
      using errcode = '22023';
  end if;
  if p_working_days = 0 then
    return p_disbursement_date;
  end if;

  v_date := p_disbursement_date;
  while v_count < p_working_days loop
    v_date := v_date + 1;
    if extract(isodow from v_date) < 6
       and not exists (
         select 1
           from public.holidays as h
          where h.holiday_date = v_date
            and h.is_active
       ) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_date;
end;
$$;

create or replace function public.validate_transaction_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_allocated numeric(18, 2);
  v_ip_status text;
begin
  select *
    into v_expense
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

create or replace function public.validate_ip_budget_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ip_record_id uuid;
  v_requested_amount numeric(18, 2);
  v_status text;
  v_budget_total numeric(18, 2);
begin
  if tg_table_name = 'ip_budget_items' then
    if tg_op = 'UPDATE'
       and new.ip_record_id is distinct from old.ip_record_id then
      raise exception 'An IP budget item cannot be moved to another IP'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'ip_records' then
    v_ip_record_id := new.id;
  elsif tg_op = 'DELETE' then
    v_ip_record_id := old.ip_record_id;
  else
    v_ip_record_id := new.ip_record_id;
  end if;

  select requested_amount, status
    into v_requested_amount, v_status
    from public.ip_records
   where id = v_ip_record_id;

  if not found or v_status in ('draft', 'void') then
    return null;
  end if;

  select coalesce(sum(requested_amount), 0)
    into v_budget_total
    from public.ip_budget_items
   where ip_record_id = v_ip_record_id
     and status = 'active';

  if v_budget_total = 0 or v_budget_total <> v_requested_amount then
    raise exception 'Submitted IP budget items (%) must equal requested amount (%)',
      v_budget_total, v_requested_amount
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.validate_expense_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_scope text;
  v_ir_type text;
begin
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then
    return new;
  end if;

  select scope into v_category_scope
    from public.categories
   where id = new.category_id
     and is_active;
  if not found then
    raise exception 'New expenses must use an active category'
      using errcode = '23514';
  end if;

  if new.ir_transaction_id is not null then
    select ir.ir_type into v_ir_type
      from public.ir_transactions as transaction
      join public.ir_records as ir on ir.id = transaction.ir_record_id
     where transaction.id = new.ir_transaction_id;

    if v_ir_type is distinct from v_category_scope then
      raise exception 'Expense category scope must match the IR type'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_ip_budget_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
    from public.ip_records
   where id = new.ip_record_id
   for update;
  if not found then
    raise exception 'IP record % does not exist', new.ip_record_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then
    return new;
  end if;
  if not exists (
    select 1
      from public.categories
     where id = new.category_id
       and is_active
  ) then
    raise exception 'New IP budget items must use an active category'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_financial_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'ir_transactions'
       and new.ir_record_id is distinct from old.ir_record_id then
      raise exception 'An IR transaction cannot be moved to another IR'
        using errcode = '23514';
    elsif tg_table_name = 'expenses'
       and (new.ip_record_id is distinct from old.ip_record_id
         or new.ir_transaction_id is distinct from old.ir_transaction_id) then
      raise exception 'An expense cannot be moved to another financial record'
        using errcode = '23514';
    elsif tg_table_name = 'transaction_allocations'
       and new.expense_id is distinct from old.expense_id then
      raise exception 'An allocation cannot be moved to another expense'
        using errcode = '23514';
    elsif tg_table_name = 'evidence_files'
       and new.expense_id is distinct from old.expense_id then
      raise exception 'Evidence cannot be moved to another expense'
        using errcode = '23514';
    elsif tg_table_name = 'settlements'
       and new.ip_record_id is distinct from old.ip_record_id then
      raise exception 'A settlement cannot be moved to another IP'
        using errcode = '23514';
    elsif tg_table_name = 'reimbursement_payments'
       and new.ir_record_id is distinct from old.ir_record_id then
      raise exception 'A reimbursement payment cannot be moved to another IR'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_expense_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allocated numeric(18, 2);
begin
  if new.amount is distinct from old.amount or new.status is distinct from old.status then
    select coalesce(sum(a.amount), 0)
      into v_allocated
      from public.transaction_allocations as a
     where a.expense_id = old.id
       and a.status = 'active';

    if new.status = 'posted' and v_allocated > new.amount then
      raise exception 'Expense amount cannot be below active allocations (%)',
        v_allocated
        using errcode = '23514';
    end if;
    if new.status = 'void' and v_allocated > 0
       and length(trim(coalesce(new.void_reason, ''))) = 0 then
      raise exception 'Voiding an allocated expense requires a reason'
        using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.validate_ip_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_balance numeric(18, 2);
begin
  if tg_op = 'UPDATE' and old.status = 'closed'
     and (
       new.status is distinct from old.status
       or new.requested_amount is distinct from old.requested_amount
       or new.disbursed_amount is distinct from old.disbursed_amount
       or new.disbursement_date is distinct from old.disbursement_date
     ) then
    raise exception 'A closed IP cannot be reopened or have its financial amounts changed'
      using errcode = '23514';
  end if;

  if new.status = 'void' and new.disbursed_amount > 0 then
    raise exception 'A disbursed IP must be settled, not voided'
      using errcode = '23514';
  end if;

  if new.status in ('settled', 'closed') then
    if new.disbursed_amount <= 0
       or new.disbursement_date is null then
      raise exception 'An IP cannot be settled or closed before disbursement'
        using errcode = '23514';
    end if;

    select coalesce(sum(
      case when direction = 'inflow' then amount else -amount end
    ), 0)
      into v_balance
      from public.fund_movements
     where ip_record_id = new.id
       and not is_void;

    if v_balance <> 0 then
      raise exception 'An IP cannot be settled with an unresolved fund balance (%)',
        v_balance
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.settlements
       where ip_record_id = new.id
         and status = 'reviewed'
    ) or exists (
      select 1
        from public.settlements
       where ip_record_id = new.id
         and status = 'submitted'
    ) then
      raise exception 'An IP requires reviewed settlements before it can be settled or closed'
        using errcode = '23514';
    end if;
    if new.status = 'closed'
       and (tg_op <> 'UPDATE' or old.status <> 'settled') then
      raise exception 'An IP must be settled before it can be closed'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_posted_expense_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expense_id uuid;
  v_expense_status text;
begin
  if tg_table_name = 'expenses' then
    if tg_op = 'DELETE' then
      v_expense_id := old.id;
    else
      v_expense_id := new.id;
    end if;
  elsif tg_op = 'DELETE' then
    v_expense_id := old.expense_id;
  else
    v_expense_id := new.expense_id;
  end if;

  select status
    into v_expense_status
    from public.expenses
   where id = v_expense_id;
  if v_expense_status = 'posted'
     and not exists (
       select 1
         from public.transaction_allocations
        where expense_id = v_expense_id
          and status = 'active'
     ) then
    raise exception 'Every posted expense must have at least one active funding allocation'
      using errcode = '23514';
  end if;
  return null;
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
  select *
    into v_expense
    from public.expenses
   where id = new.expense_id;

  if new.source_type = 'ip' and new.status = 'active' and v_expense.status = 'posted' then
    insert into public.fund_movements (
      movement_type, direction, source_type, ip_record_id, allocation_id,
      movement_date, amount, description
    ) values (
      'expense', 'outflow', 'ip', new.ip_record_id, new.id,
      v_expense.expense_date, new.amount, v_expense.description
    )
    on conflict (allocation_id) do update
      set source_type = excluded.source_type,
          direction = excluded.direction,
          ip_record_id = excluded.ip_record_id,
          personal_profile_id = null,
          movement_date = excluded.movement_date,
          amount = excluded.amount,
          description = excluded.description,
          is_void = false,
          void_reason = null,
          updated_at = now();
  elsif new.source_type = 'personal' and new.status = 'active' and v_expense.status = 'posted' then
    select id into v_personal_profile_id
      from public.profiles
     where id = new.personal_profile_id;

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
             new.void_reason,
             v_expense.void_reason,
             'Allocation voided'
           ),
           updated_at = now()
     where allocation_id = new.id
       and not is_void;
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
  if new.status = 'void' then
    update public.fund_movements as movement
       set is_void = true,
           void_reason = new.void_reason,
           updated_at = now()
      from public.transaction_allocations as allocation
     where allocation.id = movement.allocation_id
       and allocation.expense_id = new.id
       and not movement.is_void;
  else
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

create or replace function public.sync_ip_disbursement_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.disbursed_amount > 0
     and new.disbursement_date is not null
     and new.status <> 'void' then
    insert into public.fund_movements (
      movement_type, direction, source_type, ip_record_id,
      movement_date, amount, description
    ) values (
      'disbursement', 'inflow', 'ip', new.id, new.disbursement_date,
      new.disbursed_amount, 'Pencairan ' || new.title
    )
    on conflict (ip_record_id) where movement_type = 'disbursement'
      do update set
        movement_date = excluded.movement_date,
        amount = excluded.amount,
        description = excluded.description,
        is_void = false,
        void_reason = null,
        updated_at = now();
  else
    update public.fund_movements
       set is_void = true,
           void_reason = coalesce(new.void_reason, 'IP disbursement voided'),
           updated_at = now()
     where ip_record_id = new.id
       and movement_type = 'disbursement'
       and not is_void;
  end if;
  return null;
end;
$$;

create or replace function public.sync_settlement_return_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_title text;
begin
  select title into v_ip_title
    from public.ip_records
   where id = new.ip_record_id;

  if new.amount_returned > 0 and new.status <> 'void' then
    insert into public.fund_movements (
      movement_type, direction, source_type, ip_record_id, settlement_id,
      movement_date, amount, description
    ) values (
      'return', 'outflow', 'ip', new.ip_record_id, new.id,
      new.settlement_date, new.amount_returned,
      'Pengembalian dana ' || coalesce(v_ip_title, new.ip_record_id::text)
    )
    on conflict (settlement_id) do update
      set ip_record_id = excluded.ip_record_id,
          movement_date = excluded.movement_date,
          amount = excluded.amount,
          description = excluded.description,
          is_void = false,
          void_reason = null,
          updated_at = now();
  else
    update public.fund_movements
       set is_void = true,
           void_reason = coalesce(new.void_reason, 'Settlement return voided'),
           updated_at = now()
     where settlement_id = new.id
       and not is_void;
  end if;
  return null;
end;
$$;

create or replace function public.validate_reimbursement_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reimbursable numeric(18, 2);
  v_paid numeric(18, 2);
begin
  perform 1
    from public.ir_records
   where id = new.ir_record_id
   for update;
  if not found then
    raise exception 'IR record % does not exist', new.ir_record_id
      using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.ir_record_id <> old.ir_record_id then
    raise exception 'A reimbursement payment cannot be moved to another IR'
      using errcode = '23514';
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
   where transaction.ir_record_id = new.ir_record_id
     and transaction.status = 'active';

  select coalesce(sum(payment.amount), 0)
    into v_paid
    from public.reimbursement_payments as payment
   where payment.ir_record_id = new.ir_record_id
     and payment.status = 'paid'
     and payment.id is distinct from new.id;

  if new.status = 'paid' then
    v_paid := v_paid + new.amount;
  end if;
  if v_paid > v_reimbursable then
    raise exception 'Paid reimbursement (%) exceeds personal-funded expenses (%)',
      v_paid, v_reimbursable
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.validate_settlement_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ip_status text;
  v_disbursed_amount numeric(18, 2);
  v_returned_amount numeric(18, 2);
begin
  select status, disbursed_amount
    into v_ip_status, v_disbursed_amount
    from public.ip_records
   where id = new.ip_record_id
   for update;
  if not found then
    raise exception 'IP record % does not exist', new.ip_record_id
      using errcode = '23503';
  end if;
  if v_ip_status not in ('disbursed', 'settlement_in_progress') then
    raise exception 'Settlements can only be recorded for an active disbursed IP'
      using errcode = '23514';
  end if;

  select coalesce(sum(amount_returned), 0)
    into v_returned_amount
    from public.settlements
   where ip_record_id = new.ip_record_id
     and status <> 'void'
     and id is distinct from new.id;
  if new.status <> 'void' then
    v_returned_amount := v_returned_amount + new.amount_returned;
  end if;
  if v_returned_amount > v_disbursed_amount then
    raise exception 'Total returned funds (%) cannot exceed the IP disbursement (%)',
      v_returned_amount, v_disbursed_amount
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
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
end;
$$;

create or replace function public.validate_ir_completeness()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ir_record_id uuid;
  v_status text;
  v_ptjb_status text;
begin
  if tg_table_name = 'ir_records' then
    v_ir_record_id := new.id;
  elsif tg_table_name = 'ir_transactions' then
    if tg_op = 'DELETE' then
      v_ir_record_id := old.ir_record_id;
    else
      v_ir_record_id := new.ir_record_id;
    end if;
  elsif tg_table_name = 'expenses' then
    if tg_op = 'DELETE' then
      select ir_record_id into v_ir_record_id
        from public.ir_transactions
       where id = old.ir_transaction_id;
    else
      select ir_record_id into v_ir_record_id
        from public.ir_transactions
       where id = new.ir_transaction_id;
    end if;
  elsif tg_table_name = 'evidence_files' then
    if tg_op = 'DELETE' then
      select transaction.ir_record_id into v_ir_record_id
        from public.expenses as expense
        join public.ir_transactions as transaction
          on transaction.id = expense.ir_transaction_id
       where expense.id = old.expense_id;
    else
      select transaction.ir_record_id into v_ir_record_id
        from public.expenses as expense
        join public.ir_transactions as transaction
          on transaction.id = expense.ir_transaction_id
       where expense.id = new.expense_id;
    end if;
  else
    return null;
  end if;

  if v_ir_record_id is null then
    return null;
  end if;
  select status, ptjb_status
    into v_status, v_ptjb_status
    from public.ir_records
   where id = v_ir_record_id;

  if v_status not in ('submitted', 'approved', 'completed')
     and v_ptjb_status not in ('submitted', 'approved') then
    return null;
  end if;

  if not exists (
    select 1
      from public.ir_transactions
     where ir_record_id = v_ir_record_id
       and status = 'active'
  ) then
    raise exception 'A submitted IR must contain at least one active transaction'
      using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.ir_transactions as transaction
     where transaction.ir_record_id = v_ir_record_id
       and transaction.status = 'active'
       and not exists (
         select 1
           from public.expenses as expense
          where expense.ir_transaction_id = transaction.id
            and expense.status = 'posted'
       )
  ) then
    raise exception 'Every active IR transaction must contain a posted expense before submission'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
      from public.ir_transactions as transaction
      join public.expenses as expense
        on expense.ir_transaction_id = transaction.id
       and expense.status = 'posted'
      join public.evidence_files as evidence
        on evidence.expense_id = expense.id
       and evidence.status = 'active'
     where transaction.ir_record_id = v_ir_record_id
       and transaction.status = 'active'
  ) then
    raise exception 'A submitted IR must have active supporting evidence'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.sync_ir_payment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir_record_id uuid;
begin
  v_ir_record_id := case when tg_op = 'DELETE' then old.ir_record_id else new.ir_record_id end;
  perform public.refresh_ir_payment_status(v_ir_record_id);

  return null;
end;
$$;

create or replace function public.refresh_expense_ir_payment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir_record_id uuid;
begin
  select transaction.ir_record_id
    into v_ir_record_id
    from public.ir_transactions as transaction
   where transaction.id = new.ir_transaction_id;

  if v_ir_record_id is not null then
    perform public.refresh_ir_payment_status(v_ir_record_id);
  end if;
  return null;
end;
$$;

create or replace function public.refresh_allocation_ir_payment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ir_record_id uuid;
begin
  select transaction.ir_record_id
    into v_ir_record_id
    from public.expenses as expense
    join public.ir_transactions as transaction
      on transaction.id = expense.ir_transaction_id
   where expense.id = new.expense_id;

  if v_ir_record_id is not null then
    perform public.refresh_ir_payment_status(v_ir_record_id);
  end if;
  return null;
end;
$$;

create or replace function public.refresh_transaction_ir_payment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_ir_payment_status(new.ir_record_id);
  return null;
end;
$$;

create or replace function public.log_audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_data jsonb;
  v_new_data jsonb;
  v_entity_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_data := to_jsonb(old);
    v_entity_id := (v_old_data ->> 'id')::uuid;
  end if;
  if tg_op <> 'DELETE' then
    v_new_data := to_jsonb(new);
    v_entity_id := (v_new_data ->> 'id')::uuid;
  end if;

  insert into public.audit_logs (
    entity_table, entity_id, action, actor_id, old_data, new_data
  ) values (
    tg_table_name, v_entity_id, tg_op, auth.uid(), v_old_data, v_new_data
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.log_audit_change() from public, anon, authenticated;
revoke all on function public.sync_allocation_fund_movement() from public, anon, authenticated;
revoke all on function public.sync_expense_fund_movements() from public, anon, authenticated;
revoke all on function public.sync_ip_disbursement_movement() from public, anon, authenticated;
revoke all on function public.sync_settlement_return_movement() from public, anon, authenticated;
revoke all on function public.refresh_ir_payment_status(uuid) from public, anon;
revoke all on function public.sync_ir_payment_status() from public, anon, authenticated;
revoke all on function public.refresh_expense_ir_payment_status() from public, anon, authenticated;
revoke all on function public.refresh_allocation_ir_payment_status() from public, anon, authenticated;
revoke all on function public.refresh_transaction_ir_payment_status() from public, anon, authenticated;
revoke all on function public.calculate_working_days(date, date) from public, anon;
revoke all on function public.calculate_deadline(date, integer) from public, anon;
grant execute on function public.calculate_working_days(date, date) to authenticated;
grant execute on function public.calculate_deadline(date, integer) to authenticated;

drop trigger if exists ip_records_set_updated_at on public.ip_records;
create trigger ip_records_set_updated_at before update on public.ip_records
  for each row execute procedure public.set_updated_at();
drop trigger if exists ip_budget_items_set_updated_at on public.ip_budget_items;
create trigger ip_budget_items_set_updated_at before update on public.ip_budget_items
  for each row execute procedure public.set_updated_at();
drop trigger if exists ir_records_set_updated_at on public.ir_records;
create trigger ir_records_set_updated_at before update on public.ir_records
  for each row execute procedure public.set_updated_at();
drop trigger if exists ir_transactions_set_updated_at on public.ir_transactions;
create trigger ir_transactions_set_updated_at before update on public.ir_transactions
  for each row execute procedure public.set_updated_at();
drop trigger if exists expenses_validate_update on public.expenses;
create trigger expenses_validate_update before update on public.expenses
  for each row execute procedure public.validate_expense_amount();
drop trigger if exists ip_records_validate_lifecycle on public.ip_records;
create trigger ip_records_validate_lifecycle before insert or update on public.ip_records
  for each row execute procedure public.validate_ip_lifecycle();
drop trigger if exists expenses_sync_fund_movements on public.expenses;
create trigger expenses_sync_fund_movements after update of status, amount, expense_date, description
  on public.expenses for each row execute procedure public.sync_expense_fund_movements();
drop trigger if exists expenses_sync_ir_payment_status on public.expenses;
create trigger expenses_sync_ir_payment_status after update of status
  on public.expenses for each row execute procedure public.refresh_expense_ir_payment_status();
drop trigger if exists allocations_validate on public.transaction_allocations;
create trigger allocations_validate before insert or update on public.transaction_allocations
  for each row execute procedure public.validate_transaction_allocation();
drop trigger if exists expenses_allocation_integrity on public.expenses;
create constraint trigger expenses_allocation_integrity
  after insert or update or delete on public.expenses
  deferrable initially deferred
  for each row execute procedure public.validate_posted_expense_allocations();
drop trigger if exists allocations_expense_integrity on public.transaction_allocations;
create constraint trigger allocations_expense_integrity
  after insert or update or delete on public.transaction_allocations
  deferrable initially deferred
  for each row execute procedure public.validate_posted_expense_allocations();
drop trigger if exists allocations_sync_fund_movement on public.transaction_allocations;
create trigger allocations_sync_fund_movement after insert or update on public.transaction_allocations
  for each row execute procedure public.sync_allocation_fund_movement();
drop trigger if exists allocations_sync_ir_payment_status on public.transaction_allocations;
create trigger allocations_sync_ir_payment_status after insert or update on public.transaction_allocations
  for each row execute procedure public.refresh_allocation_ir_payment_status();
drop trigger if exists ir_transactions_sync_payment_status on public.ir_transactions;
create trigger ir_transactions_sync_payment_status after update of status
  on public.ir_transactions for each row execute procedure public.refresh_transaction_ir_payment_status();
drop trigger if exists expenses_validate_category on public.expenses;
create trigger expenses_validate_category before insert or update of
  category_id, ir_transaction_id on public.expenses
  for each row execute procedure public.validate_expense_category();
drop trigger if exists ip_budget_items_validate_category on public.ip_budget_items;
create trigger ip_budget_items_validate_category before insert or update
  on public.ip_budget_items for each row execute procedure public.validate_ip_budget_category();

drop trigger if exists ir_transactions_parent_immutable on public.ir_transactions;
create trigger ir_transactions_parent_immutable before update on public.ir_transactions
  for each row execute procedure public.validate_financial_parent();
drop trigger if exists expenses_parent_immutable on public.expenses;
create trigger expenses_parent_immutable before update on public.expenses
  for each row execute procedure public.validate_financial_parent();
drop trigger if exists allocations_parent_immutable on public.transaction_allocations;
create trigger allocations_parent_immutable before update on public.transaction_allocations
  for each row execute procedure public.validate_financial_parent();
drop trigger if exists evidence_parent_immutable on public.evidence_files;
create trigger evidence_parent_immutable before update on public.evidence_files
  for each row execute procedure public.validate_financial_parent();
drop trigger if exists settlements_parent_immutable on public.settlements;
create trigger settlements_parent_immutable before update on public.settlements
  for each row execute procedure public.validate_financial_parent();
drop trigger if exists payments_parent_immutable on public.reimbursement_payments;
create trigger payments_parent_immutable before update on public.reimbursement_payments
  for each row execute procedure public.validate_financial_parent();

drop trigger if exists ir_records_completeness on public.ir_records;
create constraint trigger ir_records_completeness
  after insert or update on public.ir_records
  deferrable initially deferred
  for each row execute procedure public.validate_ir_completeness();
drop trigger if exists ir_transactions_completeness on public.ir_transactions;
create constraint trigger ir_transactions_completeness
  after insert or update or delete on public.ir_transactions
  deferrable initially deferred
  for each row execute procedure public.validate_ir_completeness();
drop trigger if exists expenses_completeness on public.expenses;
create constraint trigger expenses_completeness
  after insert or update or delete on public.expenses
  deferrable initially deferred
  for each row execute procedure public.validate_ir_completeness();
drop trigger if exists evidence_completeness on public.evidence_files;
create constraint trigger evidence_completeness
  after insert or update or delete on public.evidence_files
  deferrable initially deferred
  for each row execute procedure public.validate_ir_completeness();
drop trigger if exists settlements_set_updated_at on public.settlements;
create trigger settlements_set_updated_at before update on public.settlements
  for each row execute procedure public.set_updated_at();
drop trigger if exists settlements_validate_amount on public.settlements;
create trigger settlements_validate_amount before insert or update on public.settlements
  for each row execute procedure public.validate_settlement_amount();
drop trigger if exists settlements_sync_return_movement on public.settlements;
create trigger settlements_sync_return_movement after insert or update of
  ip_record_id, settlement_date, amount_returned, status, void_reason
  on public.settlements for each row execute procedure public.sync_settlement_return_movement();
drop trigger if exists payments_validate on public.reimbursement_payments;
create trigger payments_validate before insert or update on public.reimbursement_payments
  for each row execute procedure public.validate_reimbursement_payment();
drop trigger if exists payments_sync_ir_status on public.reimbursement_payments;
create trigger payments_sync_ir_status after insert or update or delete
  on public.reimbursement_payments for each row execute procedure public.sync_ir_payment_status();
drop trigger if exists evidence_files_set_updated_at on public.evidence_files;
create trigger evidence_files_set_updated_at before update on public.evidence_files
  for each row execute procedure public.set_updated_at();
drop trigger if exists monthly_closings_set_updated_at on public.monthly_closings;
create trigger monthly_closings_set_updated_at before update on public.monthly_closings
  for each row execute procedure public.set_updated_at();
drop trigger if exists fund_movements_set_updated_at on public.fund_movements;
create trigger fund_movements_set_updated_at before update on public.fund_movements
  for each row execute procedure public.set_updated_at();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
  for each row execute procedure public.set_updated_at();
drop trigger if exists holidays_set_updated_at on public.holidays;
create trigger holidays_set_updated_at before update on public.holidays
  for each row execute procedure public.set_updated_at();

drop trigger if exists ip_records_sync_disbursement on public.ip_records;
create trigger ip_records_sync_disbursement after insert or update of
  title, status, disbursed_amount, disbursement_date, void_reason
  on public.ip_records for each row execute procedure public.sync_ip_disbursement_movement();

drop trigger if exists ip_records_budget_integrity on public.ip_records;
create constraint trigger ip_records_budget_integrity
  after insert or update on public.ip_records
  deferrable initially deferred
  for each row execute procedure public.validate_ip_budget_total();
drop trigger if exists ip_budget_items_budget_integrity on public.ip_budget_items;
create constraint trigger ip_budget_items_budget_integrity
  after insert or update or delete on public.ip_budget_items
  deferrable initially deferred
  for each row execute procedure public.validate_ip_budget_total();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'system_settings', 'categories', 'holidays', 'ip_records', 'ip_budget_items', 'ir_records',
    'ir_transactions', 'expenses', 'transaction_allocations', 'settlements',
    'reimbursement_payments', 'evidence_files', 'monthly_closings', 'fund_movements'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_audit', v_table);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute procedure public.log_audit_change()',
      v_table || '_audit', v_table
    );
  end loop;
end;
$$;

alter table public.categories enable row level security;
alter table public.holidays enable row level security;
alter table public.ip_records enable row level security;
alter table public.ip_budget_items enable row level security;
alter table public.ir_records enable row level security;
alter table public.ir_transactions enable row level security;
alter table public.expenses enable row level security;
alter table public.transaction_allocations enable row level security;
alter table public.settlements enable row level security;
alter table public.reimbursement_payments enable row level security;
alter table public.evidence_files enable row level security;
alter table public.monthly_closings enable row level security;
alter table public.fund_movements enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table
  public.categories, public.holidays, public.ip_records, public.ip_budget_items,
  public.ir_records, public.ir_transactions, public.expenses,
  public.transaction_allocations, public.settlements, public.reimbursement_payments,
  public.evidence_files, public.monthly_closings, public.fund_movements,
  public.audit_logs
from anon, authenticated;

grant select, insert, update on table
  public.categories, public.holidays, public.ip_records, public.ip_budget_items,
  public.ir_records, public.ir_transactions, public.expenses,
  public.transaction_allocations, public.settlements, public.reimbursement_payments,
  public.evidence_files, public.monthly_closings
to authenticated;
grant select on table public.fund_movements, public.audit_logs to authenticated;
revoke insert, update on table public.ir_records from authenticated;
grant insert (reference_code, ir_type, title, submitted_on, status, ptjb_status, void_reason, notes)
  on table public.ir_records to authenticated;
grant update (reference_code, ir_type, title, submitted_on, status, ptjb_status, void_reason, notes)
  on table public.ir_records to authenticated;
revoke all on table public.fund_movement_ledger from public, anon, authenticated;
grant select on table public.fund_movement_ledger to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'categories', 'holidays', 'ip_records', 'ip_budget_items', 'ir_records',
    'ir_transactions', 'expenses', 'transaction_allocations', 'settlements',
    'reimbursement_payments', 'evidence_files', 'monthly_closings', 'fund_movements'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_admin_all', v_table);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using ((select public.is_admin())) with check ((select public.is_admin()))',
      v_table || '_admin_all', v_table
    );
  end loop;
end;
$$;

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated using ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'faams-evidence',
  'faams-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']::text[]
)
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists faams_evidence_admin_read on storage.objects;
create policy faams_evidence_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'faams-evidence' and (select public.is_admin()));

drop policy if exists faams_evidence_admin_upload on storage.objects;
create policy faams_evidence_admin_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'faams-evidence' and (select public.is_admin()));
