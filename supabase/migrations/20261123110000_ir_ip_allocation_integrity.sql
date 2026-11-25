update public.transaction_allocations as allocation
   set updated_at = now()
  from public.expenses as expense
  join public.ir_transactions as transaction
    on transaction.id = expense.ir_transaction_id
   and transaction.status = 'active'
 where expense.id = allocation.expense_id
   and expense.status = 'posted'
   and allocation.source_type = 'ip'
   and allocation.status = 'active'
   and not exists (
     select 1
       from public.fund_movements as movement
      where movement.allocation_id = allocation.id
        and not movement.is_void
        and movement.movement_type = 'expense'
        and movement.direction = 'outflow'
        and movement.source_type = 'ip'
        and movement.ip_record_id = allocation.ip_record_id
        and movement.amount = allocation.amount
   );

create or replace function public.ip_has_unreturned_ir_allocations(
  p_ip_record_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ir_transactions as transaction
      join public.expenses as expense
        on expense.ir_transaction_id = transaction.id
       and expense.status = 'posted'
      join public.transaction_allocations as allocation
        on allocation.expense_id = expense.id
       and allocation.status = 'active'
       and allocation.source_type = 'ip'
       and allocation.ip_record_id = p_ip_record_id
     where transaction.status = 'active'
     group by transaction.ir_record_id, allocation.ip_record_id
    having sum(allocation.amount) > coalesce((
      select sum(movement.amount)
        from public.fund_movements as movement
       where movement.related_ir_record_id = transaction.ir_record_id
         and movement.ip_record_id = allocation.ip_record_id
         and movement.ir_replenishment
         and not movement.is_void
    ), 0)
  );
$$;

create or replace function public.prevent_ip_settlement_with_unreturned_ir_funds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('settled', 'closed')
     and public.ip_has_unreturned_ir_allocations(new.id) then
    raise exception 'IP cannot be settled until all IP-funded IR allocations are returned to this IP'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.ip_has_unreturned_ir_allocations(uuid)
  from public, anon, authenticated;
revoke all on function public.prevent_ip_settlement_with_unreturned_ir_funds()
  from public, anon, authenticated;

drop trigger if exists ip_records_require_ir_replenishment on public.ip_records;
create trigger ip_records_require_ir_replenishment
  before update of status on public.ip_records
  for each row execute procedure public.prevent_ip_settlement_with_unreturned_ir_funds();

notify pgrst, 'reload schema';
