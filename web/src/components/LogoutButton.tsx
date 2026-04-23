"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export default function LogoutButton() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={signOut} className="btn-ghost">
      Sign out
    </button>
  );
}
