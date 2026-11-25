alter table public.evidence_files
  add column if not exists ir_record_id uuid
    references public.ir_records (id) on delete restrict;

alter table public.evidence_files
  drop constraint if exists evidence_files_parent_check;
alter table public.evidence_files
  add constraint evidence_files_parent_check
  check (num_nonnulls(
    expense_id, ip_record_id, settlement_id,
    reimbursement_payment_id, ir_record_id
  ) <= 1);

alter table public.evidence_files
  drop constraint if exists evidence_files_document_type_check;
alter table public.evidence_files
  add constraint evidence_files_document_type_check
  check (document_type in (
    'receipt', 'invoice', 'approval', 'settlement', 'bank_transfer',
    'fund_return', 'other', 'ip_application', 'ip_disbursement',
    'purchase_receipt', 'transfer_proof', 'expense_documentation',
    'ptjb_document', 'reimbursement_payment', 'other_supporting_document'
  ));

alter table public.evidence_files
  drop constraint if exists evidence_files_file_size_bytes_check;
alter table public.evidence_files
  add constraint evidence_files_file_size_bytes_check
  check (file_size_bytes between 1 and 52428800);

create index if not exists evidence_files_ir_status_idx
  on public.evidence_files (ir_record_id, status)
  where ir_record_id is not null;
create index if not exists evidence_files_unlinked_uploaded_idx
  on public.evidence_files (uploaded_at desc)
  where status = 'active'
    and expense_id is null
    and ip_record_id is null
    and settlement_id is null
    and reimbursement_payment_id is null
    and ir_record_id is null;

insert into public.system_settings (key, value, description)
values (
  'evidence_max_file_size_bytes',
  '10485760'::jsonb,
  'Maximum evidence upload size in bytes; configurable from Evidence Center (1–50 MiB).'
)
on conflict (key) do nothing;

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
 where id = 'faams-evidence';

drop policy if exists faams_evidence_admin_orphan_delete on storage.objects;
create policy faams_evidence_admin_orphan_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'faams-evidence'
    and (select public.is_admin())
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and not exists (
      select 1
        from public.evidence_files as evidence
       where evidence.storage_bucket = 'faams-evidence'
         and evidence.object_path = storage.objects.name
    )
  );

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
       and num_nonnulls(
         old.expense_id, old.ip_record_id, old.settlement_id,
         old.reimbursement_payment_id, old.ir_record_id
       ) > 0
       and (
         new.expense_id is distinct from old.expense_id
         or new.ip_record_id is distinct from old.ip_record_id
         or new.settlement_id is distinct from old.settlement_id
         or new.reimbursement_payment_id is distinct from old.reimbursement_payment_id
         or new.ir_record_id is distinct from old.ir_record_id
       ) then
      raise exception 'Linked evidence cannot be moved to another financial record'
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
       and v_parent_type not in ('ip', 'expense', 'reimbursement_payment'))
  then
    raise exception 'Evidence category % is not valid for parent type %',
      new.document_type, v_parent_type using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_validate_relationship on public.evidence_files;
create trigger evidence_validate_relationship
  before insert or update of document_type, expense_id, ip_record_id,
    settlement_id, reimbursement_payment_id, ir_record_id
  on public.evidence_files
  for each row execute procedure public.validate_evidence_relationship();

create or replace function public.link_evidence_file(
  p_evidence_file_id uuid,
  p_parent_type text,
  p_parent_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidence public.evidence_files%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  select * into v_evidence
    from public.evidence_files
   where id = p_evidence_file_id
   for update;
  if not found or v_evidence.status <> 'active'
     or num_nonnulls(
       v_evidence.expense_id, v_evidence.ip_record_id, v_evidence.settlement_id,
       v_evidence.reimbursement_payment_id, v_evidence.ir_record_id
     ) <> 0 then
    raise exception 'Only active, unlinked evidence can be attached'
      using errcode = '23514';
  end if;

  case p_parent_type
    when 'ip' then
      update public.evidence_files set ip_record_id = p_parent_id
       where id = p_evidence_file_id;
    when 'ir' then
      update public.evidence_files set ir_record_id = p_parent_id
       where id = p_evidence_file_id;
    when 'expense' then
      update public.evidence_files set expense_id = p_parent_id
       where id = p_evidence_file_id;
    when 'settlement' then
      update public.evidence_files set settlement_id = p_parent_id
       where id = p_evidence_file_id;
    when 'reimbursement_payment' then
      update public.evidence_files set reimbursement_payment_id = p_parent_id
       where id = p_evidence_file_id;
    else
      raise exception 'Unsupported evidence parent type'
        using errcode = '22023';
  end case;
end;
$$;

create or replace view public.evidence_center
with (security_invoker = true)
as
select
  evidence.id,
  evidence.expense_id,
  evidence.ip_record_id,
  evidence.settlement_id,
  evidence.reimbursement_payment_id,
  evidence.ir_record_id,
  evidence.storage_bucket,
  evidence.object_path,
  evidence.original_file_name,
  evidence.system_file_name,
  evidence.document_type,
  case
    when evidence.document_type in (
      'ip_application', 'ip_disbursement', 'purchase_receipt',
      'transfer_proof', 'expense_documentation', 'fund_return',
      'ptjb_document', 'reimbursement_payment', 'other_supporting_document'
    ) then evidence.document_type
    when evidence.document_type in ('receipt', 'invoice') then
      case when evidence.expense_id is not null
        then 'purchase_receipt' else 'expense_documentation' end
    when evidence.document_type = 'bank_transfer' then
      case
        when evidence.reimbursement_payment_id is not null then 'reimbursement_payment'
        when evidence.ip_record_id is not null then 'ip_disbursement'
        else 'transfer_proof'
      end
    when evidence.document_type in ('fund_return', 'settlement') then 'fund_return'
    when evidence.document_type = 'approval' then
      case
        when evidence.ir_record_id is not null then 'ptjb_document'
        when evidence.ip_record_id is not null then 'ip_application'
        else 'expense_documentation'
      end
    else 'other_supporting_document'
  end as evidence_category,
  evidence.mime_type,
  evidence.file_size_bytes,
  evidence.uploaded_by,
  evidence.uploaded_at,
  evidence.status,
  case
    when evidence.ir_record_id is not null then 'ir'
    when evidence.expense_id is not null then 'expense'
    when evidence.ip_record_id is not null then 'ip'
    when evidence.settlement_id is not null then 'settlement'
    when evidence.reimbursement_payment_id is not null then 'reimbursement_payment'
    else 'unlinked'
  end as parent_type,
  coalesce(
    evidence.ir_record_id,
    evidence.expense_id,
    evidence.ip_record_id,
    evidence.settlement_id,
    evidence.reimbursement_payment_id
  ) as parent_id,
  coalesce(
    direct_ir.reference_code,
    direct_ip.reference_code,
    expense_ip.reference_code,
    transaction_ir.reference_code,
    transaction.reference_code,
    expense.description,
    settlement_ip.reference_code,
    payment_ir.reference_code
  ) as parent_reference,
  coalesce(
    direct_ir.title,
    direct_ip.title,
    expense.description,
    transaction_ir.title,
    settlement_ip.title,
    payment_ir.title
  ) as parent_description,
  concat_ws(
    ' ',
    evidence.original_file_name,
    evidence.system_file_name,
    direct_ir.reference_code,
    direct_ir.title,
    direct_ip.reference_code,
    direct_ip.title,
    expense_ip.reference_code,
    expense_ip.title,
    transaction_ir.reference_code,
    transaction_ir.title,
    transaction.reference_code,
    settlement_ip.reference_code,
    settlement_ip.title,
    payment_ir.reference_code,
    payment_ir.title,
    evidence.id::text,
    evidence.expense_id::text,
    evidence.ip_record_id::text,
    evidence.ir_record_id::text,
    evidence.settlement_id::text,
    evidence.reimbursement_payment_id::text
  ) as search_text
from public.evidence_files as evidence
left join public.ir_records as direct_ir
  on direct_ir.id = evidence.ir_record_id
left join public.ip_records as direct_ip
  on direct_ip.id = evidence.ip_record_id
left join public.expenses as expense
  on expense.id = evidence.expense_id
left join public.ip_records as expense_ip
  on expense_ip.id = expense.ip_record_id
left join public.ir_transactions as transaction
  on transaction.id = expense.ir_transaction_id
left join public.ir_records as transaction_ir
  on transaction_ir.id = transaction.ir_record_id
left join public.settlements as settlement
  on settlement.id = evidence.settlement_id
left join public.ip_records as settlement_ip
  on settlement_ip.id = settlement.ip_record_id
left join public.reimbursement_payments as payment
  on payment.id = evidence.reimbursement_payment_id
left join public.ir_records as payment_ir
  on payment_ir.id = payment.ir_record_id;

revoke all on public.evidence_center from public, anon, authenticated;
grant select on public.evidence_center to authenticated;

revoke all on function public.link_evidence_file(uuid, text, uuid)
  from public, anon;
grant execute on function public.link_evidence_file(uuid, text, uuid)
  to authenticated;
