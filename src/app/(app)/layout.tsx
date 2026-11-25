import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (error.name !== "AuthSessionMissingError") {
      console.error("Could not load the authenticated FAAMS user.", error);
      redirect("/login?error=session");
    }
    redirect("/login");
  }
  if (!data.user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin, display_name, employee_id, signature_path")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "Could not verify the FAAMS user profile.",
      profileError,
    );
    redirect("/login?error=profile");
  }
  if (
    !profile ||
    !profile.display_name?.trim() ||
    !profile.employee_id?.trim() ||
    !profile.signature_path
  ) {
    redirect("/onboarding");
  }

  const isAdmin = profile.is_admin;
  const email = data.user.email ?? "";
  const metadataName =
    data.user.user_metadata?.full_name ?? data.user.user_metadata?.name;
  const displayName =
    profile.display_name?.trim() ||
    (typeof metadataName === "string" ? metadataName.trim() : "") ||
    email.split("@")[0] ||
    "Pengguna FAAMS";

  return (
    <AppShell email={email} displayName={displayName} isAdmin={isAdmin}>
      {children}
    </AppShell>
  );
}
