import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Accept either env var name. OPENAI_API_KEY is the standard convention;
  // OpenAI_Whisper is what's currently in Vercel for this project.
  const key = process.env.OPENAI_API_KEY ?? process.env.OpenAI_Whisper;
  if (!key) {
    return Response.json(
      {
        error:
          "Server-side transcription isn't configured yet. Add OPENAI_API_KEY in Vercel (and locally) and redeploy.",
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Could not read upload" }, { status: 400 });
  }
  const audio = form.get("audio") as File | null;
  if (!audio || audio.size === 0) {
    return Response.json({ error: "No audio received" }, { status: 400 });
  }
  if (audio.size > 25 * 1024 * 1024) {
    return Response.json({ error: "Audio too large (max 25 MB)" }, { status: 413 });
  }

  // Forward to OpenAI Whisper
  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "audio.webm");
  upstream.append("model", "whisper-1");
  upstream.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: upstream,
  });
  if (!res.ok) {
    const body = await res.text();
    return Response.json(
      { error: `Transcription failed: ${res.status} ${body.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const json = (await res.json()) as { text: string };
  return Response.json({ ok: true, text: json.text });
}
