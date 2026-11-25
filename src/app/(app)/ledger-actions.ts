"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LedgerActionState = { error?: string; success?: string };

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function recordFundAdjustmentAction(
  _previousState: LedgerActionState,
  formData: FormData,
): Promise<LedgerActionState> {
  const parsed = z.object({
    sourceType: z.enum(["ip", "personal"]),
    ipRecordId: z.string().uuid().or(z.literal("")),
    irRecordId: z.string().uuid().or(z.literal("")),
    direction: z.enum(["inflow", "outflow"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid."),
    amount: z.number().finite().positive("Nominal harus lebih dari nol."),
    reference: z.string().trim().max(120),
    description: z.string().trim().min(1, "Deskripsi wajib diisi.").max(300),
    reason: z.string().trim().min(1, "Alasan koreksi wajib diisi.").max(1000),
  }).safeParse({
    sourceType: text(formData, "source_type"),
    ipRecordId: text(formData, "ip_record_id"),
    irRecordId: text(formData, "ir_record_id"),
    direction: text(formData, "direction"),
    date: text(formData, "movement_date"),
    amount: Number(text(formData, "amount")),
    reference: text(formData, "reference"),
    description: text(formData, "description"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data koreksi tidak valid." };
  }
  if (
    (parsed.data.sourceType === "ip" && !parsed.data.ipRecordId) ||
    (parsed.data.sourceType === "personal" && parsed.data.ipRecordId)
  ) {
    return { error: "Pilih sumber IP yang sesuai dengan jenis pendanaan." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const { error } = await supabase.rpc("record_fund_adjustment", {
      p_source_type: parsed.data.sourceType,
      p_ip_record_id: parsed.data.ipRecordId || null,
      p_related_ir_record_id: parsed.data.irRecordId || null,
      p_direction: parsed.data.direction,
      p_movement_date: parsed.data.date,
      p_amount: parsed.data.amount,
      p_reference: parsed.data.reference || null,
      p_description: parsed.data.description,
      p_reason: parsed.data.reason,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    revalidatePath("/internal-prepayment");
    revalidatePath("/ir-operasional");
    revalidatePath("/ir-facility-management");
    return { success: "Koreksi saldo berhasil dicatat dan masuk ke audit trail." };
  } catch (error) {
    console.error("Fund adjustment action failed.", error);
    return {
      error: error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba kembali.",
    };
  }
}
