"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type VG = { id: string; name: string; description: string | null; created_at: string };
type VM = { id: string; group_id: string; user_id: string; role: string; joined_at: string };
type VI = {
  id: string;
  group_id: string;
  email: string | null;
  invite_code: string;
  accepted_at: string | null;
  expires_at: string;
};

export default function VolunteerGroupsPanel({
  groups,
  memberships,
  invites,
}: {
  groups: VG[];
  memberships: VM[];
  invites: VI[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inviting, setInviting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState<{ url: string; email: string | null } | null>(null);

  function membersOf(groupId: string): VM[] {
    return memberships.filter((m) => m.group_id === groupId);
  }
  function invitesFor(groupId: string): VI[] {
    return invites.filter((i) => i.group_id === groupId && !i.accepted_at);
  }

  async function createGroup() {
    if (!name.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch("/api/volunteer-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "create failed");
        return;
      }
      setName("");
      setDescription("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function generateInvite(groupId: string, email: string | null) {
    setInviting(groupId);
    setErr(null);
    try {
      const res = await fetch(`/api/volunteer-groups/${groupId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "invite failed");
        return;
      }
      setShowInvite({ url: json.invite_url as string, email });
      router.refresh();
    } finally {
      setInviting(null);
    }
  }

  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-subtle)]">No groups yet. Create one below.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const members = membersOf(g.id);
            const open = invitesFor(g.id);
            return (
              <li key={g.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{g.name}</h3>
                    {g.description && (
                      <p className="text-xs text-[var(--color-ink-subtle)]">{g.description}</p>
                    )}
                    <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                      {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
                      {open.length} pending invite{open.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <InviteButton
                    onInvite={(email) => generateInvite(g.id, email)}
                    busy={inviting === g.id}
                  />
                </div>
                {open.length > 0 && (
                  <div className="mt-3 border-t border-[var(--color-border)] pt-2">
                    <div className="section-label mb-1">Pending invites</div>
                    <ul className="space-y-1 text-xs">
                      {open.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2 text-[var(--color-ink-muted)]">
                          <span>
                            {i.email ?? "(no email)"} · expires{" "}
                            {new Date(i.expires_at).toLocaleDateString()}
                          </span>
                          <button
                            onClick={() => navigator.clipboard.writeText(buildInviteUrl(i.invite_code))}
                            className="btn-ghost text-xs"
                          >
                            Copy link
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="card p-4">
        <div className="section-label mb-2">Create a group</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tenafly Door Knockers"
            className="input flex-1"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="input flex-1"
          />
          <button
            onClick={createGroup}
            disabled={creating || !name.trim()}
            className="btn-primary"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>

      {err && (
        <div className="card bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
          {err}
        </div>
      )}

      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setShowInvite(null)}
        >
          <div
            className="card w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Invite link</h3>
              <button onClick={() => setShowInvite(null)} className="btn-ghost text-xs">
                Close
              </button>
            </div>
            <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
              Send this link to{" "}
              <strong>{showInvite.email ?? "your volunteer"}</strong>. They sign in
              with their own email and accept the invite.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={showInvite.url}
                className="input flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => navigator.clipboard.writeText(showInvite.url)}
                className="btn-secondary text-xs"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteButton({
  onInvite,
  busy,
}: {
  onInvite: (email: string | null) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary text-xs shrink-0">
        Generate invite
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="volunteer@example.com (optional)"
        className="input !py-1 !px-2 text-xs"
      />
      <button
        onClick={() => {
          onInvite(email.trim() || null);
          setOpen(false);
          setEmail("");
        }}
        disabled={busy}
        className="btn-primary text-xs"
      >
        {busy ? "Generating..." : "Send"}
      </button>
      <button onClick={() => setOpen(false)} className="btn-ghost text-xs">
        Cancel
      </button>
    </div>
  );
}

function buildInviteUrl(code: string): string {
  if (typeof window === "undefined") return `/invites/${code}`;
  return `${window.location.origin}/invites/${code}`;
}
