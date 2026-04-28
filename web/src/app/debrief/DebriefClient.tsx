"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type ParticipantOut = {
  name: string;
  relationship: string;
  sentiment: string;
  issues: string[];
  tags: string[];
  notes: string;
};

type Extract = {
  participants: ParticipantOut[];
  captured_location: string | null;
  cleaned_notes: string;
  follow_up: { days_until: number; action: string } | null;
  wants_sign: boolean;
  wants_to_volunteer: boolean;
  mentioned_people: Array<{
    name: string;
    relationship: string;
    context: string;
    should_contact: boolean;
  }>;
};

type Candidate = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  confidence: number;
};

type ParticipantResult = {
  participant_id: string;
  captured_name: string;
  voter_ncid: string | null;
  match_confidence: number | null;
  candidates: Candidate[];
};

export default function DebriefClient() {
  const router = useRouter();
  const [recSupported, setRecSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<null | {
    interaction_id: string;
    extract: Extract;
    participants: ParticipantResult[];
  }>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [addedMentions, setAddedMentions] = useState<Set<string>>(new Set());
  const [addingMention, setAddingMention] = useState<string | null>(null);
  const supabase = getSupabaseBrowser();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setRecSupported(false);
    }
  }, []);

  function pickMime(): string | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return undefined;
  }

  async function start() {
    setErr(null);
    setVoiceNote(null);
    setResult(null);
    if (!recSupported) {
      setVoiceNote("This browser doesn't support in-page recording. Type below instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => uploadAndTranscribe(mr.mimeType);
      mr.start();
      recorderRef.current = mr;
      streamRef.current = stream;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      const name = (e as Error & { name?: string }).name;
      if (name === "NotAllowedError") {
        setVoiceNote("Mic permission denied. Allow microphone access in the address bar and try again.");
      } else if (name === "NotFoundError") {
        setVoiceNote("No microphone found. Plug one in or type below.");
      } else {
        setVoiceNote(`Couldn't start recording: ${(e as Error).message}`);
      }
    }
  }

  function stop() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function uploadAndTranscribe(mimeType: string) {
    setTranscribing(true);
    setErr(null);
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      if (blob.size < 500) {
        setVoiceNote("Recording was too short to transcribe. Try again.");
        return;
      }
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", blob, `debrief.${ext}`);
      await transcribeFile(form);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  async function transcribeFile(form: FormData) {
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) {
      setErr(json.error ?? "transcription failed");
      return;
    }
    const text = (json.text as string).trim();
    if (!text) {
      setVoiceNote("No speech recognized.");
      return;
    }
    setTranscript((t) => (t ? t + " " : "") + text);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setErr("Audio file too large (max 25 MB).");
      return;
    }
    setErr(null);
    setVoiceNote(null);
    setResult(null);
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", f, f.name);
      await transcribeFile(form);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  async function confirmMatch(participantId: string, ncid: string) {
    if (!result) return;
    setConfirmingId(participantId);
    try {
      const res = await fetch(`/api/participants/${participantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voter_ncid: ncid }),
      });
      if (res.ok) {
        setResult({
          ...result,
          participants: result.participants.map((p) =>
            p.participant_id === participantId
              ? { ...p, voter_ncid: ncid, candidates: [] }
              : p,
          ),
        });
        router.refresh();
      } else {
        const json = await res.json();
        setErr(json.error ?? "couldn't update match");
      }
    } finally {
      setConfirmingId(null);
    }
  }

  function dismissCandidates(participantId: string) {
    if (!result) return;
    setResult({
      ...result,
      participants: result.participants.map((p) =>
        p.participant_id === participantId ? { ...p, candidates: [] } : p,
      ),
    });
  }

  async function addMentionAsContact(mention: {
    name: string;
    relationship: string;
    context: string;
  }) {
    setAddingMention(mention.name);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const lead = result?.participants[0];
      const referredBy = lead?.captured_name
        ? `Referred by ${lead.captured_name}`
        : "Mentioned in a debrief";
      await supabase.from("interactions").insert({
        user_id: user.id,
        voter_ncid: null,
        captured_name: mention.name,
        captured_location: referredBy,
        notes: mention.relationship
          ? `${mention.relationship}: ${mention.context}`
          : mention.context,
        tags: mention.relationship ? [mention.relationship.toLowerCase().replace(/\s+/g, "-")] : [],
      });
      setAddedMentions((prev) => new Set(prev).add(mention.name));
      router.refresh();
    } finally {
      setAddingMention(null);
    }
  }

  async function process() {
    const full = transcript.trim();
    if (full.length < 10) {
      setErr("Say or type at least a sentence — include the person's name + what you heard.");
      return;
    }
    setProcessing(true);
    setErr(null);
    try {
      const res = await fetch("/api/debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: full }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "debrief failed");
      } else {
        setResult(json);
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="block">
          <span className="section-label">What happened? Say or type it.</span>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            placeholder={
              recording
                ? "Recording... stop when you're done."
                : transcribing
                ? "Transcribing..."
                : "e.g. Talked to Carla Hernandez at Githens PTA. Cares about Oak traffic, son at Jefferson, leans yes, asked for a yard sign."
            }
            className="input mt-1"
            disabled={processing || transcribing || recording}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!recording ? (
            <button
              onClick={start}
              disabled={processing || transcribing}
              className="btn-secondary"
            >
              {transcribing ? "Transcribing..." : "Start recording"}
            </button>
          ) : (
            <button onClick={stop} className="btn-primary">
              Stop {formatElapsed(elapsed)}
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.mp4"
            onChange={onPickFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={processing || recording || transcribing}
            className="btn-secondary"
            title="Upload an audio file (m4a, mp3, wav, webm, mp4)"
          >
            Upload recording
          </button>

          <button
            onClick={process}
            disabled={processing || recording || transcribing || transcript.trim().length < 10}
            className="btn-primary"
          >
            {processing ? "Claude parsing..." : "Save to JED"}
          </button>

          <button
            onClick={() => {
              setTranscript("");
              setResult(null);
              setErr(null);
              setVoiceNote(null);
            }}
            className="btn-ghost text-sm"
            disabled={processing || recording || transcribing}
          >
            Clear
          </button>
        </div>

        {voiceNote && (
          <div className="mt-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm text-[var(--color-warning)]">
            <strong className="block mb-1">Heads up</strong>
            {voiceNote}
          </div>
        )}
      </div>

      {err && (
        <div className="card bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
          {err}
        </div>
      )}

      {result && (
        <div className="card p-4">
          <div className="mb-3 section-label">Saved</div>

          {result.participants.map((p, idx) => {
            const extractP = result.extract.participants[idx];
            const showSuggest =
              p.candidates.length > 0 &&
              (!p.voter_ncid || p.candidates[0].confidence < 0.85);
            return (
              <section
                key={p.participant_id}
                className={
                  idx > 0
                    ? "mt-4 border-t border-[var(--color-border)] pt-4"
                    : ""
                }
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base font-semibold">{p.captured_name}</span>
                    {extractP?.relationship && (
                      <span className="text-xs text-[var(--color-ink-subtle)]">
                        ({extractP.relationship})
                      </span>
                    )}
                    {idx === 0 && result.participants.length > 1 && (
                      <span className="chip chip-primary">lead</span>
                    )}
                  </div>
                  {p.voter_ncid ? (
                    <a href={`/people/${p.voter_ncid}`} className="btn-ghost text-xs">
                      Open profile
                    </a>
                  ) : (
                    <span className="chip chip-warning">unmatched</span>
                  )}
                </div>

                {showSuggest && (
                  <div className="mb-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-3">
                    <div className="mb-2 text-sm font-medium">
                      Is this who {p.captured_name} is?
                    </div>
                    <ul className="space-y-1">
                      {p.candidates.slice(0, 5).map((c) => {
                        const name = [c.first_name, c.middle_name, c.last_name]
                          .filter(Boolean)
                          .join(" ");
                        const isCurrent = c.ncid === p.voter_ncid;
                        return (
                          <li
                            key={c.ncid}
                            className="flex items-baseline justify-between gap-2 rounded-md bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                          >
                            <span>
                              <span className="font-medium">{name}</span>
                              <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">
                                {c.res_street_address}
                                {c.res_city ? ", " + c.res_city : ""}
                              </span>
                              <span className="ml-2 font-mono text-xs text-[var(--color-ink-subtle)]">
                                {Math.round(c.confidence * 100)}%
                              </span>
                              {isCurrent && (
                                <span className="ml-2 chip chip-success">currently linked</span>
                              )}
                            </span>
                            <button
                              onClick={() => confirmMatch(p.participant_id, c.ncid)}
                              disabled={confirmingId !== null || isCurrent}
                              className="btn-secondary text-xs"
                            >
                              {isCurrent ? "Yes" : "Use this one"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      onClick={() => dismissCandidates(p.participant_id)}
                      className="btn-ghost mt-2 text-xs"
                      disabled={confirmingId !== null}
                    >
                      None of these
                    </button>
                  </div>
                )}

                <dl className="space-y-1 text-sm">
                  <Row k="Sentiment" v={(extractP?.sentiment ?? "unknown").replace(/_/g, " ")} />
                  {extractP?.issues.length ? (
                    <Row k="Issues" v={extractP.issues.join(", ")} />
                  ) : null}
                  {extractP?.tags.length ? (
                    <Row k="Tags" v={extractP.tags.join(", ")} />
                  ) : null}
                  {extractP?.notes ? <Row k="Said" v={extractP.notes} /> : null}
                </dl>
              </section>
            );
          })}

          {result.extract.follow_up && (
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <Row
                k="Follow-up"
                v={`${result.extract.follow_up.action} (in ${result.extract.follow_up.days_until} days)`}
              />
            </div>
          )}

          {result.extract.mentioned_people.length > 0 && (
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <div className="section-label mb-2">Others mentioned</div>
              <ul className="space-y-3">
                {result.extract.mentioned_people.map((m, i) => {
                  const added = addedMentions.has(m.name);
                  const adding = addingMention === m.name;
                  return (
                    <li key={i} className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{m.name}</span>
                          {m.relationship && (
                            <span className="text-xs text-[var(--color-ink-subtle)]">{m.relationship}</span>
                          )}
                          {m.should_contact && (
                            <span className="chip chip-warm">worth a call</span>
                          )}
                        </div>
                        {added ? (
                          <span className="chip chip-success shrink-0">Added</span>
                        ) : (
                          <button
                            onClick={() => addMentionAsContact(m)}
                            disabled={adding}
                            className="btn-secondary shrink-0 text-xs"
                          >
                            {adding ? "Adding..." : "Add to contacts"}
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{m.context}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">{k}</dt>
      <dd className="text-sm text-[var(--color-ink)]">{v}</dd>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
