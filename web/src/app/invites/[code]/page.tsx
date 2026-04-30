import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import InviteAcceptClient from "./InviteAcceptClient";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // Not signed in — bounce to login. After login the user lands on /, then
  // we'd ideally route back to /invites/<code>. The login flow accepts a
  // ?next= param; nudge them there.
  if (!user) {
    redirect(`/login?next=/invites/${encodeURIComponent(code)}`);
  }

  return (
    <main className="mx-auto max-w-md px-5 py-12">
      <h1 className="page-title mb-3">Volunteer invite</h1>
      <p className="page-subtitle mb-6">
        Accepting this invite gives you access to the campaign&apos;s voter list and
        lets you log conversations under their account. The campaign owner sees
        which conversations you logged.
      </p>
      <InviteAcceptClient code={code} />
    </main>
  );
}
