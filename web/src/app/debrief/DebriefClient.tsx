"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Minimal types for the Web Speech API (not in lib.dom.d.ts yet)
type SRResultItem = { transcript: string; confidence: number };
type SRResult = { 0: SRResultItem; isFinal: boolean; length: number };
type SREvent = {
  resultIndex: number;
  results: { length: number; [idx: number]: SRResult };
};
type SRInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SRClass = new () => SRInstance;
declare global {
  interface Window {
    SpeechRecognition?: SRClass;
    webkitSpeechRecognition?: SRClass;
  }
}

export default function DebriefClient() {
  const router = useRouter();
  const [sttSupported, setSttSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [result, setResult] = useState<null | {
    voter_ncid: string | null;
    extract: {
      captured_name: string;
      sentiment: string;
      issues: string[];
      tags: string[];
      follow_up: { days_until: number; action: string } | null;
    };
  }>(null);
  const recRef = useRef<SRInstance | null>(null);

  useEffect(() => {
    const SR = typeof window !== "undefined"
      ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
      : undefined;
    if (!SR) setSttSupported(false);
  }, []);

  function start() {
    setErr(null);
    setVoiceNote(null);
    setResult(null);
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setSttSupported(false);
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: SREvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalText) setTranscript((t) => (t ? t + " " : "") + finalText.trim());
      setInterim(interimText);
    };
    r.onerror = (ev: Event) => {
      const code = (ev as Event & { error?: string }).error ?? "unknown";
      if (code === "network") {
        setVoiceNote(
          "Mic transcription couldn't reach the speech server (common behind firewalls or on flaky Wi-Fi). Type what you want to log below — Claude will still parse and save it.",
        );
      } else if (code === "not-allowed" || code === "service-not-allowed") {
        setVoiceNote(
          "Mic permission is blocked for this site. Enable it in the browser address bar, or just type below.",
        );
      } else if (code === "no-speech") {
        setVoiceNote("No speech detected. Press Start again or type below.");
      } else {
        setVoiceNote(`Mic error: ${code}. You can type below instead.`);
      }
      setRecording(false);
    };
    r.onend = () => {
      setRecording(false);
    };
    r.start();
    recRef.current = r;
    setRecording(true);
  }

  function stop() {
    recRef.current?.stop();
    setRecording(false);
  }

  async function process() {
    const full = (transcript + " " + interim).trim();
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
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">
            What happened? Say or type it.
          </span>
          <textarea
            value={transcript + (interim ? " " + interim : "")}
            onChange={(e) => {
              setTranscript(e.target.value);
              setInterim("");
            }}
            rows={6}
            placeholder={
              recording
                ? "Listening... speak naturally."
                : "e.g. Talked to Carla Hernandez at Githens PTA. Cares about Oak traffic, son at Jefferson, leans yes, asked for a yard sign. Worries her husband won't vote."
            }
            className="input mt-1"
            disabled={processing}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sttSupported ? (
            !recording ? (
              <button onClick={start} disabled={processing} className="btn-secondary">
                Start recording
              </button>
            ) : (
              <button
                onClick={stop}
                className="btn-primary bg-[var(--color-danger)] hover:bg-[var(--color-danger)]"
              >
                Stop recording
              </button>
            )
          ) : (
            <span className="text-xs text-[var(--color-ink-subtle)]">
              Mic transcription not supported in this browser — type above.
            </span>
          )}

          <button
            onClick={process}
            disabled={processing || (transcript + interim).trim().length < 10}
            className="btn-primary"
          >
            {processing ? "Claude parsing..." : "Save to JED"}
          </button>

          <button
            onClick={() => {
              setTranscript("");
              setInterim("");
              setResult(null);
              setErr(null);
              setVoiceNote(null);
            }}
            className="btn-ghost text-sm"
            disabled={processing}
          >
            Clear
          </button>
        </div>

        {voiceNote && (
          <p className="mt-3 rounded-md bg-[var(--color-warning-soft)] px-3 py-2 text-xs text-[var(--color-warning)]">
            {voiceNote}
          </p>
        )}
      </div>

      {err && (
        <div className="card bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
          {err}
        </div>
      )}

      {result && (
        <div className="card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="section-label">Saved</div>
            {result.voter_ncid ? (
              <a href={`/people/${result.voter_ncid}`} className="btn-ghost text-xs">
                Open profile
              </a>
            ) : (
              <span className="chip chip-warning">unmatched</span>
            )}
          </div>
          <dl className="space-y-1 text-sm">
            <Row k="Name heard" v={result.extract.captured_name || "—"} />
            <Row k="Sentiment" v={result.extract.sentiment.replace(/_/g, " ")} />
            <Row k="Issues" v={result.extract.issues.join(", ") || "—"} />
            <Row k="Tags" v={result.extract.tags.join(", ") || "—"} />
            {result.extract.follow_up && (
              <Row
                k="Follow-up"
                v={`${result.extract.follow_up.action} (in ${result.extract.follow_up.days_until} days)`}
              />
            )}
          </dl>
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
