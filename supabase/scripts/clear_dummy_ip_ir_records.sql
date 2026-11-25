-- One-time cleanup for dummy IP and IR records.
-- By default this script refuses to delete anything. Change 'no' to 'yes'
-- only after reviewing the preview counts and confirming the target project.

select
  (select count(*) from public.ip_records) as ip_records,
  (select count(*) from public.ir_records) as ir_records,
  (select count(*) from public.ip_budget_items) as ip_budget_items,
  (select count(*) from public.ir_transactions) as ir_transactions,
  (select count(*) from public.expenses) as expenses,
  (select count(*) from public.transaction_allocations) as allocations,
  (select count(*) from public.settlements) as settlements,
  (select count(*) from public.reimbursement_payments) as reimbursement_payments,
  (select count(*) from public.evidence_files) as evidence_files;

drop table if exists pg_temp.faams_cleanup_ip_ids;
drop table if exists pg_temp.faams_cleanup_ir_ids;
drop table if exists pg_temp.faams_cleanup_ir_transaction_ids;
drop table if exists pg_temp.faams_cleanup_expense_ids;
drop table if exists pg_temp.faams_cleanup_allocation_ids;
drop table if exists pg_temp.faams_cleanup_settlement_ids;
drop table if exists pg_temp.faams_cleanup_payment_ids;
drop table if exists pg_temp.faams_cleanup_evidence_paths;
drop table if exists pg_temp.faams_cleanup_movement_ids;

begin;

set local faams.confirm_dummy_data_delete = 'yes';

do $$
begin
  if current_setting('faams.confirm_dummy_data_delete', true) <> 'yes' then
    raise exception
      'Deletion cancelled. Review the counts, then change faams.confirm_dummy_data_delete from no to yes.';
  end if;
end;
$$;

create temporary table faams_cleanup_ip_ids on commit preserve rows as
select id from public.ip_records;

create temporary table faams_cleanup_ir_ids on commit preserve rows as
select id from public.ir_records;

create temporary table faams_cleanup_ir_transaction_ids on commit preserve rows as
select id
  from public.ir_transactions
 where ir_record_id in (select id from faams_cleanup_ir_ids);

create temporary table faams_cleanup_expense_ids on commit preserve rows as
select expense.id
  from public.expenses as expense
 where expense.ip_record_id in (select id from faams_cleanup_ip_ids)
    or expense.ir_transaction_id in (
      select id from faams_cleanup_ir_transaction_ids
    )
    or expense.related_ir_record_id in (select id from faams_cleanup_ir_ids);

create temporary table faams_cleanup_allocation_ids on commit preserve rows as
select allocation.id
  from public.transaction_allocations as allocation
 where allocation.expense_id in (select id from faams_cleanup_expense_ids)
    or allocation.ip_record_id in (select id from faams_cleanup_ip_ids);

create temporary table faams_cleanup_settlement_ids on commit preserve rows as
select id
  from public.settlements
 where ip_record_id in (select id from faams_cleanup_ip_ids);

create temporary table faams_cleanup_payment_ids on commit preserve rows as
select id
  from public.reimbursement_payments
 where ir_record_id in (select id from faams_cleanup_ir_ids);

create temporary table faams_cleanup_evidence_paths on commit preserve rows as
select distinct storage_bucket, object_path
  from public.evidence_files as evidence
 where evidence.expense_id in (select id from faams_cleanup_expense_ids)
    or evidence.ip_record_id in (select id from faams_cleanup_ip_ids)
    or evidence.settlement_id in (select id from faams_cleanup_settlement_ids)
    or evidence.reimbursement_payment_id in (
      select id from faams_cleanup_payment_ids
    )
    or evidence.ir_record_id in (select id from faams_cleanup_ir_ids);

create temporary table faams_cleanup_movement_ids on commit preserve rows as
select movement.id
  from public.fund_movements as movement
 where movement.ip_record_id in (select id from faams_cleanup_ip_ids)
    or movement.related_ir_record_id in (select id from faams_cleanup_ir_ids)
    or movement.allocation_id in (select id from faams_cleanup_allocation_ids)
    or movement.settlement_id in (select id from faams_cleanup_settlement_ids);

-- Submitted IRs are protected by deferred completeness constraint triggers.
-- Downgrade the selected records first, then flush those checks while their
-- parent rows still exist. Keep the triggers immediate during child deletion.
update public.ir_records
   set status = 'draft',
       ptjb_status = 'not_submitted'
 where id in (select id from faams_cleanup_ir_ids);

set constraints
  ir_records_completeness,
  ir_transactions_completeness,
  expenses_completeness,
  evidence_completeness
immediate;

-- Save this result before the deletions. SQL cannot remove the actual Storage
-- objects; use these bucket/path values to remove the files from Supabase Storage.
select storage_bucket, object_path
  from faams_cleanup_evidence_paths
 order by storage_bucket, object_path;

delete from public.fund_movements
 where id in (select id from faams_cleanup_movement_ids);

delete from public.evidence_files
 where expense_id in (select id from faams_cleanup_expense_ids)
    or ip_record_id in (select id from faams_cleanup_ip_ids)
    or settlement_id in (select id from faams_cleanup_settlement_ids)
    or reimbursement_payment_id in (select id from faams_cleanup_payment_ids)
    or ir_record_id in (select id from faams_cleanup_ir_ids);

delete from public.transaction_allocations
 where id in (select id from faams_cleanup_allocation_ids);

delete from public.expenses
 where id in (select id from faams_cleanup_expense_ids);

delete from public.ir_transactions
 where id in (select id from faams_cleanup_ir_transaction_ids);

delete from public.settlements
 where id in (select id from faams_cleanup_settlement_ids);

delete from public.reimbursement_payments
 where id in (select id from faams_cleanup_payment_ids);

delete from public.ip_budget_items
 where ip_record_id in (select id from faams_cleanup_ip_ids);

delete from public.ip_records
 where id in (select id from faams_cleanup_ip_ids);

delete from public.ir_records
 where id in (select id from faams_cleanup_ir_ids);

commit;

select
  (select count(*) from faams_cleanup_ip_ids) as deleted_ip_records,
  (select count(*) from faams_cleanup_ir_ids) as deleted_ir_records,
  (select count(*) from faams_cleanup_expense_ids) as deleted_expenses,
  (select count(*) from faams_cleanup_evidence_paths) as storage_files_to_remove_manually,
  (select count(*) from public.ip_records) as remaining_ip_records,
  (select count(*) from public.ir_records) as remaining_ir_records;
