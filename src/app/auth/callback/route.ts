import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("next");
  const nextPath = getSafeRedirectPath(requestedPath);
  const destination = new URL(nextPath, request.url);

  if (!isSupabaseConfigured()) {
    destination.pathname = "/login";
    destination.searchParams.set("error", "configuration");
    return NextResponse.redirect(destination);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(destination);
    }

    console.error("Supabase auth callback could not exchange its code.", error);
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "callback");
  return NextResponse.redirect(loginUrl);
}
