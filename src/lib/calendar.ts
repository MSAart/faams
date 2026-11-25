import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function calculateWorkingDays(
  startDate: string,
  endDate: string,
): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("calculate_working_days", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    throw new Error("Could not calculate working days.", { cause: error });
  }
  if (data === null) {
    throw new Error("Working-day calculation returned no result.");
  }
  return data;
}

export async function calculateDeadline(
  disbursementDate: string,
  workingDays: number,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("calculate_deadline", {
    p_disbursement_date: disbursementDate,
    p_working_days: workingDays,
  });

  if (error) {
    throw new Error("Could not calculate the working-day deadline.", {
      cause: error,
    });
  }
  if (data === null) {
    throw new Error("Deadline calculation returned no result.");
  }
  return data;
}
