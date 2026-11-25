import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type IPApplicationFormSettings = {
  company_name: string;
  regional_name: string;
  department_name: string;
  area_name: string;
  submitter_title: string;
  submitter_name: string;
  submitter_employee_id: string;
  submitter_signature_path: string;
  approver_title: string;
  approver_name: string;
  approver_employee_id: string;
  approver_signature_path: string;
  logo_path: string;
};

const defaultSettings: IPApplicationFormSettings = {
  company_name: "",
  regional_name: "",
  department_name: "",
  area_name: "",
  submitter_title: "",
  submitter_name: "",
  submitter_employee_id: "",
  submitter_signature_path: "",
  approver_title: "",
  approver_name: "",
  approver_employee_id: "",
  approver_signature_path: "",
  logo_path: "",
};

export type ExportImage = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
};

export type IPApplicationExportData = {
  record: Database["public"]["Views"]["ip_monitoring"]["Row"];
  directRealizationAmount: number;
  directUnsettledBalance: number | null;
  items: Array<{
    description: string;
    quantity: number;
    unit_cost: number;
    requested_amount: number;
    category_name: string;
    notes: string | null;
  }>;
  settings: IPApplicationFormSettings;
  images: {
    logo: ExportImage | null;
    submitterSignature: ExportImage | null;
    approverSignature: ExportImage | null;
  };
};

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIPApplicationFormSettings(value: Json | null | undefined): IPApplicationFormSettings {
  if (!value || !isJsonObject(value)) return { ...defaultSettings };
  const settingValue = (key: keyof IPApplicationFormSettings) =>
    typeof value[key] === "string" ? value[key] : "";
  return {
    company_name: settingValue("company_name"),
    regional_name: settingValue("regional_name"),
    department_name: settingValue("department_name"),
    area_name: settingValue("area_name"),
    submitter_title: settingValue("submitter_title"),
    submitter_name: settingValue("submitter_name"),
    submitter_employee_id: settingValue("submitter_employee_id"),
    submitter_signature_path: settingValue("submitter_signature_path"),
    approver_title: settingValue("approver_title"),
    approver_name: settingValue("approver_name"),
    approver_employee_id: settingValue("approver_employee_id"),
    approver_signature_path: settingValue("approver_signature_path"),
    logo_path: settingValue("logo_path"),
  };
}

export async function loadIPApplicationImage(
  client: Client,
  path: string,
): Promise<ExportImage | null> {
  if (!path) return null;
  const { data, error } = await client.storage.from("faams-evidence").download(path);
  if (error) throw new Error(`Gambar template IP gagal dimuat: ${error.message}`);
  const mimeType = data.type === "image/png" ? "image/png" : data.type === "image/jpeg" ? "image/jpeg" : null;
  if (!mimeType) throw new Error("File logo atau tanda tangan harus berupa PNG atau JPG.");
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType };
}

export async function getIPApplicationExportData(
  client: Client,
  ipId: string,
): Promise<IPApplicationExportData | null> {
  const [
    { data: record, error: recordError },
    { data: budgetItems, error: budgetError },
    { data: settingRow, error: settingError },
    { data: ipOwner, error: ownerError },
    { data: directMovements, error: directMovementsError },
  ] = await Promise.all([
    client.from("ip_monitoring").select("*").eq("id", ipId).maybeSingle(),
    client.from("ip_budget_items")
      .select("description, quantity, unit_cost, requested_amount, category_id, notes")
      .eq("ip_record_id", ipId)
      .eq("status", "active")
      .order("created_at"),
    client.from("system_settings").select("value").eq("key", "ip_application_form").maybeSingle(),
    client.from("ip_records").select("created_by").eq("id", ipId).maybeSingle(),
    client.from("transaction_ledger")
      .select("credit")
      .eq("related_ip_id", ipId)
      .is("related_ir_id", null)
      .eq("ir_replenishment", false)
      .eq("movement_type", "expense"),
  ]);
  if (recordError) throw new Error(`Data IP gagal dimuat: ${recordError.message}`);
  if (budgetError) throw new Error(`Item pengajuan IP gagal dimuat: ${budgetError.message}`);
  if (settingError) throw new Error(`Pengaturan form IP gagal dimuat: ${settingError.message}`);
  if (ownerError) throw new Error(`Pemilik pengajuan IP gagal dimuat: ${ownerError.message}`);
  if (directMovementsError) throw new Error(`Realisasi langsung IP gagal dimuat: ${directMovementsError.message}`);
  if (!record) return null;
  if (record.status === "void") throw new Error("Pengajuan IP berstatus void tidak dapat diekspor.");
  if (!settingRow) throw new Error("Pengaturan template form IP belum tersedia. Jalankan migration terbaru.");

  const settings = parseIPApplicationFormSettings(settingRow.value);
  const { data: applicant, error: applicantError } = ipOwner?.created_by
    ? await client
      .from("profiles")
      .select("display_name, employee_id, signature_path")
      .eq("id", ipOwner.created_by)
      .maybeSingle()
    : { data: null, error: null };
  if (applicantError) throw new Error(`Profil pemohon IP gagal dimuat: ${applicantError.message}`);
  if (!applicant?.signature_path) {
    throw new Error("Tanda tangan profil pemohon IP belum tersedia.");
  }
  settings.submitter_name = applicant.display_name ?? "";
  settings.submitter_employee_id = applicant.employee_id ?? "";
  settings.submitter_signature_path = applicant.signature_path;
  const categoryIds = [...new Set(budgetItems.map((item) => item.category_id))];
  const { data: categories, error: categoryError } = categoryIds.length
    ? await client.from("categories").select("id, name").in("id", categoryIds)
    : { data: [], error: null };
  if (categoryError) throw new Error(`Kategori pengajuan IP gagal dimuat: ${categoryError.message}`);
  const categoryNames = new Map((categories ?? []).map((category) => [category.id, category.name]));
  const directRealizationAmount = directMovements.reduce((total, movement) => total + movement.credit, 0);
  const [logo, submitterSignature, approverSignature] = await Promise.all([
    loadIPApplicationImage(client, settings.logo_path),
    loadIPApplicationImage(client, settings.submitter_signature_path),
    loadIPApplicationImage(client, settings.approver_signature_path),
  ]);

  return {
    record,
    directRealizationAmount,
    directUnsettledBalance: record.disbursement_date
      ? record.disbursed_amount - directRealizationAmount - record.returned_amount
      : null,
    items: budgetItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      requested_amount: item.requested_amount,
      category_name: categoryNames.get(item.category_id) ?? "Kategori tidak ditemukan",
      notes: item.notes,
    })),
    settings,
    images: { logo, submitterSignature, approverSignature },
  };
}
