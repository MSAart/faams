export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type Timestamped = {
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        is_admin: boolean;
        employee_id: string | null;
        signature_path: string | null;
        created_at: string;
        updated_at: string;
      }>;
      system_settings: Table<{
        id: string;
        key: string;
        value: Json;
        description: string | null;
        updated_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      categories: Table<
        Timestamped & {
          id: string;
          code: string;
          name: string;
          scope: "operasional" | "facility";
          is_active: boolean;
        }
      >;
      holidays: Table<
        Timestamped & {
          id: string;
          holiday_date: string;
          name: string;
          holiday_type: "national" | "company";
          source: string | null;
          is_active: boolean;
          created_by: string | null;
        }
      >;
      ip_records: Table<
        Timestamped & {
          id: string;
          reference_code: string | null;
          title: string;
          purpose: string;
          requested_on: string;
          requested_amount: number;
          project_start_date: string | null;
          project_end_date: string | null;
          project_location: string | null;
          disbursed_amount: number;
          disbursement_date: string | null;
          department_area: string | null;
          pic_name: string | null;
          disbursement_reference: string | null;
          recipient_details: string | null;
          disbursement_notes: string | null;
          status:
            | "draft"
            | "submitted"
            | "approved"
            | "disbursed"
            | "settlement_in_progress"
            | "settled"
            | "closed"
            | "void";
          void_reason: string | null;
          notes: string | null;
          created_by: string | null;
        }
      >;
      ip_budget_items: Table<
        Timestamped & {
          id: string;
          ip_record_id: string;
          category_id: string;
          description: string;
          quantity: number;
          unit_cost: number;
          requested_amount: number;
          notes: string | null;
          status: "active" | "void";
          void_reason: string | null;
        }
      >;
      ir_records: Table<
        Timestamped & {
          id: string;
          reference_code: string | null;
          ir_type: "operasional" | "facility";
          title: string;
          purpose: string;
          pic_name: string | null;
          submitted_on: string | null;
          period_start: string | null;
          period_end: string | null;
          status:
            | "draft"
            | "submitted"
            | "approved"
            | "rejected"
            | "completed"
            | "void";
          ptjb_status:
            | "not_submitted"
            | "in_progress"
            | "submitted"
            | "approved"
            | "rejected";
          payment_status: "unpaid" | "partially_paid" | "paid";
          void_reason: string | null;
          notes: string | null;
          created_by: string | null;
        }
      >;
      ir_transactions: Table<
        Timestamped & {
          id: string;
          ir_record_id: string;
          reference_code: string | null;
          transaction_date: string;
          description: string;
          notes: string | null;
          status: "active" | "void";
          void_reason: string | null;
        }
      >;
      expenses: Table<
        Timestamped & {
          id: string;
          ip_record_id: string | null;
          ip_budget_item_id: string | null;
          ir_transaction_id: string | null;
          related_ir_record_id: string | null;
          category_id: string;
          expense_date: string;
          description: string;
          vendor: string | null;
          amount: number;
          payment_method: "cash" | "transfer" | "card" | "other" | null;
          ip_usage_status: "verified" | "pending_review" | "linked_ir";
          ip_mismatch_reason: string | null;
          ip_resolution_note: string | null;
          status: "posted" | "void";
          void_reason: string | null;
          created_by: string | null;
        }
      >;
      transaction_allocations: Table<
        Timestamped & {
          id: string;
          expense_id: string;
          source_type: "ip" | "personal";
          ip_record_id: string | null;
          personal_profile_id: string | null;
          amount: number;
          status: "active" | "void";
          void_reason: string | null;
          notes: string | null;
        }
      >;
      fund_movements: Table<
        Timestamped & {
          id: string;
          movement_type: "disbursement" | "expense" | "return" | "adjustment";
          direction: "inflow" | "outflow";
          source_type: "ip" | "personal";
          ip_record_id: string | null;
          personal_profile_id: string | null;
          allocation_id: string | null;
          settlement_id: string | null;
          reference_code: string | null;
          related_ir_record_id: string | null;
          correction_reason: string | null;
          ir_replenishment: boolean;
          ir_replenishment_manual: boolean;
          movement_date: string;
          amount: number;
          description: string;
          is_void: boolean;
          void_reason: string | null;
        }
      >;
      evidence_files: Table<
        Timestamped & {
          id: string;
          expense_id: string | null;
          ip_record_id: string | null;
          settlement_id: string | null;
          reimbursement_payment_id: string | null;
          ir_record_id: string | null;
          storage_bucket: "faams-evidence";
          object_path: string;
          original_file_name: string;
          system_file_name: string;
          document_type:
            | "receipt"
            | "invoice"
            | "approval"
            | "settlement"
            | "bank_transfer"
            | "fund_return"
            | "other"
            | "ip_application"
            | "ip_disbursement"
            | "purchase_receipt"
            | "transfer_proof"
            | "expense_documentation"
            | "ptjb_document"
            | "reimbursement_payment"
            | "other_supporting_document";
          mime_type: "image/jpeg" | "image/png" | "application/pdf";
          file_size_bytes: number;
          uploaded_by: string | null;
          uploaded_at: string;
          status: "active" | "void";
          void_reason: string | null;
        }
      >;
      settlements: Table<
        Timestamped & {
          id: string;
          ip_record_id: string;
          settlement_date: string;
          amount_spent: number;
          amount_returned: number;
          return_method: "cash" | "transfer" | "other" | null;
          reference_code: string | null;
          status: "submitted" | "reviewed" | "void";
          void_reason: string | null;
          notes: string | null;
          created_by: string | null;
        }
      >;
      reimbursement_payments: Table<
        Timestamped & {
          id: string;
          ir_record_id: string;
          payment_date: string | null;
          amount: number;
          status: "pending" | "paid" | "void";
          reference_code: string | null;
          void_reason: string | null;
          notes: string | null;
          created_by: string | null;
        }
      >;
      monthly_closings: Table<
        Timestamped & {
          id: string;
          period_start: string;
          status: "open" | "closed" | "reopened";
          closed_at: string | null;
          closed_by: string | null;
          notes: string | null;
        }
      >;
      audit_logs: {
        Row: {
          id: string;
          entity_table: string;
          entity_id: string | null;
          action: "INSERT" | "UPDATE" | "DELETE";
          actor_id: string | null;
          old_data: Json | null;
          new_data: Json | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      transaction_ledger: {
        Row: {
          transaction_id: string;
          transaction_date: string;
          reference: string;
          description: string;
          debit: number;
          credit: number;
          funding_source: string;
          source_type: "ip" | "personal";
          movement_type: "disbursement" | "expense" | "return" | "adjustment" | "reimbursement_received";
          related_ip_id: string | null;
          related_ip_reference: string | null;
          related_ir_id: string | null;
          related_ir_reference: string | null;
          evidence_reference: string | null;
          evidence_count: number;
          correction_reason: string | null;
          is_void: boolean;
          search_text: string;
          related_expense_id: string | null;
          category_id: string | null;
          category_name: string | null;
          ir_type: "operasional" | "facility" | null;
          record_status: string | null;
          ir_replenishment: boolean;
        };
        Relationships: [];
      };
      reconciliation_balances: {
        Row: {
          entity_type: "ip" | "ir";
          entity_subtype: "operasional" | "facility" | null;
          entity_id: string;
          reference_code: string | null;
          description: string;
          activity_date: string | null;
          principal_amount: number;
          realized_amount: number;
          returned_amount: number;
          personal_funded_amount: number;
          reimbursement_paid_amount: number;
          balance_amount: number;
          outstanding_amount: number;
          reconciled_amount: number;
          record_status: string;
          discrepancy_count: number;
          reconciliation_status:
            | "Balance"
            | "Outstanding"
            | "Over Budget"
            | "Unverified"
            | "Discrepancy"
            | "Closed";
          discrepancy_detail: string | null;
          search_text: string;
        };
        Relationships: [];
      };
      reconciliation_summary: {
        Row: {
          ip_outstanding: number;
          ir_outstanding: number;
          personal_receivable: number;
          total_unreconciled: number;
          total_reconciled: number;
          discrepancy_count: number;
          unverified_count: number;
          over_budget_count: number;
        };
        Relationships: [];
      };
      evidence_center: {
        Row: {
          id: string;
          expense_id: string | null;
          ip_record_id: string | null;
          settlement_id: string | null;
          reimbursement_payment_id: string | null;
          ir_record_id: string | null;
          storage_bucket: "faams-evidence";
          object_path: string;
          original_file_name: string;
          system_file_name: string;
          document_type: Database["public"]["Tables"]["evidence_files"]["Row"]["document_type"];
          evidence_category:
            | "ip_application"
            | "ip_disbursement"
            | "purchase_receipt"
            | "transfer_proof"
            | "expense_documentation"
            | "fund_return"
            | "ptjb_document"
            | "reimbursement_payment"
            | "other_supporting_document";
          mime_type: Database["public"]["Tables"]["evidence_files"]["Row"]["mime_type"];
          file_size_bytes: number;
          uploaded_by: string | null;
          uploaded_at: string;
          status: "active" | "void";
          parent_type: "ip" | "ir" | "expense" | "settlement" | "reimbursement_payment" | "unlinked";
          parent_id: string | null;
          parent_reference: string | null;
          parent_description: string | null;
          search_text: string;
        };
        Relationships: [];
      };
      ir_monitoring: {
        Row: {
          id: string;
          reference_code: string | null;
          ir_type: "operasional" | "facility";
          title: string;
          purpose: string;
          pic_name: string | null;
          submitted_on: string | null;
          period_start: string | null;
          period_end: string | null;
          status: Database["public"]["Tables"]["ir_records"]["Row"]["status"];
          ptjb_status: Database["public"]["Tables"]["ir_records"]["Row"]["ptjb_status"];
          payment_status: Database["public"]["Tables"]["ir_records"]["Row"]["payment_status"];
          notes: string | null;
          transaction_count: number;
          total_amount: number;
          personal_amount: number;
          ip_amount: number;
          paid_amount: number;
          outstanding_amount: number;
          missing_evidence_count: number;
          workflow_status:
            | "Draft"
            | "Recorded"
            | "Evidence Incomplete"
            | "Ready for PTJB"
            | "PTJB Submitted"
            | "Reimbursement Outstanding"
            | "Partially Reimbursed"
            | "Reimbursed"
            | "Closed"
            | "Void";
        };
        Relationships: [];
      };
      ir_reporting_summary: {
        Row: {
          operational_total: number;
          facility_total: number;
          personal_funded_total: number;
          ip_funded_total: number;
          reimbursement_receivable_total: number;
          reimbursement_paid_total: number;
          reimbursement_outstanding_total: number;
        };
        Relationships: [];
      };
      ip_monitoring: {
        Row: {
          id: string;
          reference_code: string | null;
          title: string;
          purpose: string;
          requested_on: string;
          requested_amount: number;
          disbursed_amount: number;
          disbursement_date: string | null;
          status: Database["public"]["Tables"]["ip_records"]["Row"]["status"];
          department_area: string | null;
          pic_name: string | null;
          disbursement_reference: string | null;
          recipient_details: string | null;
          notes: string | null;
          target_settlement_date: string | null;
          administrative_deadline: string | null;
          valid_realization: number;
          returned_amount: number;
          unsettled_balance: number;
          discrepancy_count: number;
          project_start_date: string | null;
          project_end_date: string | null;
          project_location: string | null;
          ir_replenished_amount: number;
        };
        Relationships: [];
      };
      fund_movement_ledger: {
        Row: {
          id: string;
          movement_type: "disbursement" | "expense" | "return" | "adjustment";
          direction: "inflow" | "outflow";
          source_type: "ip" | "personal";
          ip_record_id: string | null;
          personal_profile_id: string | null;
          allocation_id: string | null;
          settlement_id: string | null;
          movement_date: string;
          amount: number;
          signed_amount: number;
          description: string;
          is_void: boolean;
          void_reason: string | null;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_profile_complete: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      available_ip_sources_for_ir: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          id: string;
          reference_code: string | null;
          title: string;
          unsettled_balance: number;
        }>;
      };
      reconciliation_period_summary: {
        Args: {
          p_from_date: string | null;
          p_to_date: string | null;
        };
        Returns: Array<{
          ip_debit: number;
          ip_credit: number;
          personal_debit: number;
          personal_credit: number;
          transaction_count: number;
        }>;
      };
      reconciliation_period_balances: {
        Args: {
          p_from_date: string | null;
          p_to_date: string | null;
        };
        Returns: Array<{
          entity_type: "ip" | "ir";
          entity_subtype: "operasional" | "facility" | null;
          entity_id: string;
          reference_code: string | null;
          description: string;
          ip_debit: number;
          ip_credit: number;
          personal_debit: number;
          personal_credit: number;
          movement_count: number;
        }>;
      };
      create_ir_record: {
        Args: {
          p_ir_type: "operasional" | "facility";
          p_submitted_on: string;
          p_pic_name: string;
          p_purpose: string;
          p_title: string;
          p_period_start: string | null;
          p_period_end: string | null;
          p_notes: string | null;
        };
        Returns: string;
      };
      set_ir_reference_code: {
        Args: {
          p_ir_record_id: string;
          p_reference_code: string;
        };
        Returns: undefined;
      };
      record_ir_transaction: {
        Args: {
          p_ir_record_id: string;
          p_transaction_date: string;
          p_category_id: string;
          p_description: string;
          p_vendor: string | null;
          p_amount: number;
          p_payment_method: "cash" | "transfer" | "card" | "other";
          p_allocations: Json;
          p_evidence: Json;
        };
        Returns: string;
      };
      edit_ir_transaction_expense: {
        Args: {
          p_expense_id: string;
          p_transaction_date: string;
          p_category_id: string;
          p_description: string;
          p_vendor: string | null;
          p_amount: number;
          p_payment_method: "cash" | "transfer" | "card" | "other";
          p_allocations: Json;
          p_evidence?: Json;
        };
        Returns: undefined;
      };
      set_ir_ptjb_status: {
        Args: {
          p_ir_record_id: string;
          p_next_status: "submitted" | "approved";
        };
        Returns: undefined;
      };
      record_ir_reimbursement_payment: {
        Args: {
          p_ir_record_id: string;
          p_payment_date: string;
          p_amount: number;
          p_reference: string | null;
          p_notes: string | null;
          p_evidence: Json;
        };
        Returns: string;
      };
      record_ir_ip_replenishment: {
        Args: {
          p_ir_record_id: string;
          p_replenishment_date: string;
          p_reference: string | null;
          p_notes: string;
          p_evidence: Json;
        };
        Returns: undefined;
      };
      close_ir_record: {
        Args: { p_ir_record_id: string };
        Returns: undefined;
      };
      link_evidence_file: {
        Args: {
          p_evidence_file_id: string;
          p_parent_type: string;
          p_parent_id: string;
        };
        Returns: undefined;
      };
      create_ip_application: {
        Args: {
          p_title: string;
          p_purpose: string;
          p_requested_on: string;
          p_department_area: string | null;
          p_pic_name: string | null;
          p_notes: string | null;
          p_budget_items: Json;
          p_project_start_date?: string | null;
          p_project_end_date?: string | null;
          p_project_location?: string | null;
        };
        Returns: string;
      };
      set_ip_reference_code: {
        Args: {
          p_ip_record_id: string;
          p_reference_code: string;
        };
        Returns: undefined;
      };
      record_ip_disbursement: {
        Args: {
          p_ip_record_id: string;
          p_disbursement_date: string;
          p_amount: number;
          p_reference: string | null;
          p_recipient_details: string | null;
          p_notes: string | null;
          p_evidence: Json;
        };
        Returns: undefined;
      };
      record_ip_expense: {
        Args: {
          p_ip_record_id: string;
          p_expense_date: string;
          p_budget_item_id: string;
          p_description: string;
          p_vendor: string | null;
          p_amount: number;
          p_payment_method: "cash" | "transfer" | "card" | "other";
          p_is_consistent: boolean;
          p_mismatch_reason: string | null;
          p_evidence: Json;
        };
        Returns: string;
      };
      edit_ip_realization: {
        Args: {
          p_ip_record_id: string;
          p_expense_id: string;
          p_expense_date: string;
          p_budget_item_id: string;
          p_description: string;
          p_vendor: string | null;
          p_amount: number;
          p_payment_method: "cash" | "transfer" | "card" | "other";
          p_evidence?: Json;
        };
        Returns: undefined;
      };
      resolve_ip_discrepancy: {
        Args: {
          p_expense_id: string;
          p_action: "verify" | "link_ir" | "create_ir";
          p_resolution_note: string;
          p_ir_record_id?: string | null;
          p_ir_type?: "operasional" | "facility" | null;
        };
        Returns: string | null;
      };
      record_ip_return: {
        Args: {
          p_ip_record_id: string;
          p_return_date: string;
          p_amount: number;
          p_return_method: "cash" | "transfer" | "other";
          p_reference: string | null;
          p_notes: string | null;
          p_evidence: Json;
        };
        Returns: string;
      };
      record_fund_adjustment: {
        Args: {
          p_source_type: "ip" | "personal";
          p_ip_record_id: string | null;
          p_related_ir_record_id: string | null;
          p_direction: "inflow" | "outflow";
          p_movement_date: string;
          p_amount: number;
          p_reference: string | null;
          p_description: string;
          p_reason: string;
        };
        Returns: string;
      };
      close_ip_settlement: {
        Args: {
          p_ip_record_id: string;
          p_settlement_date: string;
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      calculate_working_days: {
        Args: { p_start_date: string; p_end_date: string };
        Returns: number;
      };
      calculate_deadline: {
        Args: { p_disbursement_date: string; p_working_days: number };
        Returns: string;
      };
      save_ip_application_form_settings: {
        Args: { p_value: Json };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
