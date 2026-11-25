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

  insert into public.ip_records (
    id, title, purpose, requested_on, requested_amount,
    status, department_area, pic_name, notes, created_by,
    project_start_date, project_end_date, project_location
  ) values (
    v_ip_id, trim(p_title), trim(p_purpose), p_requested_on,
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
begin
  return public.create_ip_application(
    p_title, p_purpose, p_requested_on, p_department_area, p_pic_name,
    p_notes, p_budget_items, null, null, null
  );
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

  insert into public.ir_records (
    id, ir_type, title, submitted_on, purpose, pic_name,
    period_start, period_end, notes, status, ptjb_status, payment_status, created_by
  ) values (
    v_id, p_ir_type, trim(p_title), p_submitted_on,
    trim(p_purpose), v_applicant_name, p_period_start, p_period_end,
    nullif(trim(p_notes), ''), 'draft', 'not_submitted', 'unpaid', auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.set_ip_reference_code(
  p_ip_record_id uuid,
  p_reference_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text := nullif(trim(p_reference_code), '');
begin
  if auth.uid() is null
     or not (
       public.is_admin()
       or public.owns_ip_record(p_ip_record_id)
     ) then
    raise exception 'You cannot update this IP reference'
      using errcode = '42501';
  end if;
  if v_reference is null or length(v_reference) > 120 then
    raise exception 'Enter an official IP number of up to 120 characters'
      using errcode = '22023';
  end if;

  update public.ip_records
     set reference_code = v_reference
   where id = p_ip_record_id
     and reference_code is distinct from v_reference;
  if not found and not exists (
    select 1 from public.ip_records where id = p_ip_record_id
  ) then
    raise exception 'IP record does not exist'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_ir_reference_code(
  p_ir_record_id uuid,
  p_reference_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text := nullif(trim(p_reference_code), '');
begin
  if auth.uid() is null
     or not (
       public.is_admin()
       or public.owns_ir_record(p_ir_record_id)
     ) then
    raise exception 'You cannot update this IR reference'
      using errcode = '42501';
  end if;
  if v_reference is null or length(v_reference) > 120 then
    raise exception 'Enter an official IR number of up to 120 characters'
      using errcode = '22023';
  end if;

  update public.ir_records
     set reference_code = v_reference
   where id = p_ir_record_id
     and reference_code is distinct from v_reference;
  if not found and not exists (
    select 1 from public.ir_records where id = p_ir_record_id
  ) then
    raise exception 'IR record does not exist'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.create_ip_application(text, text, date, text, text, text, jsonb, date, date, text)
  from public, anon;
revoke all on function public.create_ip_application(text, text, date, text, text, text, jsonb)
  from public, anon;
revoke all on function public.create_ir_record(text, date, text, text, text, date, date, text)
  from public, anon;
revoke all on function public.set_ip_reference_code(uuid, text)
  from public, anon;
revoke all on function public.set_ir_reference_code(uuid, text)
  from public, anon;

grant execute on function public.create_ip_application(text, text, date, text, text, text, jsonb, date, date, text)
  to authenticated;
grant execute on function public.create_ir_record(text, date, text, text, text, date, date, text)
  to authenticated;
grant execute on function public.set_ip_reference_code(uuid, text)
  to authenticated;
grant execute on function public.set_ir_reference_code(uuid, text)
  to authenticated;
