import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { errorToResponse, NotFoundError, UnauthorizedError } from "@/domain/errors";
import { makeRequestLogger, newRequestId } from "@/lib/logger";

export const runtime = "nodejs";

// Returns the meeting as an .ics file. Importing into Google Calendar
// (or Outlook / Apple Calendar) is "File → Import" or just opening the
// .ics. This avoids the OAuth round-trip entirely; for full two-way sync
// see /docs/gcal.md or the volunteer-groups epic.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({ request_id: requestId, route: "GET /api/meetings/[id]/ics", meeting_id: id });
  try {
    if (!id) throw new NotFoundError("missing meeting id");
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const { data: meeting } = await supabase
      .from("meeting_notes")
      .select("id, title, body, meeting_date, duration_min, location, attendees, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!meeting) throw new NotFoundError("meeting not found");

    const start = meeting.meeting_date
      ? new Date(meeting.meeting_date as string)
      : new Date(meeting.created_at as string);
    const durMin = meeting.duration_min ?? 60;
    const end = new Date(start.getTime() + durMin * 60_000);

    const ics = renderIcs({
      uid: `${meeting.id}@jed.voter`,
      title: meeting.title as string,
      body: (meeting.body as string | null) ?? "",
      location: (meeting.location as string | null) ?? "",
      attendees: (meeting.attendees as string[] | null) ?? [],
      start,
      end,
    });
    rlog.info("meeting.ics.ok", { user_id: user.id });
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="meeting-${meeting.id}.ics"`,
        "x-request-id": requestId,
      },
    });
  } catch (e) {
    rlog.error("meeting.ics.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}

// RFC 5545 says "\r\n" line endings, lines folded at 75 octets, and special
// chars (, ; \ \n) escaped with backslash. Produced output is plain ASCII so
// folding by character index is safe.
function renderIcs(m: {
  uid: string;
  title: string;
  body: string;
  location: string;
  attendees: string[];
  start: Date;
  end: Date;
}): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const fold = (line: string): string => {
    if (line.length <= 75) return line;
    const out: string[] = [];
    let rest = line;
    while (rest.length > 75) {
      out.push(rest.slice(0, 75));
      rest = " " + rest.slice(75);
    }
    out.push(rest);
    return out.join("\r\n");
  };
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JED//Voter Notebook//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${m.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(m.start)}`,
    `DTEND:${fmt(m.end)}`,
    `SUMMARY:${esc(m.title)}`,
  ];
  if (m.location) lines.push(`LOCATION:${esc(m.location)}`);
  if (m.body) lines.push(`DESCRIPTION:${esc(m.body)}`);
  for (const a of m.attendees) {
    // We don't have emails for attendees; fall back to CN-only attendee.
    lines.push(`ATTENDEE;CN=${esc(a)}:mailto:noreply@jed.voter`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n");
}
