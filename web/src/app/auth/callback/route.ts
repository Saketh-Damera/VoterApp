import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

// Supabase email-confirmation links land here. We exchange the one-time
// code for a session cookie, then send the user home (or to /login on
// failure). Without this route, signups that need email confirmation are
// stuck after the user clicks the link.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/login?auth_error=${encodeURIComponent(errorParam)}`, req.url),
    );
  }

  if (code) {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?auth_error=${encodeURIComponent(error.message)}`, req.url),
      );
    }
  }

  return NextResponse.redirect(new URL("/", req.url));
}
