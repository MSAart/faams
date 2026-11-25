import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "configuration");
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    config.url,
    config.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  const missingSession = error?.name === "AuthSessionMissingError";
  if (error && !missingSession) {
    console.error("Supabase could not validate the current session.", error);
  }

  if (error || !data.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    if (error && !missingSession) {
      loginUrl.searchParams.set("error", "session");
    }

    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/internal-prepayment/:path*",
    "/ir-operasional/:path*",
    "/ir-facility-management/:path*",
    "/transaction-ledger/:path*",
    "/reconciliation/:path*",
    "/evidence-center/:path*",
    "/deadline-monitoring/:path*",
    "/reports-export/:path*",
    "/monthly-closing/:path*",
    "/audit-trail/:path*",
    "/settings/:path*",
  ],
};
