alter table public.ip_records
  add column if not exists project_start_date date,
  add column if not exists project_end_date date,
  add column if not exists project_location text;

alter table public.ip_records
  drop constraint if exists ip_records_project_dates_check;
alter table public.ip_records
  add constraint ip_records_project_dates_check
  check (
    project_start_date is null
    or project_end_date is null
    or project_end_date >= project_start_date
  );

alter table public.ip_budget_items
  add column if not exists quantity numeric(18, 2) not null default 1,
  add column if not exists unit_cost numeric(18, 2);

update public.ip_budget_items
set unit_cost = requested_amount
where unit_cost is null;

set constraints ip_budget_items_budget_integrity immediate;

alter table public.ip_budget_items
  alter column unit_cost set not null,
  drop constraint if exists ip_budget_items_quantity_check,
  drop constraint if exists ip_budget_items_unit_cost_check,
  drop constraint if exists ip_budget_items_total_check,
  add constraint ip_budget_items_quantity_check check (quantity > 0),
  add constraint ip_budget_items_unit_cost_check check (unit_cost > 0),
  add constraint ip_budget_items_total_check
    check (requested_amount = round(quantity * unit_cost, 2));

drop function if exists public.create_ip_application(text, text, date, text, text, text, jsonb);
drop function if exists public.create_ip_application(text, text, date, text, text, text, jsonb, date, date, text);

create function public.create_ip_application(
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
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
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
    nullif(trim(p_pic_name), ''), nullif(trim(p_notes), ''), auth.uid(),
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

create function public.create_ip_application(
  p_title text,
  p_purpose text,
  p_requested_on date,
  p_department_area text,
  p_pic_name text,
  p_notes text,
  p_budget_items jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.create_ip_application(
    p_title, p_purpose, p_requested_on, p_department_area,
    p_pic_name, p_notes, p_budget_items, null, null, null
  );
$$;

revoke all on function public.create_ip_application(text, text, date, text, text, text, jsonb, date, date, text)
  from public, anon;
revoke all on function public.create_ip_application(text, text, date, text, text, text, jsonb)
  from public, anon;
grant execute on function public.create_ip_application(text, text, date, text, text, text, jsonb, date, date, text)
  to authenticated;
grant execute on function public.create_ip_application(text, text, date, text, text, text, jsonb)
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
    coalesce(m.returned_amount, 0))::numeric(18, 2) as unsettled_balance,
  coalesce(d.discrepancy_count, 0)::integer as discrepancy_count,
  ip.project_start_date,
  ip.project_end_date,
  ip.project_location
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

insert into public.system_settings (key, value, description)
values (
  'ip_application_form',
  jsonb_build_object(
    'company_name', '',
    'regional_name', '',
    'department_name', '',
    'area_name', '',
    'submitter_title', '',
    'submitter_name', '',
    'submitter_employee_id', '',
    'submitter_signature_path', '',
    'approver_title', '',
    'approver_name', '',
    'approver_employee_id', '',
    'approver_signature_path', '',
    'logo_path', ''
  ),
  'Branding and approval details used by the IP application Excel/PDF export.'
)
on conflict (key) do nothing;

create or replace function public.save_ip_application_form_settings(p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setting_id uuid;
  v_old_value jsonb;
  v_action text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_value), '') <> 'object' then
    raise exception 'IP application settings must be a JSON object' using errcode = '22023';
  end if;

  select id, value into v_setting_id, v_old_value
    from public.system_settings
   where key = 'ip_application_form'
   for update;
  if found then
    update public.system_settings
       set value = p_value,
           updated_by = auth.uid()
     where id = v_setting_id;
    v_action := 'UPDATE';
  else
    insert into public.system_settings (key, value, description, updated_by)
    values (
      'ip_application_form',
      p_value,
      'Branding and approval details used by the IP application Excel/PDF export.',
      auth.uid()
    )
    returning id into v_setting_id;
    v_action := 'INSERT';
  end if;

  insert into public.audit_logs (
    entity_table, entity_id, action, actor_id, old_data, new_data
  ) values (
    'system_settings',
    v_setting_id,
    v_action,
    auth.uid(),
    case when v_action = 'UPDATE'
      then jsonb_build_object('key', 'ip_application_form', 'value', v_old_value)
      else null
    end,
    jsonb_build_object('key', 'ip_application_form', 'value', p_value)
  );
end;
$$;

revoke all on function public.save_ip_application_form_settings(jsonb) from public, anon;
grant execute on function public.save_ip_application_form_settings(jsonb) to authenticated;
