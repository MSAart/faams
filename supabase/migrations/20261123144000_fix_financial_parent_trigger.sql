create or replace function public.validate_financial_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if tg_table_name = 'ir_transactions' then
    if new.ir_record_id is distinct from old.ir_record_id then
      raise exception 'An IR transaction cannot be moved to another IR'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'expenses' then
    if new.ip_record_id is distinct from old.ip_record_id
       or new.ir_transaction_id is distinct from old.ir_transaction_id then
      raise exception 'An expense cannot be moved to another financial record'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'transaction_allocations' then
    if new.expense_id is distinct from old.expense_id then
      raise exception 'An allocation cannot be moved to another expense'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'evidence_files' then
    if num_nonnulls(
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
    end if;
  elsif tg_table_name = 'settlements' then
    if new.ip_record_id is distinct from old.ip_record_id then
      raise exception 'A settlement cannot be moved to another IP'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'reimbursement_payments' then
    if new.ir_record_id is distinct from old.ir_record_id then
      raise exception 'A reimbursement payment cannot be moved to another IR'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
